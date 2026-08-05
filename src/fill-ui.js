// 智能填充：侧边栏交互逻辑（扫描/匹配/填充/模板/历史）。
import {
  state, activeProfile, setFillScanFields, setFillScanPage, setFillScanSession,
  setFillRepeaters, setFillMatches, setFillSelected, setFillValues, setFillFailedIds,
  setFillAiEnabled, setFillTemplateEnabled, setFillAutoMode, setFillContinueRounds, setResumeFieldsDraft, setResumeFieldsDirty,
} from "./state.js";
import { $, toast, fillMessagePage } from "./chrome-helpers.js";
import { escapeHtml } from "./pure-utils.js";
import { RESUME_FIELD_LABELS, GROUP_LABELS } from "./form-fields.js";
import { matchRules, applyAiResults, buildAiMatchPrompt, validateBinding } from "./matcher.js";
import { applyTemplate, saveTemplateFromResults, capTemplates, templateKey } from "./site-templates.js";
import { appendFillLog, summarizeResults } from "./fill-log.js";
import { RESUME_FIELDS_SCHEMA, ENTRY_GROUPS, extractResumeFieldsLocal, buildResumeExtractPrompt, mergeResumeFields, aggregateResumeFields } from "./resume-fields.js";
import { switchProfile, saveProfiles } from "./config.js";
import { ai, parseAiJson } from "./ai-client.js";

// —— 存储工具 ——
async function getTemplates() {
  const { smartFillTemplates = {} } = await chrome.storage.local.get("smartFillTemplates");
  return smartFillTemplates;
}
async function getFillLogs() {
  const { smartFillLogs = [] } = await chrome.storage.local.get("smartFillLogs");
  return smartFillLogs;
}
async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

// —— 简历选择与字段 ——
export function renderFillProfileSelect() {
  const select = $("fillProfileSelect");
  if (!select) return;
  select.innerHTML = state.profiles.map((profile, index) =>
    `<option value="${index}" ${index === state.activeProfileIndex ? "selected" : ""}>${escapeHtml(profile.name || "未命名")}</option>`
  ).join("");
}

// 经历类字段只通过条目编辑器维护；聚合标量是匹配兼容层，不再提供第二个编辑入口。
const SCALAR_GROUPS = ["basic", "intention", "work", "profile", "other"];
const DERIVED_EXPERIENCE_KEYS = new Set([
  "currentCompany", "workIndustry", "workLocation", "currentTitle", "workStart", "workEnd", "workDescription",
]);
const EDITOR_OPTIONS = {
  gender: ["男", "女"],
  politicalStatus: ["中共党员", "中共预备党员", "共青团员", "群众", "其他"],
  maritalStatus: ["未婚", "已婚", "其他"],
  acceptAdjustment: ["是", "否"],
};
let fillResultMode = "list"; // "list" = 预览/全量平铺；"summary" = 一键填充后的折叠视图
let pickRegionRequestId = null; // 选区拾取（Wave 2 任务3）请求标识
let resumeFieldFilter = "all";
let resumeFieldSearch = "";
let expandedEntryId = "";

function entryCardHtml(group, entry, index) {
  const fields = group.fields.map(field => field.textarea
    ? `<label>${escapeHtml(field.label)}<textarea rows="3" data-entry-input="${group.resumeKey}|${entry.id}|${field.key}">${escapeHtml(entry[field.key] || "")}</textarea></label>`
    : `<label>${escapeHtml(field.label)}<input type="text" data-entry-input="${group.resumeKey}|${entry.id}|${field.key}" value="${escapeHtml(entry[field.key] || "")}"${["start", "end"].includes(field.key) ? ` inputmode="numeric" placeholder="YYYY-MM${field.key === "end" ? " / 至今" : ""}"` : ""}></label>`
  ).join("");
  return `<details class="resume-entry-card" data-entry-id="${entry.id}" ${entry.id === expandedEntryId ? "open" : ""}>
    <summary>${escapeHtml(group.summary(entry) || `（第 ${index + 1} 条，未填写）`)}</summary>
    <div class="resume-entry-fields">${fields}</div>
    <div class="resume-entry-actions"><button type="button" class="text-button danger" data-remove-entry="${group.resumeKey}|${entry.id}">删除本条</button></div>
  </details>`;
}

function cloneResumeFields(fields) {
  return JSON.parse(JSON.stringify(fields || {}));
}

function ensureResumeDraft(force = false) {
  const profile = activeProfile();
  if (!profile) return {};
  if (force || state.resumeFieldsDraftProfile !== profile || !state.resumeFieldsDraft) {
    setResumeFieldsDraft(cloneResumeFields(profile.resumeFields), profile);
    setResumeFieldsDirty(false);
  }
  return state.resumeFieldsDraft;
}

function editableScalarFields() {
  return RESUME_FIELDS_SCHEMA.filter(field =>
    SCALAR_GROUPS.includes(field.group) && !DERIVED_EXPERIENCE_KEYS.has(field.key)
  );
}

function fieldVisible(field, value) {
  if (resumeFieldFilter === "missing" && String(value || "").trim()) return false;
  if (!["all", "missing"].includes(resumeFieldFilter) && field.group !== resumeFieldFilter) return false;
  if (!resumeFieldSearch) return true;
  const source = `${field.label} ${field.key} ${value || ""}`.toLowerCase();
  return source.includes(resumeFieldSearch);
}

function scalarFieldHtml(field, value) {
  const empty = !String(value || "").trim();
  const textarea = field.type === "textarea";
  const options = EDITOR_OPTIONS[field.key] || [];
  const input = textarea
    ? `<textarea rows="2" data-resume-key="${field.key}">${escapeHtml(value)}</textarea>`
    : options.length
      ? `<select data-resume-key="${field.key}"><option value="">请选择</option>${options.map(option => `<option value="${escapeHtml(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}${value && !options.includes(value) ? `<option value="${escapeHtml(value)}" selected>${escapeHtml(value)}</option>` : ""}</select>`
      : `<input type="text" data-resume-key="${field.key}" value="${escapeHtml(value)}"${field.type === "date" ? ` inputmode="numeric" placeholder="YYYY-MM 或 YYYY-MM-DD"` : ""}>`;
  const hidden = fieldVisible(field, value) ? "" : " hidden";
  const pickButton = `<button type="button" class="text-button pick-fill" data-pick-field-key="${field.key}"${empty ? " disabled" : ""} title="点击后在页面选择要填入的位置">填入页面</button>`;
  return `<label class="resume-field${empty ? " is-empty" : ""}${textarea ? " is-textarea" : ""}"${hidden}><span>${escapeHtml(field.label)}</span>${input}${pickButton}</label>`;
}

function entryGroupVisible(group, entries) {
  const filterKey = {
    workHistory: "work",
    internships: "internship",
    projects: "project",
  }[group.key] || group.key;
  if (!["all", "missing"].includes(resumeFieldFilter) && resumeFieldFilter !== filterKey) return false;
  if (!resumeFieldSearch) return true;
  const source = `${group.title} ${entries.flatMap(entry => Object.values(entry)).join(" ")}`.toLowerCase();
  return source.includes(resumeFieldSearch);
}

export function renderResumeFields() {
  const list = $("resumeFieldsList");
  const resume = ensureResumeDraft();
  if (!list) return;
  const scalarFields = editableScalarFields();
  const emptyCount = scalarFields.filter(field => !String(resume[field.key] || "").trim()).length;
  const filledCount = scalarFields.filter(field => String(resume[field.key] || "").trim()).length;
  const scalarHtml = SCALAR_GROUPS.map(groupKey => {
    const fields = scalarFields.filter(field => field.group === groupKey);
    const visible = fields.some(field => fieldVisible(field, resume[field.key] || ""));
    if (!visible) return "";
    const groupFilled = fields.filter(field => String(resume[field.key] || "").trim()).length;
    const open = groupKey === "basic" || resumeFieldFilter === groupKey || !!resumeFieldSearch;
    return `<details class="resume-scalar-group" data-resume-group="${groupKey}" ${open ? "open" : ""}>
      <summary><b>${escapeHtml(GROUP_LABELS[groupKey] || groupKey)}</b><span>${groupFilled}/${fields.length}</span></summary>
      <div class="resume-fields-grid">${fields.map(field => scalarFieldHtml(field, resume[field.key] || "")).join("")}</div>
    </details>`;
  }).join("");
  const entriesHtml = ENTRY_GROUPS.map(group => {
    const entries = Array.isArray(resume[group.resumeKey]) ? resume[group.resumeKey] : [];
    if (!entryGroupVisible(group, entries)) return "";
    const cards = entries.map((entry, index) => entryCardHtml(group, entry, index)).join("");
    const filterKey = {
      workHistory: "work",
      internships: "internship",
      projects: "project",
    }[group.key] || group.key;
    const open = resumeFieldFilter === filterKey || !!resumeFieldSearch || entries.some(entry => entry.id === expandedEntryId);
    return `<details class="resume-entries-group" data-entry-group="${group.resumeKey}" ${open ? "open" : ""}>
      <summary class="resume-entries-head"><b>${escapeHtml(group.title)}</b><span class="resume-entry-count">${entries.length} 条</span><button type="button" class="text-button" data-add-entry="${group.resumeKey}">+ 添加</button></summary>
      ${cards || `<p class="hint">暂无${escapeHtml(group.title)}，点击「添加」手动填写。</p>`}
    </details>`;
  }).join("");
  list.innerHTML = `${scalarHtml}${entriesHtml}`;
  const entryCount = ENTRY_GROUPS.reduce((total, group) => total + (Array.isArray(resume[group.resumeKey]) ? resume[group.resumeKey].length : 0), 0);
  const dirty = state.resumeFieldsDirty ? " · 有未保存修改" : "";
  if ($("resumeFieldsStatus")) $("resumeFieldsStatus").textContent = `${filledCount}/${scalarFields.length} 项 · ${entryCount} 条经历${dirty}`;
  if ($("resumeFieldsSummary")) $("resumeFieldsSummary").textContent = `缺失 ${emptyCount} 项，已维护 ${entryCount} 条教育/工作/实习/项目经历。`;
  if ($("manageResumeFields")) $("manageResumeFields").textContent = state.resumeFieldsDirty ? "继续编辑" : "管理资料";
}

export function collectResumeFields() {
  const scalars = Object.fromEntries(
    [...document.querySelectorAll("[data-resume-key]")].map(el => [el.dataset.resumeKey, el.value.trim()])
  );
  const entries = {};
  for (const group of ENTRY_GROUPS) {
    const groupContainer = document.querySelector(`[data-entry-group="${group.resumeKey}"]`);
    if (!groupContainer) continue;
    const list = [];
    for (const card of [...groupContainer.querySelectorAll("[data-entry-id]")]) {
      const entry = { id: card.dataset.entryId };
      for (const field of group.fields) {
        const input = card.querySelector(`[data-entry-input="${group.resumeKey}|${entry.id}|${field.key}"]`);
        entry[field.key] = input ? input.value.trim() : "";
      }
      if (Object.entries(entry).some(([key, value]) => key !== "id" && value)) list.push(entry);
    }
    entries[group.resumeKey] = list;
  }
  return { ...scalars, ...entries };
}

function syncResumeDraftFromDom() {
  if (!document.querySelector("[data-resume-key], [data-entry-input]")) return ensureResumeDraft();
  const collected = collectResumeFields();
  setResumeFieldsDraft({ ...ensureResumeDraft(), ...collected }, activeProfile());
  return state.resumeFieldsDraft;
}

function markResumeFieldsDirty() {
  setResumeFieldsDirty(true);
  renderResumeFieldsStatus();
}

function renderResumeFieldsStatus() {
  const resume = ensureResumeDraft();
  const scalarFields = editableScalarFields();
  const filled = scalarFields.filter(field => String(resume[field.key] || "").trim()).length;
  const entryCount = ENTRY_GROUPS.reduce((total, group) => total + (Array.isArray(resume[group.resumeKey]) ? resume[group.resumeKey].length : 0), 0);
  const dirty = state.resumeFieldsDirty ? " · 有未保存修改" : "";
  if ($("resumeFieldsStatus")) $("resumeFieldsStatus").textContent = `${filled}/${scalarFields.length} 项 · ${entryCount} 条经历${dirty}`;
  if ($("manageResumeFields")) $("manageResumeFields").textContent = state.resumeFieldsDirty ? "继续编辑" : "管理资料";
}

export async function saveResumeFields(options = {}) {
  const profile = activeProfile();
  if (!profile) throw new Error("未找到当前简历。");
  profile.resumeFields = aggregateResumeFields(cloneResumeFields(syncResumeDraftFromDom()));
  await saveProfiles();
  setResumeFieldsDraft(cloneResumeFields(profile.resumeFields), profile);
  setResumeFieldsDirty(false);
  if (!options.silent) toast("简历资料已保存");
  renderResumeFields();
  if (options.rebuild !== false && state.fillScanFields.length) await buildMatches();
}

let entrySeq = 0;
export function addResumeEntry(groupKey) {
  if (!activeProfile()) return;
  const group = ENTRY_GROUPS.find(g => g.resumeKey === groupKey);
  if (!group) return;
  const draft = syncResumeDraftFromDom();
  const list = Array.isArray(draft[groupKey]) ? [...draft[groupKey]] : [];
  const entry = group.empty(entrySeq++);
  list.push(entry);
  draft[groupKey] = list;
  expandedEntryId = entry.id;
  setResumeFieldsDirty(true);
  renderResumeFields();
}

export function removeResumeEntry(groupKey, id) {
  if (!activeProfile()) return;
  const draft = syncResumeDraftFromDom();
  draft[groupKey] = (draft[groupKey] || []).filter(entry => entry.id !== id);
  if (expandedEntryId === id) expandedEntryId = "";
  setResumeFieldsDirty(true);
  renderResumeFields();
}

export function discardResumeFields() {
  ensureResumeDraft(true);
  expandedEntryId = "";
  renderResumeFields();
}

export function openResumeFieldsEditor() {
  $("smartFillMain").hidden = true;
  $("resumeFieldsEditor").hidden = false;
  renderResumeFields();
}

export function closeResumeFieldsEditor() {
  $("resumeFieldsEditor").hidden = true;
  $("smartFillMain").hidden = false;
  renderResumeFieldsStatus();
}

export function setResumeFieldFilter(filter) {
  syncResumeDraftFromDom();
  resumeFieldFilter = filter || "all";
  document.querySelectorAll("[data-resume-filter]").forEach(button => {
    button.classList.toggle("active", button.dataset.resumeFilter === resumeFieldFilter);
  });
  renderResumeFields();
}

function updateResumeDraftFromControl(target) {
  const draft = ensureResumeDraft();
  const scalar = target.closest("[data-resume-key]");
  if (scalar) {
    draft[scalar.dataset.resumeKey] = scalar.value.trim();
    markResumeFieldsDirty();
    return true;
  }
  const entryInput = target.closest("[data-entry-input]");
  if (!entryInput) return false;
  const [groupKey, id, fieldKey] = entryInput.dataset.entryInput.split("|");
  const entry = (draft[groupKey] || []).find(item => item.id === id);
  if (entry) entry[fieldKey] = entryInput.value.trim();
  markResumeFieldsDirty();
  return true;
}

export async function extractResumeFields() {
  const button = $("extractResumeFields");
  const profile = activeProfile();
  if (!profile) throw new Error("未找到当前简历。");
  if (!profile.candidateProfile?.trim()) throw new Error("请先在设置中粘贴或解析简历内容。");
  button.disabled = true;
  button.textContent = "正在提取…";
  try {
    const local = extractResumeFieldsLocal(profile.candidateProfile);
    let merged = local;
    if (state.config.apiKey) {
      try {
        const messages = [...buildResumeExtractPrompt(), { role: "user", content: `简历原文：\n${profile.candidateProfile}` }];
        const response = await ai(messages, 2000, true);
        const data = await parseAiJson(response.text);
        merged = mergeResumeFields(local, data);
      } catch (_error) {
        toast("AI 提取失败，已保留本地提取结果");
      }
    }
    setResumeFieldsDraft(cloneResumeFields(merged), profile);
    setResumeFieldsDirty(true);
    renderResumeFields();
    toast("简历资料已提取到草稿，请检查并保存");
  } finally {
    button.disabled = false;
    button.textContent = "重新提取简历字段";
  }
}

// —— 扫描与匹配 ——
async function ensureOriginPermission(tab) {
  const url = new URL(tab.url);
  if (url.protocol !== "https:") throw new Error("智能填充仅支持 https 网申页面（与扩展主机权限一致）。");
  const pattern = `${url.origin}/*`;
  const granted = await chrome.permissions.contains({ origins: [pattern] });
  if (granted) return;
  const ok = await chrome.permissions.request({ origins: [pattern] });
  if (!ok) throw new Error(`需要授权访问 ${url.hostname} 才能扫描表单项。`);
}

export async function scanFillPage() {
  stopIncrementalWatch();
  try {
    const tab = await currentTab();
    if (!tab?.url || !/^https?:/i.test(tab.url)) throw new Error("请先打开目标公司的网申页面。");
    const pageUrl = new URL(tab.url);
    if (/(^|\.)zhipin\.com$/.test(pageUrl.hostname)) throw new Error("BOSS 直聘没有网申表单，请打开其他公司的网申页面。");
    await ensureOriginPermission(tab);
    const response = await fillMessagePage(tab, { type: "SMART_FILL_SCAN" });
    if (!response?.ok) throw new Error(response?.error || "扫描失败");
    if (response.engineVersion !== 3) throw new Error("页面仍在运行旧版填充引擎，请刷新网申页面后重新扫描。");
    const fields = response.fields || [];
    if (!fields.length) throw new Error("未检测到可填写的表单项。");
    fillResultMode = "list";
    setFillScanFields(fields);
    setFillRepeaters(response.repeaters || []);
    setFillScanPage(response.page || { title: tab.title || "", url: tab.url, host: pageUrl.hostname });
    setFillScanSession({
      tabId: tab.id,
      scanId: response.scanId,
      documentFingerprint: response.documentFingerprint,
      formFingerprint: response.formFingerprint,
      url: response.page?.url || tab.url,
    });
    $("fillCurrentSite").textContent = "";
    $("fillCurrentSiteText").textContent = `当前站点：${pageUrl.hostname}（识别到 ${fields.length} 个表单项）`;
    $("clearFill").hidden = false;
    await buildMatches();
    await renderFillTemplate();
    setFillContinueRounds(0);
    hideContinueFillPrompt();
    toast(`已识别 ${fields.length} 个表单项`);
    return true;
  } catch (error) {
    toast(error.message);
  }
}

const REPEATER_TARGETS = {
  education: resume => Array.isArray(resume.education) ? resume.education.length : 0,
  internships: resume => Array.isArray(resume.internships) ? resume.internships.length : 0,
  workHistory: resume => {
    const count = Array.isArray(resume.workHistory) ? resume.workHistory.length : 0;
    return count || (resume.currentCompany || resume.currentTitle ? 1 : 0);
  },
  projects: resume => Array.isArray(resume.projects) ? resume.projects.length : 0,
  awardEntries: resume => {
    const count = Array.isArray(resume.awardEntries) ? resume.awardEntries.length : 0;
    return count || (resume.awards ? 1 : 0);
  },
  languageEntries: resume => {
    const count = Array.isArray(resume.languageEntries) ? resume.languageEntries.length : 0;
    return count || (resume.languages ? 1 : 0);
  },
  gameExperiences: resume => {
    const count = Array.isArray(resume.gameExperiences) ? resume.gameExperiences.length : 0;
    return count || (resume.gameName || resume.gameLevel || resume.gameDuration ? 1 : 0);
  },
};

export function buildRepeaterPlans(repeaters, resumeFields) {
  const resume = resumeFields || {};
  return (Array.isArray(repeaters) ? repeaters : []).flatMap(repeater => {
    const target = REPEATER_TARGETS[repeater.arrayKey];
    if (!target) return [];
    const targetCount = Math.min(10, Math.max(0, Number(target(resume)) || 0));
    if (targetCount <= Number(repeater.currentCount || 0)) return [];
    return [{
      id: repeater.id,
      fingerprint: repeater.fingerprint,
      arrayKey: repeater.arrayKey,
      title: repeater.title,
      currentCount: Number(repeater.currentCount || 0),
      targetCount,
    }];
  });
}

function computeRepeaterAdditions() {
  const plans = buildRepeaterPlans(state.fillRepeaters, activeProfile()?.resumeFields || {});
  return plans.reduce((sum, plan) => sum + plan.targetCount - plan.currentCount, 0);
}

function applyScanResponse(response, tab) {
  setFillScanFields(response.fields || []);
  setFillRepeaters(response.repeaters || []);
  setFillScanPage(response.page || state.fillScanPage);
  setFillScanSession({
    tabId: tab.id,
    scanId: response.scanId,
    documentFingerprint: response.documentFingerprint,
    formFingerprint: response.formFingerprint,
    url: response.page?.url || tab.url,
  });
}

export async function prepareFillSections() {
  const session = state.fillScanSession;
  if (!session?.scanId || !session?.tabId) throw new Error("请先扫描当前网申页面。");
  const plans = buildRepeaterPlans(state.fillRepeaters, activeProfile()?.resumeFields || {});
  if (!plans.length) return null;
  const progress = $("fillProgress");
  progress.textContent = `正在展开 ${plans.length} 类经历区块，请勿切换页面…`;
  try {
    const tab = await currentTab();
    if (!tab || tab.id !== session.tabId) throw new Error("当前标签页不是刚才扫描的页面，请切回后重新扫描。");
    const response = await fillMessagePage(tab, {
      type: "SMART_FILL_PREPARE",
      scanId: session.scanId,
      documentFingerprint: session.documentFingerprint,
      formFingerprint: session.formFingerprint,
      plans: plans.map(({ id, fingerprint, targetCount }) => ({ id, fingerprint, targetCount })),
    });
    if (response?.fields?.length) {
      applyScanResponse(response, tab);
      $("fillCurrentSite").textContent = "";
      $("fillCurrentSiteText").textContent = `当前站点：${state.fillScanPage?.host || new URL(tab.url).hostname}（识别到 ${response.fields.length} 个表单项）`;
      $("clearFill").hidden = false;
      progress.textContent = "经历区块已展开，正在重新匹配字段…";
      await buildMatches();
      await renderFillTemplate();
    }
    if (!response?.ok) {
      const failed = (response?.results || []).find(result => !result.ok);
      throw new Error(failed?.error || response?.error || "展开经历区块失败");
    }
    const added = (response.results || []).reduce((sum, result) => sum + Number(result.added || 0), 0);
    progress.textContent = `已展开 ${added} 个经历区块并重新扫描。`;
    return response;
  } catch (error) {
    progress.textContent = `展开失败：${error.message}`;
    throw error;
  }
}

function currentTemplateStorageKey() {
  const url = state.fillScanPage?.url || state.fillScanSession?.url || "";
  return templateKey(url, state.fillScanSession?.formFingerprint || "");
}

async function buildMatches() {
  const resume = activeProfile()?.resumeFields || {};
  let matches = matchRules(state.fillScanFields, resume);
  const templates = await getTemplates();
  const storageKey = currentTemplateStorageKey();
  matches = applyTemplate(matches, templates[storageKey] || null, resume, {
    formFingerprint: state.fillScanSession?.formFingerprint || "",
  });
  if (state.fillAiEnabled && state.config.apiKey) {
    const needs = matches.filter(m => m.status === "manual" || m.confidence === "low");
    if (needs.length) {
      try {
        const messages = buildAiMatchPrompt(needs, resume);
        const response = await ai(messages, 1200, true);
        const data = await parseAiJson(response.text);
        matches = applyAiResults(matches, data, state.fillScanFields, resume);
      } catch (_error) {
        // AI 失败不阻塞：未识别字段保持「需手动」
      }
    }
  }
  setFillMatches(matches);
  setFillSelected(new Set(matches.filter(m => m.status === "match" && m.value).map(m => m.fieldId)));
  setFillValues(Object.fromEntries(matches.map(m => [m.fieldId, m.value])));
  renderFillMatches();
}

// —— 匹配列表渲染 ——
const CONF_LABEL = { high: "高", medium: "中", low: "低" };
const SRC_LABEL = { template: "模板", rule: "规则", ai: "AI", manual: "手动" };

function updateFillButtons() {
  const matches = state.fillMatches;
  const count = matches.filter(m => m.status === "match" && state.fillSelected.has(m.fieldId)).length;
  const matched = matches.filter(m => m.status === "match").length;
  const btn = $("fillSelected");
  const showFooter = count > 0 && (!state.fillAutoMode || count < matched);
  btn.disabled = !count;
  btn.hidden = !showFooter;
  btn.textContent = `填充勾选项（${count}）`;
  $("clearFill").hidden = !state.fillScanFields.length;
}

function resumeBindingChoices() {
  const resume = activeProfile()?.resumeFields || {};
  const choices = Object.entries(RESUME_FIELD_LABELS).map(([key, label]) => ({ value: key, label }));
  const appendEntries = (arrayKey, keyMap, title) => {
    const entries = Array.isArray(resume[arrayKey]) ? resume[arrayKey] : [];
    entries.forEach((_entry, index) => {
      for (const [fieldKey, entryKey] of Object.entries(keyMap)) {
        choices.push({
          value: `${fieldKey}@@${arrayKey}[${index}].${entryKey}`,
          label: `${title} ${index + 1} · ${RESUME_FIELD_LABELS[fieldKey] || fieldKey}`,
        });
      }
    });
  };
  appendEntries("education", {
    school: "school", schoolLocation: "schoolLocation", college: "college",
    degree: "degree", major: "major", educationStart: "start",
    graduationYear: "end", studyMode: "studyMode",
  }, "教育经历");
  appendEntries("workHistory", {
    currentCompany: "company", workIndustry: "industry", workLocation: "location",
    currentTitle: "title", workStart: "start", workEnd: "end", workDescription: "description",
  }, "工作经历");
  appendEntries("internships", {
    internshipCompany: "company", internshipIndustry: "industry", internshipLocation: "location",
    internshipTitle: "title", internshipStart: "start",
    internshipEnd: "end", internshipDescription: "description",
  }, "实习经历");
  appendEntries("projects", {
    projectName: "name", projectCompany: "company", projectRole: "role",
    projectStart: "start", projectEnd: "end", projectDescription: "description",
    projectResponsibility: "responsibility",
  }, "项目经历");
  return choices;
}

// 失败行原因文案：打字重填（模拟输入后仍失败）明确引导手动填写，其余失败保持匹配阶段原文案。
function fillFailureReason(match) {
  if (match.fillError && match.fillError.includes("模拟输入后仍失败")) return "已尝试模拟输入仍失败，请手动填写";
  return match.reason || "";
}

function matchRowHtml(match) {
  const selected = state.fillSelected.has(match.fieldId);
  const value = state.fillValues[match.fieldId] ?? match.value ?? "";
  const editable = !match.skipped && (match.status === "match" || !!match.fieldKey);
  const keyEditable = !match.skipped;
  const bindingChoice = match.valueRef?.source === "resume" && match.valueRef.path !== match.fieldKey
    ? `${match.fieldKey}@@${match.valueRef.path}`
    : match.fieldKey || "";
  const badges = [
    `<span class="fill-badge type">${escapeHtml(match.type)}</span>`,
    match.confidence ? `<span class="fill-badge conf-${match.confidence}">置信${CONF_LABEL[match.confidence]}</span>` : "",
    `<span class="fill-badge src-${match.source}">${SRC_LABEL[match.source] || match.source}</span>`,
    match.status === "manual" ? `<span class="fill-badge status-manual">需手动</span>` : "",
  ].filter(Boolean).join("");
  const evidence = (match.evidence || []).slice(0, 2).map(item => `${item.source}:${item.text}`).join(" · ");
  return `<div class="fill-row${match.status === "manual" ? " manual" : ""}">
    <input type="checkbox" data-fill-id="${match.fieldId}" ${selected ? "checked" : ""} ${editable ? "" : "disabled"}>
    <div class="fill-row-main">
      <div class="fill-row-label">${escapeHtml(match.label || "（未识别标签）")}${match.required ? `<span class="req">*</span>` : ""}${badges}</div>
      <input type="text" list="fillFieldKeyOptions" data-fill-key-id="${match.fieldId}" value="${escapeHtml(bindingChoice)}" ${keyEditable ? "" : "disabled"} placeholder="搜索并选择简历字段">
      <input type="text" data-fill-value-id="${match.fieldId}" value="${escapeHtml(value)}" ${editable ? "" : "disabled"} placeholder="${editable ? (match.status === "match" ? "可手动修改" : "可手动填写，完成后确认") : "选择正确的简历字段后启用"}">
      <div class="fill-meta">${escapeHtml(fillFailureReason(match))}${evidence ? ` · ${escapeHtml(evidence)}` : ""}</div>
    </div>
  </div>`;
}

export function renderFillMatches() {
  const target = $("fillResultList");
  const matches = state.fillMatches;
  if (!target) return;
  if (!matches.length) {
    target.innerHTML = `<p class="hint">扫描后这里会显示识别结果与匹配建议。</p>`;
    updateFillButtons();
    return;
  }
  const fieldKeyOptions = resumeBindingChoices()
    .map(choice => `<option value="${escapeHtml(choice.value)}">${escapeHtml(choice.label)}</option>`)
    .join("");
  const datalist = `<datalist id="fillFieldKeyOptions">${fieldKeyOptions}</datalist>`;
  if (fillResultMode === "summary") {
    const manual = matches.filter(m => m.status === "manual" || state.fillFailedIds.includes(m.fieldId));
    const filled = matches.filter(m => m.status === "match" && !state.fillFailedIds.includes(m.fieldId));
    target.innerHTML = datalist + (manual.length
      ? `<details class="fill-summary-manual" open><summary>需人工处理（${manual.length}）</summary>${manual.map(matchRowHtml).join("")}</details>`
      : `<p class="hint fill-done-tip">🎉 全部 ${filled.length} 项已填充</p>`)
      + `<details class="fill-summary-done"><summary>已自动填充（${filled.length}）</summary>${filled.map(matchRowHtml).join("")}</details>`;
  } else {
    target.innerHTML = datalist + matches.map(matchRowHtml).join("");
  }
  updateFillButtons();
}

// —— 填充执行 ——
let fillRunning = false;

export async function runFill(all = false) {
  if (fillRunning) throw new Error("填充进行中，请等待完成或点击停止。");
  if (!state.fillMatches.length) throw new Error("请先扫描页面。");
  const session = state.fillScanSession;
  if (!session?.scanId || !session?.tabId) throw new Error("扫描会话已失效，请重新扫描页面。");
  const tab = await currentTab();
  if (!tab || tab.id !== session.tabId) throw new Error("当前标签页不是刚才扫描的页面，请切回后重新扫描。");
  const resume = activeProfile()?.resumeFields || {};
  const selectedMatches = state.fillMatches.filter(match => match.status === "match" && (all || state.fillSelected.has(match.fieldId)));
  const fills = selectedMatches.map(match => {
    const field = state.fillScanFields.find(item => item.id === match.fieldId) || match;
    const value = state.fillValues[match.fieldId] ?? match.value;
    const validated = validateBinding(field, match.fieldKey, resume, {
      source: "manual",
      confidence: "high",
      userConfirmed: true,
      valueOverride: value,
      reason: "填充前本地校验通过",
    });
    if (validated.status !== "match") throw new Error(`${match.label || "字段"}：${validated.reason}`);
    return { id: match.fieldId, value: validated.value, type: match.type, fingerprint: match.fingerprint, fieldKey: match.fieldKey };
  });
  if (!fills.length) throw new Error(all ? "没有可填充的表单项。" : "请先勾选要填充的表单项。");
  fillRunning = true;
  $("smartFillOnce").disabled = true;
  $("clearFill").disabled = true;
  $("fillSelected").disabled = true;
  const start = Date.now();
  $("fillProgress").textContent = `正在填充 0/${fills.length}…`;
  $("stopFill").hidden = false;
  try {
    const response = await fillMessagePage(tab, {
      type: "SMART_FILL_APPLY",
      scanId: session.scanId,
      documentFingerprint: session.documentFingerprint,
      formFingerprint: session.formFingerprint,
      fills,
    });
    if (!response?.ok) throw new Error(response?.error || "填充失败");
    const results = response.results || [];
    const fillById = new Map(fills.map(fill => [fill.id, fill]));
    if (results.some(result => result.ok && result.resolvedFingerprint !== fillById.get(result.id)?.fingerprint)) {
      throw new Error("字段目标校验不一致，已停止记录本次填充结果。");
    }
    const summary = summarizeResults(results);
    const failedIds = results.filter(r => !r.ok).map(r => r.id);
    setFillFailedIds(failedIds);
    // 记录失败原因到对应 match，供失败行渲染区分「打字重填仍失败」等路径
    for (const result of results) {
      const match = state.fillMatches.find(item => item.fieldId === result.id);
      if (!match) continue;
      match.fillError = result.ok ? "" : (result.error || "");
    }
    if (failedIds.length) {
      fillMessagePage(tab, { type: "SMART_FILL_HIGHLIGHT", ids: failedIds, on: true }).catch(() => {});
    }
    $("fillProgress").textContent = `填充完成：成功 ${summary.ok} / ${summary.total}${failedIds.length ? `，${failedIds.length} 项需手动处理（已在页面高亮）` : ""}`;
    await afterFill(tab, results, Date.now() - start);
    if (state.fillAutoMode) {
      fillResultMode = "summary";
      renderFillMatches();
    }
    if (summary.ok > 0) startIncrementalWatch();
    return { summary, failedIds };
  } finally {
    fillRunning = false;
    $("stopFill").hidden = true;
    $("smartFillOnce").disabled = false;
    $("clearFill").disabled = false;
    updateFillButtons();
  }
}

export async function stopFill() {
  const session = state.fillScanSession;
  const tab = session?.tabId ? { id: session.tabId, url: session.url } : await currentTab();
  if (tab?.id && tab?.url && /^https?:/i.test(tab.url)) {
    fillMessagePage(tab, { type: "SMART_FILL_CANCEL" }).catch(() => {});
    fillMessagePage(tab, { type: "SMART_FILL_WATCH_STOP" }).catch(() => {});
  }
  $("fillProgress").textContent = "已请求停止填充…";
}

export async function clearFill() {
  stopIncrementalWatch();
  const session = state.fillScanSession;
  const tab = session?.tabId ? { id: session.tabId, url: session.url } : await currentTab();
  if (tab?.id && tab?.url && /^https?:/i.test(tab.url) && state.fillFailedIds.length) {
    fillMessagePage(tab, { type: "SMART_FILL_HIGHLIGHT", ids: state.fillFailedIds, on: false }).catch(() => {});
  }
  fillResultMode = "list";
  setFillScanFields([]);
  setFillScanPage(null);
  setFillScanSession(null);
  setFillRepeaters([]);
  setFillMatches([]);
  setFillSelected(new Set());
  setFillValues({});
  setFillFailedIds([]);
  $("fillResultList").innerHTML = "";
  $("fillProgress").textContent = "";
  $("fillCurrentSite").textContent = "未检测到网申页面。请打开目标公司的网申/信息录入页后点击「一键智能填充」。首次使用需授权该网站。";
  $("fillCurrentSiteText").textContent = "";
  renderFillTemplate();
  updateFillButtons();
}

async function afterFill(tab, results, durationMs) {
  const host = state.fillScanPage?.host || "";
  if (state.fillTemplateEnabled && host) {
    const templates = await getTemplates();
    const storageKey = currentTemplateStorageKey();
    const okIds = new Set(results.filter(r => r.ok).map(r => r.id));
    // 仅成功字段的语义映射入模板；Template V2 不保存具体填写值。
    const templateMatches = state.fillMatches.map(m => {
      if (!okIds.has(m.fieldId)) return { ...m, status: "manual" };
      return { ...m, value: state.fillValues[m.fieldId] ?? m.value, edited: state.fillValues[m.fieldId] !== m.value };
    });
    templates[storageKey] = saveTemplateFromResults(
      host,
      state.fillScanPage?.url || tab.url,
      templateMatches,
      templates[storageKey],
      { formFingerprint: state.fillScanSession?.formFingerprint || "" }
    );
    await chrome.storage.local.set({ smartFillTemplates: capTemplates(templates) });
    renderFillTemplate();
  }
  const logs = await getFillLogs();
  const matched = state.fillMatches.filter(m => m.status === "match").length;
  const manual = state.fillMatches.filter(m => m.status === "manual").length;
  const corrections = state.fillMatches.filter(m => state.fillValues[m.fieldId] !== m.value).length;
  await chrome.storage.local.set({
    smartFillLogs: appendFillLog(logs, {
      host,
      url: state.fillScanPage?.url || tab.url,
      total: state.fillMatches.length,
      matched,
      filled: results.length,
      success: results.filter(r => r.ok).length,
      manual,
      corrections,
      durationMs,
    }),
  });
  renderFillLogs();
}

// —— 模板与历史 ——
export async function renderFillTemplate() {
  const host = state.fillScanPage?.host || "";
  const templates = await getTemplates();
  const storageKey = currentTemplateStorageKey();
  const template = templates[storageKey];
  const legacy = host ? templates[host] : null;
  const info = $("fillTemplateInfo");
  const button = $("deleteFillTemplate");
  if (!info || !button) return;
  if (!template) {
    const hasLegacy = legacy && legacy.schemaVersion !== 2;
    info.textContent = hasLegacy ? "检测到旧版模板，已停止自动套用；可删除或在成功填充后生成安全模板" : "未保存模板";
    button.disabled = !hasLegacy;
    $("fillTemplateList").innerHTML = "";
    return;
  }
  const mappings = template.mappings || [];
  info.textContent = `${host} · ${mappings.length} 个语义映射 · ${String(template.updatedAt || "").slice(0, 10)}`;
  button.disabled = false;
  $("fillTemplateList").innerHTML = mappings.length
    ? mappings.map(mapping => `<div class="fill-template-item">${escapeHtml(mapping.siteLabel || mapping.fieldKey)} → ${escapeHtml(RESUME_FIELD_LABELS[mapping.fieldKey] || mapping.fieldKey)}${mapping.userConfirmed ? "（已确认）" : ""}</div>`).join("")
    : `<p class="hint">模板为空</p>`;
}

export async function deleteFillTemplate() {
  const host = state.fillScanPage?.host;
  if (!host) return;
  if (!confirm(`删除 ${host} 的站点模板？`)) return;
  const templates = await getTemplates();
  delete templates[currentTemplateStorageKey()];
  delete templates[host];
  await chrome.storage.local.set({ smartFillTemplates: templates });
  toast("已删除站点模板");
  renderFillTemplate();
}

export async function renderFillLogs() {
  const logs = await getFillLogs();
  const target = $("fillLogList");
  if (!target) return;
  target.innerHTML = logs.length
    ? logs.slice(0, 20).map(log => `<div class="fill-log-item">${escapeHtml(log.host || "未知站点")} · 成功 ${log.success ?? 0}/${log.filled ?? 0}<small>${escapeHtml(log.time || "")} · ${escapeHtml(log.url || "")}</small></div>`).join("")
    : `<p class="hint">暂无填充记录。</p>`;
}

// —— 初始化与事件 ——
export function rebindFillField(fieldId, fieldKey) {
  const field = state.fillScanFields.find(item => item.id === fieldId);
  const match = state.fillMatches.find(item => item.fieldId === fieldId);
  if (!field || !match) return;
  const choice = String(fieldKey || "").trim();
  const [key, valuePath] = choice.split("@@", 2);
  const validated = key
    ? validateBinding(field, key, activeProfile()?.resumeFields || {}, {
      source: "manual",
      confidence: "high",
      userConfirmed: true,
      valueRef: { source: "resume", path: valuePath || key },
      reason: "用户确认字段语义",
    })
    : { ...match, fieldKey: "", value: "", confidence: null, source: "manual", status: "manual", reason: "未选择简历字段", userConfirmed: true };
  const nextMatches = state.fillMatches.map(item => item.fieldId === fieldId ? { ...item, ...validated, source: "manual", userConfirmed: true } : item);
  setFillMatches(nextMatches);
  state.fillValues[fieldId] = validated.value || "";
  const selected = new Set(state.fillSelected);
  if (validated.status === "match" && validated.value) selected.add(fieldId);
  else selected.delete(fieldId);
  setFillSelected(selected);
  renderFillMatches();
}

export function confirmManualFillValue(fieldId, value) {
  const field = state.fillScanFields.find(item => item.id === fieldId);
  const match = state.fillMatches.find(item => item.fieldId === fieldId);
  if (!field || !match?.fieldKey) return;
  const validated = validateBinding(field, match.fieldKey, activeProfile()?.resumeFields || {}, {
    source: "manual",
    confidence: "high",
    userConfirmed: true,
    valueOverride: String(value || "").trim(),
    reason: "用户确认填写值",
  });
  const nextMatches = state.fillMatches.map(item =>
    item.fieldId === fieldId
      ? { ...item, ...validated, source: "manual", userConfirmed: true, edited: true }
      : item
  );
  setFillMatches(nextMatches);
  state.fillValues[fieldId] = validated.value || String(value || "").trim();
  const selected = new Set(state.fillSelected);
  if (validated.status === "match" && validated.value) selected.add(fieldId);
  else selected.delete(fieldId);
  setFillSelected(selected);
  renderFillMatches();
}

export async function changeFillProfile(index) {
  const savedDraft = state.resumeFieldsDirty;
  if (savedDraft) await saveResumeFields({ silent: true, rebuild: false });
  await switchProfile(index);
  renderFillProfileSelect();
  renderResumeFields();
  if (state.fillScanFields.length) await buildMatches();
  return savedDraft;
}

// 一键智能填充：扫描 → 自动填充已匹配（高置信）项；未匹配/需手动项保留预览确认。
// 受「自动填充高置信项」开关（state.fillAutoMode）控制。
export async function runSmartFillOnce() {
  if (fillRunning) throw new Error("填充进行中，请等待完成或点击停止。");
  const ok = await scanFillPage();
  if (!ok) return; // scanFillPage 内部已 toast 错误
  // 自动展开经历（失败降级：继续填充已扫到的字段）
  if (computeRepeaterAdditions() > 0) {
    try {
      await prepareFillSections();
    } catch (_error) {
      // 展开失败已 toast，不中断一键流程
    }
  }
  if (!state.fillMatches.some(match => match.status === "match")) {
    toast("未发现可自动填充的字段，请在列表中手动确认");
    return;
  }
  if (!state.fillAutoMode) {
    toast("已扫描，请在预览中勾选后点击「填充勾选项」");
    return;
  }
  const result = await runFill(false);
  toast(`一键填充完成：成功 ${result.summary.ok}/${result.summary.total}${result.failedIds.length ? `，${result.failedIds.length} 项需手动处理（已在页面高亮）` : ""}`);
}

// 点击字段填充：从简历资料编辑器发起拾取态，用户点击页面目标后单字段填入。
export async function startPickFill(fieldKey) {
  const resume = ensureResumeDraft();
  const value = String(resume[fieldKey] || "").trim();
  if (!value) throw new Error("该简历字段暂无内容，请先填写。");
  const session = state.fillScanSession;
  const tab = session?.tabId ? { id: session.tabId, url: session.url || "" } : await currentTab();
  if (!tab?.id || !/^https?:/i.test(tab.url || "")) throw new Error("请先打开目标网申页面并扫描。");
  const requestId = `pick-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  state.pickFillRequestId = requestId;
  const response = await fillMessagePage(tab, { type: "SMART_FILL_PICK_START", value, requestId });
  if (!response?.ok) throw new Error(response?.error || "进入点击填充失败");
  toast("请在页面点击要填入的位置（Esc 取消）");
}

// 选区填充：进入选区拾取态，用户点击页面容器后按选区内字段渲染匹配。
// content 拾取到容器后直接回传该容器的 scan 结果（SMART_FILL_PICK_REGION_RESULT）。
export async function startPickRegion() {
  const session = state.fillScanSession;
  const tab = session?.tabId ? { id: session.tabId, url: session.url || "" } : await currentTab();
  if (!tab?.id || !/^https?:/i.test(tab.url || "")) throw new Error("请先打开目标网申页面。");
  const requestId = `region-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  pickRegionRequestId = requestId;
  const response = await fillMessagePage(tab, { type: "SMART_FILL_PICK_REGION", requestId });
  if (!response?.ok) throw new Error(response?.error || "进入选区拾取失败");
  toast("请在页面点击要填充的容器（Esc 取消）");
}

// —— 增量续填（P1 任务6） ——
function startIncrementalWatch() {
  const session = state.fillScanSession;
  if (!session?.tabId) return;
  fillMessagePage({ id: session.tabId }, { type: "SMART_FILL_WATCH_START", threshold: 4 }).catch(() => {});
}
function stopIncrementalWatch() {
  const session = state.fillScanSession;
  if (!session?.tabId) return;
  fillMessagePage({ id: session.tabId }, { type: "SMART_FILL_WATCH_STOP" }).catch(() => {});
}
function showContinueFillPrompt(count) {
  const button = $("continueFill");
  if (!button) return;
  button.textContent = `继续填写（${count} 个新字段）`;
  button.hidden = false;
}
function hideContinueFillPrompt() {
  const button = $("continueFill");
  if (button) button.hidden = true;
}

// 继续填写：仅重新扫描并填充新增字段（引擎按已见标记过滤），最多 3 轮。
async function continueFill() {
  if (fillRunning) throw new Error("填充进行中，请等待完成或点击停止。");
  hideContinueFillPrompt();
  if (state.fillContinueRounds >= 3) { stopIncrementalWatch(); return; }
  const session = state.fillScanSession;
  const tab = session?.tabId ? { id: session.tabId, url: session.url || "" } : await currentTab();
  if (!tab?.id || !/^https?:/i.test(tab.url || "")) throw new Error("请先打开目标网申页面。");
  const response = await fillMessagePage(tab, { type: "SMART_FILL_SCAN", onlyNew: true });
  if (!response?.ok) throw new Error(response?.error || "扫描失败");
  const newFields = response.fields || [];
  if (!newFields.length) { toast("没有发现新的可填字段"); return; }
  applyScanResponse(response, tab);
  await buildMatches();
  await renderFillTemplate();
  if (!state.fillMatches.some(match => match.status === "match")) { toast("新增字段无自动匹配项"); return; }
  const result = await runFill(false);
  state.fillContinueRounds += 1;
  toast(`已继续填充：成功 ${result.summary.ok}/${result.summary.total}`);
}

// 面板运行时消息处理（内容脚本经 background 中继回传）。
export function handleFillRuntimeMessage(message) {
  if (!message || typeof message !== "object") return;
  if (message.type === "SMART_FILL_NEW_FIELDS") {
    if (!state.fillScanSession || (message.scanId && message.scanId !== state.fillScanSession.scanId)) return;
    if (state.fillContinueRounds >= 3) { stopIncrementalWatch(); return; }
    showContinueFillPrompt(message.count || 0);
    return;
  }
  if (message.type === "SMART_FILL_PICK_RESULT") {
    if (state.pickFillRequestId && message.requestId !== state.pickFillRequestId) return;
    state.pickFillRequestId = null;
    if (message.cancelled) toast("已取消点击填充");
    else if (!message.ok) toast(`点击填充失败：${message.error || "未知错误"}`);
    else toast(`已填入「${message.value ?? ""}」`);
    return;
  }
  if (message.type === "SMART_FILL_PICK_REGION_RESULT") {
    applyRegionFillResult(message);
    return;
  }
  if (message.type === "SMART_FILL_PROGRESS") {
    const progress = $("fillProgress");
    if (progress) progress.textContent = `正在填充 ${message.index}/${message.total}…${message.error ? `（${message.error}）` : ""}`;
  }
}

// 选区拾取结果：用选区内字段重建扫描会话与匹配列表（复用现有渲染管线）。
// 引擎拾取时以 dryRun 扫描（不写全局会话），这里用 region 选择器经 SMART_FILL_SCAN 重扫一次，
// 建立真实 content 会话后再渲染；0 字段或重扫失败时不改任何会话，避免 content/panel 脱同步。
async function applyRegionFillResult(message) {
  try {
    if (pickRegionRequestId && message.requestId !== pickRegionRequestId) return;
    pickRegionRequestId = null;
    if (message.cancelled) { toast("已取消选区填充"); return; }
    if (!message.ok) { toast(`选区填充失败：${message.error || "未知错误"}`); return; }
    const previewFields = message.fields || [];
    if (!previewFields.length) { toast("选区内未识别到可填字段，请重新选择更完整的容器"); return; }
    const session = state.fillScanSession;
    const tab = session?.tabId ? { id: session.tabId, url: session.url || "" } : await currentTab();
    if (!tab?.id || !/^https?:/i.test(tab.url || "")) throw new Error("找不到目标页面，请重新扫描");
    const regionPath = message.regionPath || "";
    if (!regionPath) throw new Error("选区路径缺失，请重新选择");
    const response = await fillMessagePage(tab, { type: "SMART_FILL_SCAN", region: regionPath });
    if (!response?.ok) throw new Error(response?.error || "重建选区扫描失败");
    const fields = response.fields || [];
    if (!fields.length) { toast("选区内未识别到可填字段，请重新选择更完整的容器"); return; }
    stopIncrementalWatch();
    fillResultMode = "list";
    applyScanResponse(response, tab);
    const regionName = message.regionLabel || regionPath || "已选区域";
    $("fillCurrentSite").textContent = "";
    $("fillCurrentSiteText").textContent = `选区「${regionName}」：识别到 ${fields.length} 个表单项`;
    $("clearFill").hidden = false;
    await buildMatches();
    await renderFillTemplate();
    toast(`已识别选区内 ${fields.length} 个字段`);
  } catch (error) {
    toast(`选区填充失败：${error.message || String(error)}`);
  }
}

// 智能填充工具条：动态创建「选区填充」按钮（不依赖 panel.html 静态骨架）。
// 点击后进入选区拾取态，用户点选页面容器，仅识别并填充该容器内的字段。
function ensureRegionFillButton() {
  const actions = document.querySelector(".fill-actions");
  if (!actions || document.getElementById("regionFill")) return;
  const button = document.createElement("button");
  button.id = "regionFill";
  button.type = "button";
  button.className = "secondary";
  button.textContent = "选区填充";
  button.title = "点选页面某个容器（如紧急联系人区块），只识别并填充该容器内的字段";
  button.onclick = () => startPickRegion().catch(error => toast(error.message));
  actions.appendChild(button);
}

function bindFillEvents() {
  ensureRegionFillButton();
  $("smartFillOnce").onclick = () => runSmartFillOnce().catch(error => toast(error.message));
  $("fillSelected").onclick = () => runFill(false).catch(error => toast(error.message));
  $("stopFill").onclick = () => stopFill().catch(error => toast(error.message));
  $("clearFill").onclick = () => clearFill().catch(error => toast(error.message));
  $("continueFill").onclick = () => continueFill().catch(error => toast(error.message));
  $("extractResumeFields").onclick = () => extractResumeFields().catch(error => toast(error.message));
  $("saveResumeFields").onclick = () => saveResumeFields().catch(error => toast(error.message));
  $("manageResumeFields").onclick = () => openResumeFieldsEditor();
  $("closeResumeFieldsEditor").onclick = () => closeResumeFieldsEditor();
  $("discardResumeFields").onclick = () => {
    if (!state.resumeFieldsDirty || confirm("放弃当前未保存的简历资料修改？")) discardResumeFields();
  };
  $("deleteFillTemplate").onclick = () => deleteFillTemplate().catch(error => toast(error.message));
  $("fillProfileSelect").onchange = async (event) => {
    try {
      const savedDraft = await changeFillProfile(parseInt(event.target.value, 10));
      toast(`${savedDraft ? "已自动保存修改并" : "已"}切换到"${activeProfile()?.name || "未命名"}"`);
    } catch (error) {
      renderFillProfileSelect();
      toast(error.message);
    }
  };
  $("fillAiToggle").onchange = (event) => {
    setFillAiEnabled(event.target.checked);
    chrome.storage.local.set({ smartFillSettings: { aiEnabled: state.fillAiEnabled, templateEnabled: state.fillTemplateEnabled, autoMode: state.fillAutoMode } }).catch(() => {});
    if (state.fillMatches.length) buildMatches().catch(() => {});
  };
  $("fillTemplateToggle").onchange = (event) => {
    setFillTemplateEnabled(event.target.checked);
    chrome.storage.local.set({ smartFillSettings: { aiEnabled: state.fillAiEnabled, templateEnabled: state.fillTemplateEnabled, autoMode: state.fillAutoMode } }).catch(() => {});
  };
  $("fillAutoToggle").onchange = (event) => {
    setFillAutoMode(event.target.checked);
    chrome.storage.local.set({ smartFillSettings: { aiEnabled: state.fillAiEnabled, templateEnabled: state.fillTemplateEnabled, autoMode: state.fillAutoMode } }).catch(() => {});
  };
  document.addEventListener("change", (event) => {
    if (updateResumeDraftFromControl(event.target)) return;
    const keyInput = event.target.closest("input[data-fill-key-id]");
    if (keyInput) {
      rebindFillField(keyInput.dataset.fillKeyId, keyInput.value);
      return;
    }
    const valueInput = event.target.closest("input[data-fill-value-id]");
    if (valueInput) {
      confirmManualFillValue(valueInput.dataset.fillValueId, valueInput.value);
      return;
    }
    const checkbox = event.target.closest("input[data-fill-id]");
    if (!checkbox) return;
    const next = new Set(state.fillSelected);
    if (checkbox.checked) next.add(checkbox.dataset.fillId);
    else next.delete(checkbox.dataset.fillId);
    setFillSelected(next);
    updateFillButtons();
  });
  document.addEventListener("input", (event) => {
    if (event.target.id === "resumeFieldSearch") {
      syncResumeDraftFromDom();
      resumeFieldSearch = event.target.value.trim().toLowerCase();
      renderResumeFields();
      return;
    }
    if (updateResumeDraftFromControl(event.target)) return;
    const valueInput = event.target.closest("input[data-fill-value-id]");
    if (valueInput) {
      const fieldId = valueInput.dataset.fillValueId;
      state.fillValues[fieldId] = valueInput.value;
      const match = state.fillMatches.find(item => item.fieldId === fieldId);
      if (match) match.edited = valueInput.value !== match.value;
    }
  });
  document.addEventListener("click", (event) => {
    const pickButton = event.target.closest("[data-pick-field-key]");
    if (pickButton) {
      event.preventDefault();
      startPickFill(pickButton.dataset.pickFieldKey).catch(error => toast(error.message));
      return;
    }
    const filterButton = event.target.closest("[data-resume-filter]");
    if (filterButton) {
      setResumeFieldFilter(filterButton.dataset.resumeFilter);
      return;
    }
    const addButton = event.target.closest("[data-add-entry]");
    if (addButton) {
      event.preventDefault();
      addResumeEntry(addButton.dataset.addEntry);
      return;
    }
    const removeButton = event.target.closest("[data-remove-entry]");
    if (removeButton) {
      event.preventDefault();
      event.stopPropagation();
      const [groupKey, id] = removeButton.dataset.removeEntry.split("|");
      removeResumeEntry(groupKey, id);
      return;
    }
  });
  chrome.runtime.onMessage.addListener(handleFillRuntimeMessage);
}

export async function initFillUi() {
  const { smartFillSettings = {} } = await chrome.storage.local.get("smartFillSettings");
  setFillAiEnabled(smartFillSettings.aiEnabled !== false);
  setFillTemplateEnabled(smartFillSettings.templateEnabled !== false);
  setFillAutoMode(smartFillSettings.autoMode !== false);
  $("fillAiToggle").checked = state.fillAiEnabled;
  $("fillTemplateToggle").checked = state.fillTemplateEnabled;
  $("fillAutoToggle").checked = state.fillAutoMode;
  renderFillProfileSelect();
  renderResumeFields();
  renderFillLogs();
  renderFillTemplate();
  bindFillEvents();
}

// 简历变更后刷新智能填充页（设置页切换/增删简历时调用）。
export function refreshFillUi() {
  renderFillProfileSelect();
  ensureResumeDraft();
  renderResumeFields();
  if (state.fillScanFields.length) buildMatches().catch(() => {});
}
