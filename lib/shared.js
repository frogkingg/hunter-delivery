// background.js 使用的纯函数。
// 面板端对应函数已迁移至 src/pure-utils.js 和 src/prompts.js。

export const DEFAULTS = {
  endpoint: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  apiKey: "",
  candidateProfile: "",
  greetingPrompt: "",
  resumeImages: []
};

// —— AI 端点校验 ——

export function endpointUrl(endpoint) {
  const base = String(endpoint || "").trim().replace(/\/$/, "");
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}

export function hostOf(url) { try { return new URL(url).host; } catch (_) { return "AI 服务"; } }

// 私有/内网主机判断，供 assertSafeEndpoint 复用。
function isPrivateHost(host) {
  const h = String(host || "").toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(h);
}

export function assertSafeEndpoint(endpoint) {
  const base = String(endpoint || "").trim();
  if (!base) throw new Error("未配置 AI API 地址。");
  let url;
  try { url = new URL(base); } catch (_) { throw new Error("AI API 地址格式不正确。"); }
  if (url.protocol !== "https:") throw new Error("AI 服务地址必须为 https://，明文 http 会泄露简历内容。");
  if (isPrivateHost(url.hostname)) throw new Error("不允许使用本地或内网地址作为 AI 服务。");
}

// —— AI 返回解析 ——

export function jsonFrom(text) {
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

// —— 岗位身份与去重 ——

export function jobIdentityKeys(job) {
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

export function sameJob(first, second) {
  const secondKeys = new Set(jobIdentityKeys(second));
  return jobIdentityKeys(first).some(key => secondKeys.has(key));
}

export function dedupeJobLibrary(jobLibrary) {
  const unique = [];
  for (const job of Array.isArray(jobLibrary) ? jobLibrary : []) {
    if (!unique.some(existing => sameJob(existing, job))) unique.push(job);
  }
  return unique;
}

// —— 岗位库 ——

// 清洗投递清单中的临时字段，避免它们被 spread 进岗位库长期留存或导出。
export function sanitizeJobForLibrary(job) {
  const { progress, error, rawAiResponse, queuedAt, status, ...rest } = job || {};
  return rest;
}

export function escapeCsv(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}
