import { trimLog } from "./src/pure-utils.js";

const DEFAULTS = {
  endpoint: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  apiKey: "",
  candidateProfile: "",
  greetingPrompt: "",
  resumeImages: []
};

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

// 清洗投递清单中的临时字段，避免它们被 spread 进岗位库长期留存或导出。
function sanitizeJobForLibrary(job) {
  const { progress, error, rawAiResponse, queuedAt, status, ...rest } = job || {};
  return rest;
}

function endpointUrl(endpoint) {
  const base = String(endpoint || "").trim().replace(/\/$/, "");
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}

function hostOf(url) { try { return new URL(url).host; } catch (_) { return "AI 服务"; } }

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

function assertSafeEndpoint(endpoint) {
  const base = String(endpoint || "").trim();
  if (!base) throw new Error("未配置 AI API 地址。");
  let url;
  try { url = new URL(base); } catch (_) { throw new Error("AI API 地址格式不正确。"); }
  if (url.protocol !== "https:") throw new Error("AI 服务地址必须为 https://，明文 http 会泄露简历内容。");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host)) throw new Error("不允许使用本地或内网地址作为 AI 服务。");
}

async function callAI({ config, messages, maxTokens = 1800, jsonMode = false, timeoutMs = 20000, retries = 2 }) {
  assertSafeEndpoint(config.endpoint);
  const url = endpointUrl(config.endpoint);
  const origin = new URL(url).origin + "/*";
  const granted = await chrome.permissions.contains({ origins: [origin] });
  if (!granted) throw new Error("请先在设置中允许此 AI 服务的网址访问权限。");
  let response;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const useJsonMode = jsonMode && (/deepseek/i.test(config.endpoint || "") || /deepseek/i.test(config.model || ""));
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, temperature: 0.35, max_tokens: maxTokens, ...(useJsonMode ? { response_format: { type: "json_object" } } : {}) }),
      signal: controller.signal
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error(`AI 服务连接超时（20 秒）：${hostOf(url)}。请检查 API 地址、网络或服务状态。`);
    throw new Error(`无法连接 AI 服务：${hostOf(url)}。请检查 API 地址、网络，并在「设置」点击“测试连接”授权该服务。`);
  } finally {
    clearTimeout(timeout);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message || `AI 服务返回 ${response.status}`);
  const content = body?.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map(part => part?.text || "").join("") : content;
  if (!text) throw new Error("AI 服务没有返回内容。");
  return text;
}

// 流式调用 AI（SSE）：逐字增量通过 onDelta 回调返回。
// 用于 parseResume（纯文本输出，逐字显示体验好）；analyze/generateQueue 保持非流式（JSON 输出流式无意义）。
async function callAIStream({ config, messages, maxTokens = 1800, onDelta }) {
  assertSafeEndpoint(config.endpoint);
  const url = endpointUrl(config.endpoint);
  const origin = new URL(url).origin + "/*";
  const granted = await chrome.permissions.contains({ origins: [origin] });
  if (!granted) throw new Error("请先在设置中允许此 AI 服务的网址访问权限。");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, messages, temperature: 0.35, max_tokens: maxTokens, stream: true }),
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error?.name === "AbortError") throw new Error(`AI 服务连接超时（60 秒）：${hostOf(url)}。请检查 API 地址、网络或服务状态。`);
    throw new Error(`无法连接 AI 服务：${hostOf(url)}。请检查 API 地址、网络，并在「设置」点击“测试连接”授权该服务。`);
  }
  if (!response.ok) {
    clearTimeout(timeout);
    const body = await response.json().catch(() => ({}));
    throw new Error(body?.error?.message || `AI 服务返回 ${response.status}`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed?.choices?.[0]?.delta?.content || "";
          if (delta) { fullText += delta; if (onDelta) onDelta(delta, fullText); }
        } catch (e) {
          // PORT_DISCONNECTED 由 onDelta 抛出，需冒泡到外层 finally（释放 reader）再交由 onConnect catch；
          // 其余（JSON.parse 失败）静默跳过。
          if (e?.message === "PORT_DISCONNECTED") throw e;
        }
      }
    }
  } finally {
    clearTimeout(timeout);
    try { reader.cancel(); } catch (_) {}
  }
  if (!fullText) throw new Error("AI 服务没有返回内容。");
  return fullText;
}

function jsonFrom(text) {
  // DeepSeek Flash 等文本模型可能在 JSON 前后返回说明或思考内容；只提取首个完整 JSON 对象。
  const raw = String(text || "").replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const candidates = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map(match => match[1].trim());
  candidates.push(raw);
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch (_) {}
    const start = candidate.indexOf("{");
    if (start < 0) continue;
    let depth = 0; let quoted = false; let escaped = false;
    for (let index = start; index < candidate.length; index++) {
      const char = candidate[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') { quoted = true; continue; }
      if (char === "{") depth++;
      if (char === "}" && --depth === 0) {
        try { return JSON.parse(candidate.slice(start, index + 1)); } catch (_) { break; }
      }
    }
  }
  throw new Error("AI 返回的内容不是可读取的 JSON。请确认模型支持文本对话，并重试。");
}

function jobIdentityKeys(job) {
  const keys = new Set();
  const add = (value) => {
    const text = String(value || "").trim();
    if (!text) return;
    keys.add(text);
    try {
      const url = new URL(text);
      keys.add(`${url.origin}${url.pathname}`);
      const match = url.pathname.match(/\/job_detail\/([^./?]+)(?:\.html)?/);
      if (match) keys.add(`jobId:${match[1]}`);
    } catch (_) {}
  };
  if (job?.jobId) add(`jobId:${job.jobId}`);
  add(job?.key);
  add(job?.detailUrl);
  // 职位列表页的 url 对所有岗位都相同，只有缺少具体 jobId/detailUrl 时才作为兜底。
  if (!job?.jobId && !job?.detailUrl && !job?.key) add(job?.url);
  const fallback = [job?.company, job?.title, job?.location].map(value => String(value || "").trim()).join("|");
  if (fallback !== "||") keys.add(`fallback:${fallback}`);
  return [...keys];
}

function sameJob(first, second) {
  const secondKeys = new Set(jobIdentityKeys(second));
  return jobIdentityKeys(first).some(key => secondKeys.has(key));
}

function dedupeJobLibrary(jobLibrary) {
  const unique = [];
  for (const job of Array.isArray(jobLibrary) ? jobLibrary : []) {
    if (!unique.some(existing => sameJob(existing, job))) unique.push(job);
  }
  return unique;
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

function escapeCsv(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

async function exportJobs() {
  const jobLibrary = await getJobLibrary();
  const columns = [
    ["投递时间", "sentAt"], ["岗位名称", "title"], ["公司", "company"], ["地点", "location"],
    ["薪资", "salary"], ["完整JD", "description"], ["打招呼语", "greeting"],
    ["投递状态", "status"], ["岗位链接", "url"]
  ];
  const csv = "\uFEFF" + [columns.map(([label]) => escapeCsv(label)).join(","), ...jobLibrary.map(job => columns.map(([, key]) => escapeCsv(key === "url" ? (job.detailUrl || job.url) : job[key])).join(","))].join("\r\n");
  const url = `data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`;
  await chrome.downloads.download({ url, filename: `猎投-岗位库-${new Date().toISOString().slice(0, 10)}.csv`, saveAs: true });
}

let queueRunning = false;
let queueStopRequested = false;
let queueBatch = { current: 0, total: 0 };
let workerTabId = null;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const queueMutex = mutex();

async function getQueue() {
  const { deliveryQueue = [] } = await chrome.storage.local.get("deliveryQueue");
  // 只读：成功岗位在投递完成时已从清单移除，这里不再写回，避免与并发写者竞争。
  return deliveryQueue.filter(item => item.status !== "已成功");
}

async function setQueue(queue) {
  await chrome.storage.local.set({ deliveryQueue: queue });
}

async function queueJob(job) {
  return queueMutex.run(async () => {
    const queue = await getQueue();
    const key = job.jobId || job.detailUrl;
    if (!key) throw new Error("未读取到岗位唯一标识，请在岗位页重新分析后再加入清单。");
    if (queue.some(item => item.key === key)) throw new Error("该岗位已在投递清单中。");
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
    await chrome.scripting.executeScript({ target: { tabId }, files: ["selectors.js", "content.js"] });
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

async function ensureWorker(url) {
  try {
    if (workerTabId) await chrome.tabs.get(workerTabId);
  } catch (_) { workerTabId = null; }
  if (!workerTabId) workerTabId = (await chrome.tabs.create({ url, active: false })).id;
  else await chrome.tabs.update(workerTabId, { url, active: false });
  return workerTabId;
}

async function runQueue() {
  if (queueRunning) throw new Error("投递清单正在执行中。");
  queueRunning = true;
  queueStopRequested = false;
  const MAX_CONSECUTIVE_FAILURES = 3;
  let consecutiveFailures = 0;
  try {
    const items = (await getQueue()).filter(item => ["待投递", "待确认"].includes(item.status)).slice(0, 20);
    if (!items.length) throw new Error("没有待投递岗位。");
    queueBatch = { current: 0, total: items.length };
    for (let index = 0; index < items.length; index++) {
      if (queueStopRequested) {
        await updateQueueItem(items[index].key, { status: "已停止", progress: "", error: "用户已停止本轮投递" }).catch(() => {});
        await appendDeliveryLog({ jobKey: items[index].key, jobTitle: items[index].title, step: "用户停止", status: "stop", message: "用户已停止本轮投递" });
        break;
      }
      const item = items[index];
      queueBatch.current = index + 1;
      await updateQueueItem(item.key, { status: "投递中", progress: `正在投递第 ${queueBatch.current}/${queueBatch.total} 个岗位：打开岗位详情`, error: "" });
      try {
        if (!item.greeting || !item.greeting.trim()) throw new Error("招呼语为空，已跳过；请先批量生成招呼语。");
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
        try { await waitForTab(tabId, "/web/geek/chat"); }
        catch (_) {
          // BOSS 偶发“会话已建但页面没有跳转”。参考社区最佳实践，再点一次继续沟通后重等一次。
          await updateQueueItem(item.key, { progress: "沟通页未跳转，正在重试" });
          const retryOpen = await sendToTab(tabId, { type: "OPEN_COMMUNICATION" });
          if (!retryOpen?.ok) throw new Error(retryOpen?.error || "沟通页未跳转，重试点击失败");
          await waitForTab(tabId, "/web/geek/chat");
        }
        await appendDeliveryLog({ jobKey: item.key, jobTitle: item.title, step: "打开沟通页", status: "ok" });
        await updateQueueItem(item.key, { progress: "正在发送招呼语和简历图片" });
        const sent = await sendToTab(tabId, { type: "SEND_MESSAGE", greeting: item.greeting, images: (await chrome.storage.local.get("config")).config?.resumeImages || [] });
        if (!sent?.ok) throw new Error(sent?.error || "发送失败");
        await appendDeliveryLog({ jobKey: item.key, jobTitle: item.title, step: "发送招呼语", status: "ok", message: sent.resume?.sent ? "简历图片已确认送达" : (sent.resume?.reason || "未发送简历") });
        await saveJob({ ...item, status: "已沟通", sentAt: new Date().toLocaleString("zh-CN"), resumeStatus: sent.resume?.sent ? "简历图片已确认送达" : (sent.resume?.reason || "未发送") });
        await appendDeliveryLog({ jobKey: item.key, jobTitle: item.title, step: "投递完成", status: "ok" });
        // 岗位库已保存成功记录，待投递清单实时移除，避免和历史记录重复出现。
        await removeQueueItem(item.key);
        consecutiveFailures = 0;
      } catch (error) {
        consecutiveFailures++;
        const message = logError(`投递岗位「${item.title}」`, error);
        await updateQueueItem(item.key, { status: "失败", progress: "", error: message });
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
      const text = await callAI(message.payload);
      sendResponse({ ok: true, text });
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
      sendResponse({ ok: true, queue: await getQueue(), running: queueRunning, batch: queueBatch });
    } else if (message.type === "QUEUE_UPDATE") {
      sendResponse({ ok: true, item: await updateQueueItem(message.key, message.patch || {}) });
    } else if (message.type === "QUEUE_REMOVE") {
      sendResponse({ ok: await removeQueueItem(message.key) });
    } else if (message.type === "QUEUE_REMOVE_MANY") {
      const result = await removeQueueItems(message.keys);
      sendResponse({ ok: result.removedCount === result.requestedCount, ...result });
    } else if (message.type === "QUEUE_START") {
      if (queueRunning) { sendResponse({ ok: true, alreadyRunning: true }); return; }
      const count = (await getQueue()).filter(item => ["待投递", "待确认"].includes(item.status)).slice(0, 20).length;
      if (!count) throw new Error("没有已生成招呼语的岗位。");
      queueRunning = true; // 在 await 让出前同步置锁，避免并发 QUEUE_START 双启动。
      runQueue().catch(error => console.error("[猎投] runQueue 失败：", error));
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
  })().catch(error => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
});

// 流式 AI 调用：panel 端通过 chrome.runtime.connect 建立长连接，
// background 读 SSE 并 port.postMessage({ type: "DELTA", text }) 逐字推送累计全文，
// 完成后 postMessage({ type: "DONE", text })，出错 postMessage({ type: "ERROR", error })。
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "AI_CALL_STREAM") return;
  port.onMessage.addListener(async (message) => {
    if (message.type !== "AI_CALL_STREAM") return;
    try {
      const fullText = await callAIStream({
        config: message.payload.config,
        messages: message.payload.messages,
        maxTokens: message.payload.maxTokens,
        onDelta: (_delta, full) => {
          try { port.postMessage({ type: "DELTA", text: full }); }
          catch (_) { throw new Error("PORT_DISCONNECTED"); }
        },
      });
      try { port.postMessage({ type: "DONE", text: fullText }); }
      catch (_) { /* port 已断开，无需通知 */ }
    } catch (error) {
      try { port.postMessage({ type: "ERROR", error: error.message || String(error) }); }
      catch (_) { /* port 已断开，无需通知 */ }
    }
  });
});
