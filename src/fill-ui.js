// 智能填充：侧边栏交互逻辑（扫描/匹配/填充/模板/历史）。
import { state, activeProfile, setFillScanFields, setFillScanPage, setFillMatches, setFillSelected, setFillValues, setFillFailedIds, setFillAiEnabled, setFillTemplateEnabled } from "./state.js";
import { $, toast, fillMessagePage } from "./chrome-helpers.js";
import { escapeHtml } from "./pure-utils.js";
import { RESUME_FIELD_LABELS, GROUP_LABELS } from "./form-fields.js";
import { matchRules, applyAiResults, buildAiMatchPrompt } from "./matcher.js";
import { applyTemplate, saveTemplateFromResults, capTemplates } from "./site-templates.js";
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

// 经历类分组用卡片编辑器管理（教育/实习/项目），其余分组为紧凑标量表单。
const SCALAR_GROUPS = ["basic", "intention", "work", "profile", "other"];

function entryCardHtml(group, entry, index) {
  const fields = group.fields.map(field => field.textarea
    ? `<label>${escapeHtml(field.label)}<textarea rows="3" data-entry-input="${group.resumeKey}|${entry.id}|${field.key}">${escapeHtml(entry[field.key] || "")}</textarea></label>`
    : `<label>${escapeHtml(field.label)}<input type="text" data-entry-input="${group.resumeKey}|${entry.id}|${field.key}" value="${escapeHtml(entry[field.key] || "")}"></label>`
  ).join("");
  return `<details class="resume-entry-card" data-entry-id="${entry.id}" open>
    <summary>${escapeHtml(group.summary(entry) || `（第 ${index + 1} 条，未填写）`)}</summary>
    <div class="resume-entry-fields">${fields}</div>
    <div class="resume-entry-actions"><button type="button" class="text-button danger" data-remove-entry="${group.resumeKey}|${entry.id}">删除本条</button></div>
  </details>`;
}

export function renderResumeFields() {
  const list = $("resumeFieldsList");
  const profile = activeProfile();
  const resume = profile?.resumeFields || {};
  if (!list) return;
  const scalarHtml = RESUME_FIELDS_SCHEMA
    .filter(field => SCALAR_GROUPS.includes(field.group))
    .map(field => `<label>${escapeHtml(field.label)}<input type="text" data-resume-key="${field.key}" value="${escapeHtml(resume[field.key] || "")}"></label>`)
    .join("");
  const entriesHtml = ENTRY_GROUPS.map(group => {
    const entries = Array.isArray(resume[group.resumeKey]) ? resume[group.resumeKey] : [];
    const cards = entries.map((entry, index) => entryCardHtml(group, entry, index)).join("");
    return `<div class="resume-entries-group" data-entry-group="${group.resumeKey}">
      <div class="resume-entries-head"><b>${escapeHtml(group.title)}</b><span class="resume-entry-count">${entries.length} 条</span><button type="button" class="text-button" data-add-entry="${group.resumeKey}">+ 添加</button></div>
      ${cards || `<p class="hint">暂无${escapeHtml(group.title)}，点击「添加」手动填写。</p>`}
    </div>`;
  }).join("");
  list.innerHTML = `<div class="resume-fields-grid">${scalarHtml}</div>${entriesHtml}`;
  const filled = Object.values(resume).filter(value => (Array.isArray(value) ? value.length : value)).length;
  $("resumeFieldsStatus").textContent = `（${filled} 项已填写）`;
}

// 从 DOM 收集标量与经历条目（空条目自动剔除）。
export function collectResumeFields() {
  const scalars = Object.fromEntries(
    [...document.querySelectorAll("[data-resume-key]")].map(el => [el.dataset.resumeKey, el.value.trim()])
  );
  const entries = {};
  for (const group of ENTRY_GROUPS) {
    const list = [];
    for (const card of [...document.querySelectorAll(`[data-entry-group="${group.resumeKey}"] [data-entry-id]`)]) {
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

export async function saveResumeFields() {
  const profile = activeProfile();
  if (!profile) throw new Error("未找到当前简历。");
  profile.resumeFields = aggregateResumeFields(collectResumeFields());
  await saveProfiles();
  toast("简历字段已保存（经历条目已同步聚合到匹配字段）");
  renderResumeFields();
}

let entrySeq = 0;
export function addResumeEntry(groupKey) {
  const profile = activeProfile();
  if (!profile) return;
  const group = ENTRY_GROUPS.find(g => g.resumeKey === groupKey);
  if (!group) return;
  const list = Array.isArray(profile.resumeFields[groupKey]) ? profile.resumeFields[groupKey] : [];
  list.push(group.empty(entrySeq++));
  profile.resumeFields[groupKey] = list;
  renderResumeFields();
}

export function removeResumeEntry(groupKey, id) {
  const profile = activeProfile();
  if (!profile) return;
  profile.resumeFields[groupKey] = (profile.resumeFields[groupKey] || []).filter(entry => entry.id !== id);
  renderResumeFields();
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
    profile.resumeFields = merged;
    await saveProfiles();
    renderResumeFields();
    toast("简历字段提取完成，请检查后保存");
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
  const button = $("scanFillPage");
  button.disabled = true;
  try {
    const tab = await currentTab();
    if (!tab?.url || !/^https?:/i.test(tab.url)) throw new Error("请先打开目标公司的网申页面。");
    const pageUrl = new URL(tab.url);
    if (/(^|\.)zhipin\.com$/.test(pageUrl.hostname)) throw new Error("BOSS 直聘没有网申表单，请打开其他公司的网申页面。");
    await ensureOriginPermission(tab);
    const response = await fillMessagePage(tab, { type: "SMART_FILL_SCAN" });
    if (!response?.ok) throw new Error(response?.error || "扫描失败");
    const fields = response.fields || [];
    if (!fields.length) throw new Error("未检测到可填写的表单项。");
    setFillScanFields(fields);
    setFillScanPage(response.page || { title: tab.title || "", url: tab.url, host: pageUrl.hostname });
    $("fillCurrentSite").textContent = `当前站点：${pageUrl.hostname}（识别到 ${fields.length} 个表单项）`;
    await buildMatches();
    await renderFillTemplate();
    toast(`已识别 ${fields.length} 个表单项`);
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function buildMatches() {
  const resume = activeProfile()?.resumeFields || {};
  const host = state.fillScanPage?.host || "";
  let matches = matchRules(state.fillScanFields, resume);
  const templates = await getTemplates();
  matches = applyTemplate(matches, templates[host] || null);
  if (state.fillAiEnabled && state.config.apiKey) {
    const needs = matches.filter(m => m.status === "manual" || m.confidence === "low");
    if (needs.length) {
      try {
        const messages = buildAiMatchPrompt(needs, resume);
        const response = await ai(messages, 1200, true);
        const data = await parseAiJson(response.text);
        matches = applyAiResults(matches, data);
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
  const count = state.fillMatches.filter(m => m.status === "match" && state.fillSelected.has(m.fieldId)).length;
  $("fillSelected").disabled = !count;
  $("fillAll").disabled = !state.fillMatches.some(m => m.status === "match");
  $("fillSelected").textContent = `填充选中项（${count}）`;
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
  target.innerHTML = matches.map(match => {
    const selected = state.fillSelected.has(match.fieldId);
    const value = state.fillValues[match.fieldId] ?? match.value ?? "";
    const editable = match.status === "match";
    const badges = [
      `<span class="fill-badge type">${escapeHtml(match.type)}</span>`,
      match.confidence ? `<span class="fill-badge conf-${match.confidence}">置信${CONF_LABEL[match.confidence]}</span>` : "",
      `<span class="fill-badge src-${match.source}">${SRC_LABEL[match.source] || match.source}</span>`,
      match.status === "manual" ? `<span class="fill-badge status-manual">需手动</span>` : "",
    ].filter(Boolean).join("");
    const keyHint = match.fieldKey ? ` · ${escapeHtml(RESUME_FIELD_LABELS[match.fieldKey] || match.fieldKey)}` : "";
    return `<div class="fill-row${match.status === "manual" ? " manual" : ""}">
      <input type="checkbox" data-fill-id="${match.fieldId}" ${selected ? "checked" : ""} ${editable ? "" : "disabled"}>
      <div class="fill-row-main">
        <div class="fill-row-label">${escapeHtml(match.label || "（未识别标签）")}${match.required ? `<span class="req">*</span>` : ""}${badges}</div>
        <input type="text" data-fill-value-id="${match.fieldId}" value="${escapeHtml(value)}" ${editable ? "" : "disabled"} placeholder="${editable ? "可手动修改" : "需手动填写"}">
        <div class="fill-meta">${escapeHtml(match.reason || "")}${keyHint}</div>
      </div>
    </div>`;
  }).join("");
  updateFillButtons();
}

// —— 填充执行 ——
let fillRunning = false;

export async function runFill(all = false) {
  if (fillRunning) throw new Error("填充进行中，请等待完成或点击停止。");
  fillRunning = true;
  const tab = await currentTab();
  if (!state.fillMatches.length) throw new Error("请先扫描页面。");
  const fills = state.fillMatches
    .filter(m => m.status === "match" && (all || state.fillSelected.has(m.fieldId)))
    .map(m => ({ id: m.fieldId, value: state.fillValues[m.fieldId] ?? m.value, type: m.type }));
  if (!fills.length) throw new Error(all ? "没有可填充的表单项。" : "请先勾选要填充的表单项。");
  $("scanFillPage").disabled = true;
  $("fillSelected").disabled = true;
  $("fillAll").disabled = true;
  const start = Date.now();
  $("fillProgress").textContent = `正在填充 0/${fills.length}…`;
  $("stopFill").hidden = false;
  try {
    const response = await fillMessagePage(tab, { type: "SMART_FILL_APPLY", fills });
    if (!response?.ok) throw new Error(response?.error || "填充失败");
    const results = response.results || [];
    const summary = summarizeResults(results);
    const failedIds = results.filter(r => !r.ok).map(r => r.id);
    setFillFailedIds(failedIds);
    if (failedIds.length) {
      fillMessagePage(tab, { type: "SMART_FILL_HIGHLIGHT", ids: failedIds, on: true }).catch(() => {});
    }
    $("fillProgress").textContent = `填充完成：成功 ${summary.ok} / ${summary.total}${failedIds.length ? `，${failedIds.length} 项需手动处理（已在页面高亮）` : ""}`;
    await afterFill(tab, results, Date.now() - start);
    return { summary, failedIds };
  } finally {
    fillRunning = false;
    $("stopFill").hidden = true;
    $("scanFillPage").disabled = false;
    updateFillButtons();
  }
}

export async function stopFill() {
  const tab = await currentTab();
  if (tab?.url && /^https?:/i.test(tab.url)) {
    fillMessagePage(tab, { type: "SMART_FILL_CANCEL" }).catch(() => {});
  }
  $("fillProgress").textContent = "已请求停止填充…";
}

export async function clearFill() {
  const tab = await currentTab();
  if (tab?.url && /^https?:/i.test(tab.url) && state.fillFailedIds.length) {
    fillMessagePage(tab, { type: "SMART_FILL_HIGHLIGHT", ids: state.fillFailedIds, on: false }).catch(() => {});
  }
  setFillScanFields([]);
  setFillScanPage(null);
  setFillMatches([]);
  setFillSelected(new Set());
  setFillValues({});
  setFillFailedIds([]);
  $("fillResultList").innerHTML = "";
  $("fillProgress").textContent = "";
  $("fillCurrentSite").textContent = "未检测到网申页面。请打开目标公司的网申/信息录入页后点击「扫描」。首次使用需授权该网站。";
  renderFillTemplate();
  updateFillButtons();
}

async function afterFill(tab, results, durationMs) {
  const host = state.fillScanPage?.host || "";
  if (state.fillTemplateEnabled && host) {
    const templates = await getTemplates();
    const okIds = new Set(results.filter(r => r.ok).map(r => r.id));
    // 仅填充成功（或成功且被用户修正）的字段入模板；失败字段标记 manual 不入模板，避免下次复用错误值。
    const templateMatches = state.fillMatches.map(m => {
      if (!okIds.has(m.fieldId)) return { ...m, status: "manual" };
      return { ...m, value: state.fillValues[m.fieldId] ?? m.value, edited: state.fillValues[m.fieldId] !== m.value };
    });
    templates[host] = saveTemplateFromResults(host, state.fillScanPage?.url || tab.url, templateMatches, templates[host]);
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
  const template = templates[host];
  const info = $("fillTemplateInfo");
  const button = $("deleteFillTemplate");
  if (!info || !button) return;
  if (!template) {
    info.textContent = "未保存模板";
    button.disabled = true;
    $("fillTemplateList").innerHTML = "";
    return;
  }
  info.textContent = `${host} · ${template.fields.length} 个字段 · ${String(template.updatedAt || "").slice(0, 10)}`;
  button.disabled = false;
  $("fillTemplateList").innerHTML = template.fields.length
    ? template.fields.map(f => `<div class="fill-template-item">${escapeHtml(f.siteLabel || f.fieldKey)} → ${escapeHtml(f.value)}${f.edited ? "（已修正）" : ""}</div>`).join("")
    : `<p class="hint">模板为空</p>`;
}

export async function deleteFillTemplate() {
  const host = state.fillScanPage?.host;
  if (!host) return;
  if (!confirm(`删除 ${host} 的站点模板？`)) return;
  const templates = await getTemplates();
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
function bindFillEvents() {
  $("scanFillPage").onclick = () => scanFillPage().catch(error => toast(error.message));
  $("fillSelected").onclick = () => runFill(false).catch(error => toast(error.message));
  $("fillAll").onclick = () => runFill(true).catch(error => toast(error.message));
  $("stopFill").onclick = () => stopFill().catch(error => toast(error.message));
  $("clearFill").onclick = () => clearFill().catch(error => toast(error.message));
  $("extractResumeFields").onclick = () => extractResumeFields().catch(error => toast(error.message));
  $("saveResumeFields").onclick = () => saveResumeFields().catch(error => toast(error.message));
  $("deleteFillTemplate").onclick = () => deleteFillTemplate().catch(error => toast(error.message));
  $("fillProfileSelect").onchange = async (event) => {
    try {
      await switchProfile(parseInt(event.target.value, 10));
      renderFillProfileSelect();
      renderResumeFields();
      toast(`已切换到"${activeProfile()?.name || "未命名"}"`);
    } catch (error) { toast(error.message); }
  };
  $("fillAiToggle").onchange = (event) => {
    setFillAiEnabled(event.target.checked);
    chrome.storage.local.set({ smartFillSettings: { aiEnabled: state.fillAiEnabled, templateEnabled: state.fillTemplateEnabled } }).catch(() => {});
    if (state.fillMatches.length) buildMatches().catch(() => {});
  };
  $("fillTemplateToggle").onchange = (event) => {
    setFillTemplateEnabled(event.target.checked);
    chrome.storage.local.set({ smartFillSettings: { aiEnabled: state.fillAiEnabled, templateEnabled: state.fillTemplateEnabled } }).catch(() => {});
  };
  document.addEventListener("change", (event) => {
    const checkbox = event.target.closest("input[data-fill-id]");
    if (!checkbox) return;
    const next = new Set(state.fillSelected);
    if (checkbox.checked) next.add(checkbox.dataset.fillId);
    else next.delete(checkbox.dataset.fillId);
    setFillSelected(next);
    updateFillButtons();
  });
  document.addEventListener("input", (event) => {
    const valueInput = event.target.closest("input[data-fill-value-id]");
    if (valueInput) state.fillValues[valueInput.dataset.fillValueId] = valueInput.value;
  });
  document.addEventListener("click", (event) => {
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
    }
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "SMART_FILL_PROGRESS") {
      const progress = $("fillProgress");
      if (progress) progress.textContent = `正在填充 ${message.index}/${message.total}…${message.error ? `（${message.error}）` : ""}`;
    }
  });
}

export async function initFillUi() {
  const { smartFillSettings = {} } = await chrome.storage.local.get("smartFillSettings");
  setFillAiEnabled(smartFillSettings.aiEnabled !== false);
  setFillTemplateEnabled(smartFillSettings.templateEnabled !== false);
  $("fillAiToggle").checked = state.fillAiEnabled;
  $("fillTemplateToggle").checked = state.fillTemplateEnabled;
  renderFillProfileSelect();
  renderResumeFields();
  renderFillLogs();
  renderFillTemplate();
  bindFillEvents();
}

// 简历变更后刷新智能填充页（设置页切换/增删简历时调用）。
export function refreshFillUi() {
  renderFillProfileSelect();
  renderResumeFields();
}
