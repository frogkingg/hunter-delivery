// 渲染：renderJob / renderAnalysis / renderSavedResumes / loadLibrary / loadQueue。
import { state } from "./state.js";
import { $, send, toast } from "./chrome-helpers.js";
import { handleError } from "./error-handler.js";
import { escapeHtml, safeUrl, sanitizeGreeting } from "./pure-utils.js";
import { DEFAULT_GREETING_PROMPT } from "./prompts.js";

let currentGreetings = [];

export function renderJob(job) {
  $("jobTitle").textContent = job.title;
  $("jobMeta").textContent = [job.company, job.location, job.salary, job.communicationState].filter(Boolean).join(" · ");
  $("jobBadge").textContent = job.pageType;
}

export function renderAnalysis(data) {
  const greetings = Array.isArray(data.greetings) ? data.greetings : [];
  currentGreetings = greetings;

  // 渲染招呼语风格切换标签
  const existingTabs = document.querySelector(".greeting-tabs");
  if (existingTabs) existingTabs.remove();
  if (greetings.length > 1) {
    const tabsHtml = `<div class="greeting-tabs" style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;">${greetings.map((g, i) =>
      `<button class="greeting-tab" data-greeting-index="${i}" style="${
        i === 0
          ? "padding:4px 10px;border:1px solid #1d4ed8;border-radius:6px;background:#1d4ed8;color:#fff;cursor:pointer;font-size:12px;white-space:nowrap;"
          : "padding:4px 10px;border:1px solid #d0d5dd;border-radius:6px;background:#fff;color:#374151;cursor:pointer;font-size:12px;white-space:nowrap;"
      }">${escapeHtml(g.style || "风格 " + (i + 1))}</button>`
    ).join("")}</div>`;
    $("greeting").insertAdjacentHTML("beforebegin", tabsHtml);
    document.querySelectorAll(".greeting-tab").forEach(tab => {
      tab.onclick = () => switchGreeting(parseInt(tab.dataset.greetingIndex));
    });
  }

  const firstGreeting = greetings[0]?.text || data.greeting || "";
  $("greeting").value = firstGreeting;
  $("greeting").dataset.original = firstGreeting;
  $("jobGreetingPrompt").value = state.jobPromptOverride || state.config.greetingPrompt || DEFAULT_GREETING_PROMPT;
  const priorities = Array.isArray(data.jd_priorities) ? data.jd_priorities : [];
  const matches = Array.isArray(data.matching_points) ? data.matching_points : [];
  const gaps = Array.isArray(data.gaps) ? data.gaps : [];
  $("matchAnalysisContent").innerHTML = `<h4>JD 重点能力</h4>${priorities.length ? `<ol>${priorities.map(item => `<li><b>${escapeHtml(item.point || "未命名能力")}</b>（${escapeHtml(item.priority || "未标注") }）<br><span>JD 原话：${escapeHtml(item.jd_evidence || "未提供")}</span><br><span>简历证据：${escapeHtml(item.resume_evidence || (item.matched ? "已匹配，但未返回证据" : "未找到明确证据"))}</span></li>`).join("")}</ol>` : `<p class="hint">本次没有返回可展示的 JD 能力分析。</p>`}<h4>核心匹配</h4>${matches.length ? `<ul>${matches.map(item => `<li><b>${escapeHtml(item.jd_quote || "未提供 JD 关键词")}</b><br><span>${escapeHtml(item.resume_evidence || "未提供简历证据")}</span></li>`).join("")}</ul>` : `<p class="hint">本次没有返回明确的核心匹配项。</p>`}<h4>待补足项</h4>${gaps.length ? `<ul>${gaps.map(item => `<li><b>${escapeHtml(item.requirement || "未命名要求")}</b><br><span>${escapeHtml(item.handling || item.explanation || "未提供处理建议")}</span></li>`).join("")}</ul>` : `<p class="hint">暂未发现需要特别说明的核心缺口。</p>`}`;
  $("matchAnalysis").classList.toggle("hidden", !(priorities.length || matches.length || gaps.length));
  $("result").classList.remove("hidden");
}

export function switchGreeting(index) {
  if (index < 0 || index >= currentGreetings.length) return;
  const textarea = $("greeting");
  const currentValue = textarea.value;
  const matchesAny = currentGreetings.some(g => g.text === currentValue);
  if (!matchesAny && !confirm("切换将覆盖当前已修改的招呼语，是否继续？")) return;
  document.querySelectorAll(".greeting-tab").forEach((tab, i) => {
    if (i === index) {
      tab.style.background = "#1d4ed8";
      tab.style.color = "#fff";
      tab.style.borderColor = "#1d4ed8";
    } else {
      tab.style.background = "#fff";
      tab.style.color = "#374151";
      tab.style.borderColor = "#d0d5dd";
    }
  });
  const newText = currentGreetings[index]?.text || "";
  textarea.value = newText;
  textarea.dataset.original = newText;
}

export function renderUsage(usage) {
  if (!usage || typeof usage.total_tokens !== "number") return;
  const cost = (usage.total_tokens / 1000000 * 2).toFixed(4);
  const html = `<p class="usage-info" style="color:#6b7280;font-size:12px;margin-top:8px;">本次消耗：${usage.total_tokens} tokens（提示 ${usage.prompt_tokens} + 生成 ${usage.completion_tokens}），约 ¥${cost}（按 DeepSeek 标准价格估算）</p>`;
  const existing = document.querySelector(".usage-info");
  if (existing) existing.remove();
  $("greeting").insertAdjacentHTML("afterend", html);
}

export function renderSavedResumes() {
  const target = $("savedResumes");
  target.innerHTML = state.uploadedImages.length ? state.uploadedImages.map((image, index) => `<div class="resume-file"><span>▣</span><span>${escapeHtml(image.name || `简历图片 ${index + 1}`)}</span><small>已保存</small></div>`).join("") : `<p class="hint">暂未保存简历图片。</p>`;
}

export async function loadLibrary() {
  const response = await send({ type: "LIBRARY_GET" });
  const jobLibrary = response?.jobLibrary || [];
  $("libraryList").innerHTML = jobLibrary.length ? jobLibrary.map(job => `<article class="library-item"><h3>${escapeHtml(job.title)}</h3><p>${escapeHtml([job.company, job.location, job.sentAt, job.status].filter(Boolean).join(" · "))}</p></article>`).join("") : `<div class="guide-card"><b>ℹ️ 还没有投递记录</b><span>成功发送后，岗位会自动保存在这里。</span></div>`;
}

// —— 已投递成功卡片：确认态展示 5 秒后淡出消失 ——
const removalTimers = new Map();          // key -> setTimeout id
const removingDeliveredKeys = new Set();  // 淡出期间避免轮询重渲染“复活”卡片
const DELIVERED_CARD_KEEP_MS = 5000;      // 停留时长
const DELIVERED_CARD_FADE_MS = 300;       // 淡出动画时长

function renderQueueItem(item, response) {
  const key = encodeURIComponent(item.key);
  const deliveryLocked = item.status === "已发送待归档";
  const meta = escapeHtml([item.company, item.location, item.status, item.progress, item.error].filter(Boolean).join(" · "));
  const diagnostics = item.rawAiResponse ? `<details class="queue-diagnostic"><summary>查看 AI 原始返回</summary><p class="hint">这是本次批量生成收到的完整返回（最多保留 20,000 个字符），可复制后发给我排查。</p><textarea class="queue-raw-response" rows="12" readonly>${escapeHtml(item.rawAiResponse)}</textarea></details>` : "";
  const details = `<div class="queue-details"><p><b>使用简历：</b>${escapeHtml(item.profileName || "未绑定，请重新生成")}</p><p><b>薪资：</b>${escapeHtml(item.salary || "未读取")}</p><p><b>岗位描述：</b></p><div class="queue-jd">${escapeHtml(item.description || "未读取")}</div>${item.detailUrl ? `<p><a class="queue-link" href="${safeUrl(item.detailUrl)}" target="_blank" rel="noopener">在 BOSS 打开岗位详情</a></p>` : ""}${item.greeting ? `<p><b>打招呼语：</b></p><textarea class="queue-greeting" data-key="${key}" rows="5" ${deliveryLocked ? "readonly" : ""}>${escapeHtml(item.greeting)}</textarea><div class="row"><button class="secondary queue-save" data-key="${key}" data-status="${escapeHtml(item.status)}" ${response?.running || deliveryLocked ? "disabled" : ""}>${deliveryLocked ? "消息已送达，禁止重发" : (item.status === "已中断" || item.status === "发送结果未知") ? "确认结果后重发" : "保存修改"}</button></div>` : `<p>招呼语尚未生成，请先点击“批量生成招呼语”。</p>`}${diagnostics}</div>`;
  return `<details class="library-item queue-item" data-key="${key}"><summary><input class="queue-select" type="checkbox" data-key="${key}" ${state.selectedQueueKeys.has(item.key) ? "checked" : ""} ${response?.running ? "disabled" : ""} aria-label="选择 ${escapeHtml(item.title)}"><div class="queue-summary-content"><h3>${escapeHtml(item.title)} <span aria-hidden="true">⌄</span></h3><p>${meta}</p></div><button class="queue-delete" type="button" data-key="${key}" ${response?.running ? "disabled" : ""}>删除</button></summary>${details}</details>`;
}

// 已投递成功：勾选框固定打勾，绿色确认态，可展开查看送达说明。
function renderDeliveredItem(item) {
  const key = encodeURIComponent(item.key);
  const meta = escapeHtml([item.company, item.location, "已投递成功"].filter(Boolean).join(" · "));
  return `<details class="library-item queue-item queue-delivered" data-key="${key}"><summary><input class="queue-select" type="checkbox" checked disabled aria-label="已投递 ${escapeHtml(item.title)}"><div class="queue-summary-content"><h3>${escapeHtml(item.title)} <span aria-hidden="true">⌄</span></h3><p>${meta}</p></div></summary><div class="queue-details"><p class="queue-delivered-note">✅ 招呼语已确认送达并记入岗位库，卡片稍后自动消失。</p></div></details>`;
}

function scheduleDeliveredRemoval(key) {
  if (removalTimers.has(key)) return;
  const timer = setTimeout(async () => {
    removalTimers.delete(key);
    removingDeliveredKeys.add(key);
    const card = [...document.querySelectorAll(".queue-item[data-key]")].find((el) => {
      try { return decodeURIComponent(el.dataset.key) === key; } catch (_) { return false; }
    });
    if (card) card.classList.add("leaving");
    await new Promise(resolve => setTimeout(resolve, DELIVERED_CARD_FADE_MS));
    try { await send({ type: "QUEUE_REMOVE_RECENT", keys: [key] }); } catch (_) {}
    removingDeliveredKeys.delete(key);
    loadQueue().catch(() => {});
  }, DELIVERED_CARD_KEEP_MS);
  removalTimers.set(key, timer);
}

export async function loadQueue() {
  const response = await send({ type: "QUEUE_GET" });
  const queue = response?.queue || [];
  const recent = response?.recentDeliveries || [];
  state.selectedQueueKeys = new Set([...state.selectedQueueKeys].filter(key => queue.some(item => item.key === key)));
  const batch = response?.batch || { current: 0, total: 0 };
  const batchText = response?.running && batch.total ? `正在投递第 ${batch.current || 1}/${batch.total} 个岗位` : "";
  $("queueProgress").textContent = batchText;
  // 已投递成功卡片：先启动延迟消失定时器，再渲染确认态
  const recentKeys = new Set(recent.map(item => item.key));
  for (const [key, timer] of removalTimers) {
    if (!recentKeys.has(key)) { clearTimeout(timer); removalTimers.delete(key); }
  }
  for (const key of removingDeliveredKeys) {
    if (!recentKeys.has(key)) removingDeliveredKeys.delete(key);
  }
  recent.forEach(item => scheduleDeliveredRemoval(item.key));
  $("queueList").innerHTML = (recent.length || queue.length)
    ? [
        ...recent.filter(item => !removingDeliveredKeys.has(item.key)).map(item => renderDeliveredItem(item)),
        ...queue.map(item => renderQueueItem(item, response)),
      ].join("")
    : `<div class="guide-card"><b>ℹ️ 清单为空</b><span>浏览岗位时点击“加入投递清单”。</span></div>`;
  document.querySelectorAll(".queue-save").forEach(button => button.onclick = async () => {
    try {
      const key = decodeURIComponent(button.dataset.key);
      const status = button.dataset.status || "";
      const uncertain = status === "已中断" || status === "发送结果未知";
      if (uncertain && !confirm("该岗位之前可能已实际发出但未确认送达。为避免重复发送，请确认是否继续？")) return;
      const greeting = sanitizeGreeting(document.querySelector(`.queue-greeting[data-key="${button.dataset.key}"]`).value);
      button.disabled = true; button.textContent = "正在保存…";
      const result = await send({ type: "QUEUE_UPDATE", key, patch: { greeting, status: "待投递", error: "", progress: "等待开始批量投递", rawAiResponse: "", ...(uncertain ? { confirmResend: true } : {}) } });
      if (!result?.ok) throw new Error(result?.error || "保存失败");
      toast("招呼语已保存，已加入待投递队列"); await loadQueue();
    } catch (error) { handleError("保存招呼语", error, (msg) => { toast(`保存失败：${msg}`); button.disabled = false; button.textContent = "保存修改"; }); }
  });
  document.querySelectorAll(".queue-select").forEach(input => {
    input.onclick = event => event.stopPropagation();
    input.onchange = () => { const key = decodeURIComponent(input.dataset.key); if (input.checked) state.selectedQueueKeys.add(key); else state.selectedQueueKeys.delete(key); $("removeSelected").textContent = `移除所选（${state.selectedQueueKeys.size}）`; };
  });
  document.querySelectorAll(".queue-delete").forEach(button => button.onclick = async event => {
    event.preventDefault(); event.stopPropagation();
    try {
      const key = decodeURIComponent(button.dataset.key);
      button.disabled = true; button.textContent = "删除中…";
      const result = await send({ type: "QUEUE_REMOVE", key });
      if (!result?.ok) throw new Error("岗位可能已被移除，请刷新清单。");
      state.selectedQueueKeys.delete(key); toast("已删除 1 个岗位"); await loadQueue();
    } catch (error) { handleError("删除岗位", error, (msg) => toast(`删除失败：${msg}`)); await loadQueue().catch(() => {}); }
  });
  $("removeSelected").textContent = `移除所选（${state.selectedQueueKeys.size}）`;
  $("removeSelected").disabled = response?.running || !state.selectedQueueKeys.size;
  $("selectAll").textContent = queue.length && state.selectedQueueKeys.size === queue.length ? "取消全选" : "全选";
  $("selectAll").disabled = response?.running || !queue.length;
  $("stopQueue").hidden = !response?.running;
  // 批量生成/开始投递均遵循勾选：按“勾选 ∩ 可操作”动态显示计数
  // 已中断/发送结果未知需要人工确认，不能通过一键批量生成静默覆盖。
  const generateTargets = queue.filter(item => !["投递中", "已成功", "已发送待归档", "已中断", "发送结果未知"].includes(item.status));
  const selectedGenerate = generateTargets.filter(item => state.selectedQueueKeys.has(item.key)).length;
  $("generateQueue").textContent = selectedGenerate ? `批量生成招呼语（${selectedGenerate}）` : "批量生成招呼语";
  const selectedReady = queue.filter(item => ["待投递", "待确认"].includes(item.status) && state.selectedQueueKeys.has(item.key)).length;
  $("startQueue").textContent = response?.running ? (batch.total ? `正在投递（${batch.current || 1}/${batch.total}）` : "正在投递，请查看岗位状态…") : (selectedReady ? `开始投递（${selectedReady}）` : "开始投递");
  $("startQueue").disabled = !!response?.running;
  return response;
}

