import { sanitizeGreeting, trimLog } from "./src/pure-utils.js";
import {
  DEFAULTS, endpointUrl, hostOf, assertSafeEndpoint,
  jsonFrom, jobIdentityKeys, sameJob, dedupeJobLibrary,
  sanitizeJobForLibrary, escapeCsv,
} from "./lib/shared.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  chrome.storage.local.get("config", ({ config }) => {
    if (!config) chrome.storage.local.set({ config: DEFAULTS, jobLibrary: [] });
  });
});

// 简单的异步互斥锁：保证同一资源上的读-改-写操作串行执行，避免 lost-update。
function mutex() {
  let tail = Promise.resolve();
  return { run(task) { const next = tail.then(() => task()); tail = next.catch(() => {}); return next; } };
}

// 统一错误处理：记录完整堆栈到控制台，返回简短消息给调用方。
function logError(context, error) {
  const message = error?.message || String(error);
  console.error(`[猎投] ${context}：`, error);
  return message;
}

// 投递日志：runQueue 每步持久化到 storage，便于 panel 查看。
const LOG_MAX = 200; // 最多保留 200 条日志

// 串行化所有对 deliveryLog 的读-改-写，避免并发覆盖。
const logMutex = mutex();

async function appendDeliveryLog(entry) {
  // entry: { time, jobKey, jobTitle, step, status, message }
  return logMutex.run(async () => {
    const { deliveryLog = [] } = await chrome.storage.local.get("deliveryLog");
    deliveryLog.unshift({ ...entry, time: new Date().toISOString() });
    // 限制条数，避免无限增长。
    const trimmed = trimLog(deliveryLog, LOG_MAX);
    await chrome.storage.local.set({ deliveryLog: trimmed });
  });
}

async function getDeliveryLog() {
  const { deliveryLog = [] } = await chrome.storage.local.get("deliveryLog");
  return deliveryLog;
}

async function clearDeliveryLog() {
  return logMutex.run(async () => {
    await chrome.storage.local.set({ deliveryLog: [] });
  });
}

const MAX_RETRY_TOKENS = 12000;

function isReasoningModel(model) {
  return /(^|[-_/])(o[1-9]|gpt-5|r1|reasoner|reasoning|thinking)([-_.:/]|$)/i.test(String(model || ""));
}

function usesMaxCompletionTokens(model) {
  return /^(o[1-9](?:[-_.]|$)|gpt-5(?:[-_.]|$))/i.test(String(model || ""));
}

function deepSeekThinkingControl(config) {
  const isDeepSeek = /deepseek/i.test(`${config?.endpoint || ""} ${config?.model || ""}`);
  return isDeepSeek && config?.disableThinking !== false
    ? { thinking: { type: "disabled" } }
    : {};
}

function assistantText(body) {
  const choice = body?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === "string") return part;
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.text?.value === "string") return part.text.value;
      if (typeof part?.content === "string" && /text/i.test(part?.type || "")) return part.content;
      return "";
    }).join("");
  }
  if (typeof choice?.text === "string") return choice.text;
  if (typeof body?.output_text === "string") return body.output_text;
  if (Array.isArray(body?.output)) {
    return body.output.flatMap(item => Array.isArray(item?.content) ? item.content : []).map(part => {
      if (typeof part?.text === "string") return part.text;
      if (typeof part?.text?.value === "string") return part.text.value;
      return "";
    }).join("");
  }
  return "";
}

function rawAiResponse(body) {
  try { return JSON.stringify(body, null, 2).slice(0, 20000); }
  catch (_) { return String(body || "").slice(0, 20000); }
}

function emptyAiError(body, attempts) {
  const choice = body?.choices?.[0] || {};
  const message = choice?.message || {};
  const finishReason = choice?.finish_reason || body?.status || "未提供";
  const reasoningTokens = body?.usage?.completion_tokens_details?.reasoning_tokens || 0;
  const hasReasoning = !!(message.reasoning_content || reasoningTokens);
  let cause;
  if (message.refusal) cause = `模型拒绝生成：${message.refusal}`;
  else if (/content_filter/i.test(finishReason)) cause = "响应被服务商的内容安全策略拦截。";
  else if (/length|max_tokens|incomplete/i.test(finishReason) || hasReasoning) cause = "模型在输出最终文本前耗尽了生成额度。";
  else cause = `服务返回 finish_reason=${finishReason}，但 content 为空。`;
  const retryText = attempts > 1 ? `已自动重试 ${attempts - 1} 次。` : "";
  const error = new Error(`AI 服务返回空内容。${retryText}${cause}若持续出现，请改用非推理型对话模型后重试。`);
  error.rawResponse = rawAiResponse(body);
  return error;
}

function canRetryEmptyResponse(body) {
  return !body?.choices?.[0]?.message?.refusal &&
    !/content_filter/i.test(body?.choices?.[0]?.finish_reason || "");
}

async function callAI({ config, messages, maxTokens = 1800, jsonMode = false, timeoutMs = 60000, retries = 1 }) {
  assertSafeEndpoint(config.endpoint);
  const url = endpointUrl(config.endpoint);
  const origin = new URL(url).origin + "/*";
  const granted = await chrome.permissions.contains({ origins: [origin] });
  if (!granted) throw new Error("请先在设置中允许此 AI 服务的网址访问权限。");
  const attempts = Math.max(1, Math.floor(Number(retries) || 0) + 1);
  let tokenBudget = Math.max(1, Number(maxTokens) || 1800);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      const tokenLimit = usesMaxCompletionTokens(config.model)
        ? { max_completion_tokens: tokenBudget }
        : { max_tokens: tokenBudget };
      const temperature = isReasoningModel(config.model) ? {} : { temperature: 0.35 };
      const thinkingControl = deepSeekThinkingControl(config);
      const useJsonMode = jsonMode && (/deepseek/i.test(config.endpoint || "") || /deepseek/i.test(config.model || ""));
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.apiKey}` },
        body: JSON.stringify({ model: config.model, messages, ...temperature, ...tokenLimit, ...thinkingControl, ...(useJsonMode ? { response_format: { type: "json_object" } } : {}) }),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new Error(`AI 服务连接超时（${Math.round(timeoutMs / 1000)} 秒）：${hostOf(url)}。请检查 API 地址、网络或服务状态。`);
      throw new Error(`无法连接 AI 服务：${hostOf(url)}。请检查 API 地址、网络，并在「设置」点击“测试连接”授权该服务。`);
    } finally {
      clearTimeout(timeout);
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body?.error?.message || `AI 服务返回 ${response.status}`);
      error.rawResponse = rawAiResponse(body);
      throw error;
    }
    const text = assistantText(body);
    if (String(text || "").trim()) return { text, usage: body?.usage };
    if (attempt < attempts && canRetryEmptyResponse(body)) {
      tokenBudget = Math.min(MAX_RETRY_TOKENS, Math.max(tokenBudget * 2, tokenBudget + 1000));
      continue;
    }
    throw emptyAiError(body, attempt);
  }
}

function streamDeltaText(parsed) {
  const delta = parsed?.choices?.[0]?.delta;
  if (typeof delta?.content === "string") return delta.content;
  if (Array.isArray(delta?.content)) {
    return delta.content.map(part => typeof part?.text === "string" ? part.text : "").join("");
  }
  if (parsed?.type === "response.output_text.delta" && typeof parsed?.delta === "string") return parsed.delta;
  return "";
}

function hasReasoningDelta(parsed) {
  const delta = parsed?.choices?.[0]?.delta;
  return !!(delta?.reasoning_content || delta?.reasoning || /reasoning/i.test(parsed?.type || ""));
}

// 流式调用 AI（SSE）：只展示生成进度，不向界面暴露模型的思考内容。
async function callAIStream({ config, messages, maxTokens = 1800, jsonMode = false, onDelta, onProgress }) {
  assertSafeEndpoint(config.endpoint);
  const url = endpointUrl(config.endpoint);
  const origin = new URL(url).origin + "/*";
  const granted = await chrome.permissions.contains({ origins: [origin] });
  if (!granted) throw new Error("请先在设置中允许此 AI 服务的网址访问权限。");
  const controller = new AbortController();
  const timeoutMs = 120000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const retryWithoutStream = async (body) => {
    if (!canRetryEmptyResponse(body)) throw emptyAiError(body, 1);
    if (onProgress) onProgress({ phase: "retrying" });
    return callAI({
      config,
      messages,
      maxTokens: Math.min(MAX_RETRY_TOKENS, Math.max(maxTokens * 2, maxTokens + 1000)),
      jsonMode,
      timeoutMs: 60000,
      retries: 0,
    });
  };
  let response;
  try {
    const tokenLimit = usesMaxCompletionTokens(config.model)
      ? { max_completion_tokens: maxTokens }
      : { max_tokens: maxTokens };
    const temperature = isReasoningModel(config.model) ? {} : { temperature: 0.35 };
    const thinkingControl = deepSeekThinkingControl(config);
    const useJsonMode = jsonMode && (/deepseek/i.test(config.endpoint || "") || /deepseek/i.test(config.model || ""));
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, ...temperature, ...tokenLimit, ...thinkingControl, stream: true, ...(useJsonMode ? { response_format: { type: "json_object" } } : {}) }),
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error?.name === "AbortError") throw new Error(`AI 服务连接超时（${Math.round(timeoutMs / 1000)} 秒）：${hostOf(url)}。请检查 API 地址、网络或服务状态。`);
    throw new Error(`无法连接 AI 服务：${hostOf(url)}。请检查 API 地址、网络，并在「设置」点击“测试连接”授权该服务。`);
  }
  if (!response.ok) {
    clearTimeout(timeout);
    const body = await response.json().catch(() => ({}));
    const error = new Error(body?.error?.message || `AI 服务返回 ${response.status}`);
    error.rawResponse = rawAiResponse(body);
    throw error;
  }

  const contentType = response.headers?.get?.("content-type") || "";
  if (contentType && !/text\/event-stream/i.test(contentType)) {
    clearTimeout(timeout);
    const body = await response.json().catch(() => ({}));
    const text = assistantText(body);
    if (!String(text || "").trim()) return retryWithoutStream(body);
    if (onDelta) onDelta(text, text);
    return { text, usage: body?.usage };
  }

  if (!response.body?.getReader) {
    clearTimeout(timeout);
    throw new Error("AI 服务没有返回可读取的流式响应。请改用支持 SSE 流式输出的模型。");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let usage;
  let lastEvent = {};
  let reasoningReported = false;
  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith("data:")) return;
    const data = trimmed.slice(5).trim();
    if (data === "[DONE]") return;
    try {
      const parsed = JSON.parse(data);
      lastEvent = parsed;
      if (parsed?.usage) usage = parsed.usage;
      if (hasReasoningDelta(parsed) && !reasoningReported) {
        reasoningReported = true;
        if (onProgress) onProgress({ phase: "reasoning" });
      }
      const delta = streamDeltaText(parsed);
      if (delta) {
        fullText += delta;
        if (onDelta) onDelta(delta, fullText);
      }
    } catch (error) {
      if (error?.message === "PORT_DISCONNECTED") throw error;
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) handleLine(line);
    }
    buffer += decoder.decode();
    if (buffer.trim()) handleLine(buffer);
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`AI 流式生成超时（${Math.round(timeoutMs / 1000)} 秒）：${hostOf(url)}。`);
    throw error;
  } finally {
    clearTimeout(timeout);
    try { reader.cancel(); } catch (_) {}
  }
  if (!fullText) return retryWithoutStream(lastEvent);
  return { text: fullText, usage };
}

async function getJobLibrary() {
  const { jobLibrary = [] } = await chrome.storage.local.get("jobLibrary");
  return dedupeJobLibrary(jobLibrary);
}

// 串行化所有对 jobLibrary 的读-改-写，避免并发覆盖。
const libraryMutex = mutex();
async function saveJob(job) {
  return libraryMutex.run(async () => {
    const jobLibrary = dedupeJobLibrary((await chrome.storage.local.get("jobLibrary")).jobLibrary || []);
    // 职位列表页的 URL 对所有卡片相同，不能作为唯一键；优先使用当前岗位的详情链接。
    const key = job.detailUrl || job.url || `${job.company}|${job.title}|${job.location}`;
    const existing = jobLibrary.findIndex((item) => sameJob(item, job));
    // 不把投递清单的临时状态字段写进岗位库。
    const record = { ...sanitizeJobForLibrary(job), key, updatedAt: new Date().toISOString() };
    if (existing >= 0) jobLibrary[existing] = { ...jobLibrary[existing], ...record };
    else jobLibrary.unshift(record);
    await chrome.storage.local.set({ jobLibrary });
    return record;
  });
}

async function exportJobs() {
  const jobLibrary = await getJobLibrary();
  const columns = [
    ["投递时间", "sentAt"], ["岗位名称", "title"], ["公司", "company"], ["地点", "location"],
    ["薪资", "salary"], ["完整JD", "description"], ["打招呼语", "greeting"],
    ["投递状态", "status"], ["岗位链接", "url"]
  ];
  const csv = "\uFEFF" + [columns.map(([label]) => escapeCsv(label)).join(","), ...jobLibrary.map(job => columns.map(([, key]) => escapeCsv(key === "url" ? (job.detailUrl || job.url) : job[key])).join(","))].join("\r\n");
  // 岗位库可能很大，data URL 会超出 downloads 限制，改用 blob URL。
  // MV3 service worker 终止时会自动释放 blob URL，无需手动 revoke。
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  await chrome.downloads.download({ url, filename: `猎投-岗位库-${new Date().toISOString().slice(0, 10)}.csv`, saveAs: true });
}

let queueRunning = false;
let queueStopRequested = false;
let queueBatch = { current: 0, total: 0 };
let workerTabId = null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const queueMutex = mutex();

// 批量投递中断恢复：SW 重启/面板关闭后，遗留的"投递中/发送中"项无法确认真实
// 发送结果，标记为"已中断"并要求人工确认，绝不静默回退成待投递（避免重复发送）。
const INTERRUPTED_MESSAGE = "投递过程被系统中断（面板关闭或浏览器休眠），发送结果未知；请人工确认后点击保存修改再重试。";
async function recoverInterruptedQueue() {
  return queueMutex.run(async () => {
    const queue = await getQueue();
    let changed = false;
    const next = queue.map(item => {
      if (item.status === "投递中" || item.status === "发送中") {
        changed = true;
        return { ...item, status: "已中断", progress: "", error: item.error || INTERRUPTED_MESSAGE };
      }
      return item;
    });
    if (changed) await setQueue(next);
    return changed;
  });
}

async function getQueue() {
  const { deliveryQueue = [] } = await chrome.storage.local.get("deliveryQueue");
  // 只读：成功岗位在投递完成时已从清单移除，这里不再写回，避免与并发写者竞争。
  return deliveryQueue.filter(item => item.status !== "已成功");
}

async function setQueue(queue) {
  await chrome.storage.local.set({ deliveryQueue: queue });
}

// —— 已投递成功卡片：投递成功后先保留展示“确认态”，面板 5 秒后延迟消失 ——
// 与 deliveryQueue 分离：不占 20 条待处理名额，也不参与批量投递/生成逻辑。
const RECENT_DELIVERY_TTL_MS = 60 * 1000; // 面板关闭时的兜底清理时长

async function getRecentDeliveries() {
  const { recentDeliveries = [] } = await chrome.storage.local.get("recentDeliveries");
  const list = Array.isArray(recentDeliveries) ? recentDeliveries : [];
  const now = Date.now();
  return list.filter(item => now - (item.deliveredAt || 0) < RECENT_DELIVERY_TTL_MS);
}

async function addRecentDelivery(item) {
  return queueMutex.run(async () => {
    const recent = await getRecentDeliveries();
    recent.unshift({
      ...item,
      status: "已成功",
      progress: "",
      error: "",
      deliveredAt: Date.now(),
      updatedAt: new Date().toISOString(),
    });
    await chrome.storage.local.set({ recentDeliveries: recent });
    return recent[0];
  });
}

async function removeRecentDeliveries(keys) {
  return queueMutex.run(async () => {
    const recent = await getRecentDeliveries();
    const keySet = new Set((Array.isArray(keys) ? keys : []).filter(Boolean));
    const next = recent.filter(item => !keySet.has(item.key));
    if (next.length !== recent.length) await chrome.storage.local.set({ recentDeliveries: next });
    return recent.length - next.length;
  });
}

// 清理超过 TTL 的已投递记录，防止面板未打开时堆积。
async function pruneRecentDeliveries() {
  return queueMutex.run(async () => {
    const raw = (await chrome.storage.local.get("recentDeliveries")).recentDeliveries || [];
    const list = Array.isArray(raw) ? raw : [];
    const now = Date.now();
    const next = list.filter(item => now - (item.deliveredAt || 0) < RECENT_DELIVERY_TTL_MS);
    if (next.length !== list.length) await chrome.storage.local.set({ recentDeliveries: next });
  });
}

async function queueJob(job) {
  return queueMutex.run(async () => {
    const queue = await getQueue();
    const key = job.jobId || job.detailUrl;
    if (!key) throw new Error("未读取到岗位唯一标识，请在岗位页重新分析后再加入清单。");
    // 与岗位库一致：按 jobId/detailUrl/标题公司兜底做语义去重，而不是只比 key 字符串。
    if (queue.some(item => sameJob(item, job))) throw new Error("该岗位已在投递清单中。");
    if (queue.filter(item => item.status !== "已成功").length >= 20) throw new Error("投递清单最多保留 20 条待处理岗位。");
    const item = { ...job, key, greeting: job.greeting || "", status: job.greeting ? "待投递" : "待生成", queuedAt: new Date().toLocaleString("zh-CN"), error: "" };
    queue.unshift(item); await setQueue(queue); return item;
  });
}

async function updateQueueItem(key, patch) {
  return queueMutex.run(async () => {
    const queue = await getQueue();
    const index = queue.findIndex(item => item.key === key);
    if (index >= 0) queue[index] = { ...queue[index], ...patch, updatedAt: new Date().toISOString() };
    await setQueue(queue);
    return queue[index];
  });
}

async function removeQueueItem(key) {
  return queueMutex.run(async () => {
    const queue = await getQueue();
    const next = queue.filter(item => item.key !== key);
    await setQueue(next);
    return next.length !== queue.length;
  });
}

async function removeQueueItems(keys) {
  return queueMutex.run(async () => {
    const requestedKeys = [...new Set((Array.isArray(keys) ? keys : []).filter(Boolean))];
    const queue = await getQueue();
    const keySet = new Set(requestedKeys);
    const next = queue.filter(item => !keySet.has(item.key));
    const removedCount = queue.length - next.length;
    if (removedCount > 0) await setQueue(next);
    return {
      removedCount,
      requestedCount: requestedKeys.length,
      missingKeys: requestedKeys.filter(key => !queue.some(item => item.key === key)),
    };
  });
}

async function sendToTab(tabId, message) {
  try { return await chrome.tabs.sendMessage(tabId, message); }
  catch (error) {
    if (!/Receiving end does not exist/i.test(error.message || "")) throw error;
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return chrome.tabs.sendMessage(tabId, message);
  }
}

async function waitForTab(tabId, fragment, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete" && tab.url?.includes(fragment)) return tab;
    await sleep(300);
  }
  throw new Error(`页面加载超时：${fragment}`);
}

async function waitForCommunicationReady(tabId, timeout = 15000) {
  const deadline = Date.now() + timeout;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const response = await sendToTab(tabId, { type: "PREPARE_COMMUNICATION" });
      if (response?.blocked) throw new Error(response.reason || "检测到 BOSS 安全验证，请手动处理后重试。");
      if (response?.ready) return response;
      if (!response?.ok) lastError = response?.error || "页面尚未准备好";
    } catch (error) {
      if (/安全验证|操作限制/.test(error.message || "")) throw error;
      lastError = error.message || String(error);
    }
    await sleep(400);
  }
  throw new Error(`未能进入可发送状态。${lastError ? `最后状态：${lastError}。` : ""}请检查 BOSS 页面是否出现验证或沟通弹层。`);
}

async function ensureWorker(url) {
  try {
    if (workerTabId) await chrome.tabs.get(workerTabId);
  } catch (_) { workerTabId = null; }
  if (!workerTabId) workerTabId = (await chrome.tabs.create({ url, active: false })).id;
  else await chrome.tabs.update(workerTabId, { url, active: false });
  return workerTabId;
}

async function runQueue(keySet = null) {
  queueStopRequested = false;
  const MAX_CONSECUTIVE_FAILURES = 3;
  let consecutiveFailures = 0;
  try {
    const items = (await getQueue())
      .filter(item => ["待投递", "待确认"].includes(item.status))
      .filter(item => !keySet || keySet.has(item.key))
      .slice(0, 20);
    if (!items.length) throw new Error("没有待投递岗位。");
    queueBatch = { current: 0, total: items.length };
    for (let index = 0; index < items.length; index++) {
      if (queueStopRequested) {
        await updateQueueItem(items[index].key, { status: "已停止", progress: "", error: "用户已停止本轮投递" }).catch(() => {});
        await appendDeliveryLog({ jobKey: items[index].key, jobTitle: items[index].title, step: "用户停止", status: "stop", message: "用户已停止本轮投递" });
        break;
      }
      const item = items[index];
      let messageSent = false;
      queueBatch.current = index + 1;
      await updateQueueItem(item.key, { status: "投递中", progress: `正在投递第 ${queueBatch.current}/${queueBatch.total} 个岗位：打开岗位详情`, error: "" });
      try {
        const greeting = sanitizeGreeting(item.greeting);
        if (!item.profileName) throw new Error("该岗位未绑定生成招呼语时使用的简历，请重新批量生成后再投递。");
        const { profiles = [] } = await chrome.storage.local.get("profiles");
        const profile = profiles.find(candidate => candidate.name === item.profileName);
        if (!profile) throw new Error(`生成招呼语时使用的简历“${item.profileName}”已不存在，请重新批量生成。`);
        if (!item.detailUrl) throw new Error("缺少岗位详情链接");
        const tabId = await ensureWorker(item.detailUrl);
        await waitForTab(tabId, "/job_detail/");
        await appendDeliveryLog({ jobKey: item.key, jobTitle: item.title, step: "打开详情", status: "ok" });
        await updateQueueItem(item.key, { progress: "正在核验岗位信息" });
        const verify = await sendToTab(tabId, { type: "VERIFY_JOB", job: item });
        if (!verify?.ok) throw new Error(`岗位核验失败：${verify?.reason || "信息不一致"}`);
        await appendDeliveryLog({ jobKey: item.key, jobTitle: item.title, step: "核验岗位", status: "ok", message: verify?.reason || "" });
        await updateQueueItem(item.key, { progress: "正在打开 BOSS 沟通页" });
        const open = await sendToTab(tabId, { type: "OPEN_COMMUNICATION" });
        if (!open?.ok) throw new Error(open?.error || "无法打开沟通页");
        await updateQueueItem(item.key, { progress: "正在处理沟通弹层并等待聊天输入框" });
        await waitForCommunicationReady(tabId);
        await appendDeliveryLog({ jobKey: item.key, jobTitle: item.title, step: "打开沟通页", status: "ok" });
        // 先落盘"发送中"再真正发送：SW 若在发送瞬间被回收，恢复逻辑能把该项标记为需人工确认，避免重复投递。
        await updateQueueItem(item.key, { status: "发送中", progress: "正在发送招呼语和简历图片" });
        const sent = await sendToTab(tabId, { type: "SEND_MESSAGE", greeting, images: profile.resumeImages || [] });
        if (!sent?.ok) {
          const sendError = new Error(sent?.error || "发送失败");
          if (sent?.uncertain) sendError.uncertain = true;
          throw sendError;
        }
        messageSent = true;
        const resumeStatus = sent.resume?.sent ? "简历图片已确认送达" : (sent.resume?.reason || "未发送");
        // 从此处起消息已经不可撤销。先持久化不可重试状态，归档失败也不能回到普通失败状态。
        await updateQueueItem(item.key, { status: "已发送待归档", progress: "消息已送达，正在保存投递记录", error: "" });
        await appendDeliveryLog({ jobKey: item.key, jobTitle: item.title, step: "发送招呼语", status: "ok", message: sent.resume?.sent ? "简历图片已确认送达" : (sent.resume?.reason || "未发送简历") }).catch(error => logError("记录发送日志", error));
        await saveJob({ ...item, greeting, status: "已沟通", sentAt: new Date().toLocaleString("zh-CN"), resumeStatus });
        await appendDeliveryLog({ jobKey: item.key, jobTitle: item.title, step: "投递完成", status: "ok" }).catch(error => logError("记录投递完成日志", error));
        // 岗位库已保存成功记录，移出待投递清单；卡片保留在“已投递成功”临时区，
        // 供面板展示打勾确认态并在延迟后消失（清理失败不影响投递结果）。
        if (!await removeQueueItem(item.key)) throw new Error("投递记录已保存，但未能从投递清单移除");
        await addRecentDelivery({ ...item, greeting, status: "已成功" }).catch(error => logError(`记录已投递成功卡片「${item.title}」`, error));
        consecutiveFailures = 0;
      } catch (error) {
        if (messageSent) {
          const message = `消息已确认送达，但本地归档失败：${logError(`归档岗位「${item.title}」`, error)}`;
          await updateQueueItem(item.key, { status: "已发送待归档", progress: "", error: message }).catch(() => {});
          await appendDeliveryLog({ jobKey: item.key, jobTitle: item.title, step: "归档失败", status: "fail", message }).catch(() => {});
          // 本地持久化异常可能影响后续岗位，停止本轮且绝不自动重发当前岗位。
          break;
        }
        consecutiveFailures++;
        const message = logError(`投递岗位「${item.title}」`, error);
        // 发送结果不确定（BOSS 未确认送达）与确定失败区分开：前者禁止无确认重发。
        const failureStatus = error?.uncertain ? "发送结果未知" : "失败";
        await updateQueueItem(item.key, { status: failureStatus, progress: "", error: message });
        await appendDeliveryLog({ jobKey: item.key, jobTitle: item.title, step: "投递失败", status: "fail", message });
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          // 连续多次失败通常意味着 BOSS 风控或登录失效，继续发送只会加剧封号风险，自动熔断。
          await updateQueueItem(item.key, { error: `${message}（连续 ${consecutiveFailures} 次失败，已自动停止以保护账号）` }).catch(() => {});
          await appendDeliveryLog({ jobKey: item.key, jobTitle: item.title, step: "自动熔断", status: "fail", message: `连续 ${consecutiveFailures} 次失败` });
          break;
        }
      }
      // 岗位之间加入随机间隔，降低被 BOSS 风控的概率。最后一个岗位后无需等待。
      if (index < items.length - 1 && !queueStopRequested) await sleep(15000 + Math.floor(Math.random() * 15000));
    }
  } finally {
    queueRunning = false;
    queueStopRequested = false;
    queueBatch = { current: 0, total: 0 };
    try { if (workerTabId) await chrome.tabs.remove(workerTabId); } catch (_) {}
    workerTabId = null;
    // 广播结束，让所有打开的 panel（含重开的）感知。
    chrome.runtime.sendMessage({ type: "QUEUE_FINISHED" }).catch(() => {});
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message.type === "AI_CALL") {
      const result = await callAI(message.payload);
      const text = typeof result === "string" ? result : (result?.text ?? result);
      const usage = typeof result === "object" ? result?.usage : undefined;
      sendResponse({ ok: true, text, ...(usage ? { usage } : {}) });
    } else if (message.type === "PARSE_JSON") {
      sendResponse({ ok: true, data: jsonFrom(message.text) });
    } else if (message.type === "SAVE_JOB") {
      sendResponse({ ok: true, job: await saveJob(message.job) });
    } else if (message.type === "LIBRARY_GET") {
      sendResponse({ ok: true, jobLibrary: await getJobLibrary() });
    } else if (message.type === "EXPORT_JOBS") {
      await exportJobs(); sendResponse({ ok: true });
    } else if (message.type === "QUEUE_ADD") {
      sendResponse({ ok: true, item: await queueJob(message.job) });
    } else if (message.type === "QUEUE_GET") {
      if (!queueRunning) await recoverInterruptedQueue();
      sendResponse({ ok: true, queue: await getQueue(), recentDeliveries: await getRecentDeliveries(), running: queueRunning, batch: queueBatch });
    } else if (message.type === "QUEUE_UPDATE") {
      const current = (await getQueue()).find(item => item.key === message.key);
      if (current?.status === "已发送待归档") {
        throw new Error("该岗位消息已送达，仅本地归档未完成；为避免重复发送，不能重新加入待投递队列。");
      }
      const { confirmResend, ...patch } = message.patch || {};
      if (["已中断", "发送结果未知"].includes(current?.status) && patch.status === "待投递" && !confirmResend) {
        throw new Error("该岗位发送结果未知，请先人工确认后再重试。");
      }
      sendResponse({ ok: true, item: await updateQueueItem(message.key, patch) });
    } else if (message.type === "QUEUE_REMOVE") {
      if (queueRunning) throw new Error("投递进行中，不能移除岗位。");
      sendResponse({ ok: await removeQueueItem(message.key) });
    } else if (message.type === "QUEUE_REMOVE_MANY") {
      if (queueRunning) throw new Error("投递进行中，不能移除岗位。");
      const result = await removeQueueItems(message.keys);
      sendResponse({ ok: result.removedCount === result.requestedCount, ...result });
    } else if (message.type === "QUEUE_REMOVE_RECENT") {
      sendResponse({ ok: true, removedCount: await removeRecentDeliveries(message.keys) });
    } else if (message.type === "QUEUE_START") {
      if (queueRunning) { sendResponse({ ok: true, alreadyRunning: true }); return; }
      await recoverInterruptedQueue();
      await pruneRecentDeliveries();
      const allReady = (await getQueue()).filter(item => ["待投递", "待确认"].includes(item.status));
      const keySet = Array.isArray(message.keys) && message.keys.length ? new Set(message.keys) : null;
      const ready = keySet ? allReady.filter(item => keySet.has(item.key)) : allReady;
      const count = ready.slice(0, 20).length;
      if (!count) throw new Error("没有已生成招呼语的岗位。");
      // getQueue() 让出了事件循环；再次检查后再同步置锁，确保并发启动只有一个获胜者。
      if (queueRunning) { sendResponse({ ok: true, alreadyRunning: true }); return; }
      queueRunning = true; // 在 await 让出前同步置锁，避免并发 QUEUE_START 双启动。
      runQueue(keySet).catch(error => console.error("[猎投] runQueue 失败：", error));
      sendResponse({ ok: true, count });
    } else if (message.type === "QUEUE_STOP") {
      if (!queueRunning) { sendResponse({ ok: false, error: "当前没有正在进行的投递。" }); return; }
      queueStopRequested = true;
      sendResponse({ ok: true });
    } else if (message.type === "LOG_GET") {
      sendResponse({ ok: true, deliveryLog: await getDeliveryLog() });
    } else if (message.type === "LOG_CLEAR") {
      await clearDeliveryLog();
      sendResponse({ ok: true });
    }
  })().catch(error => sendResponse({
    ok: false,
    error: error.message || String(error),
    ...(error.rawResponse ? { rawResponse: error.rawResponse } : {}),
  }));
  return true;
});

// 流式 AI 调用：panel 端通过 chrome.runtime.connect 建立长连接，
// background 读取 SSE，推送进度与累计文本；完成后返回文本和 usage。
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "AI_CALL_STREAM") return;
  port.onMessage.addListener(async (message) => {
    if (message.type !== "AI_CALL_STREAM") return;
    try {
      const result = await callAIStream({
        config: message.payload.config,
        messages: message.payload.messages,
        maxTokens: message.payload.maxTokens,
        jsonMode: message.payload.jsonMode,
        onDelta: (_delta, full) => {
          try { port.postMessage({ type: "DELTA", text: full }); }
          catch (_) { throw new Error("PORT_DISCONNECTED"); }
        },
        onProgress: (progress) => {
          try { port.postMessage({ type: "PROGRESS", ...progress }); }
          catch (_) { throw new Error("PORT_DISCONNECTED"); }
        },
      });
      try { port.postMessage({ type: "DONE", text: result.text, usage: result.usage }); }
      catch (_) { /* port 已断开，无需通知 */ }
    } catch (error) {
      try {
        port.postMessage({
          type: "ERROR",
          error: error.message || String(error),
          ...(error.rawResponse ? { rawResponse: error.rawResponse } : {}),
        });
      }
      catch (_) { /* port 已断开，无需通知 */ }
    }
  });
});
