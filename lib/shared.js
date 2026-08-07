// background.js 使用的纯函数。
// 面板端对应函数已迁移至 src/pure-utils.js 和 src/prompts.js。

export const DEFAULTS = {
  endpoint: "https://api.openai.com/v1",
  model: "gpt-4.1-mini",
  apiKey: "",
  disableThinking: true,
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

// IPv4-mapped IPv6（如 ::ffff:7f00:1）还原为点分 IPv4，复用 IPv4 网段判断。
function ipv4FromIpv6Mapped(host) {
  const dotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (dotted) return dotted[1];
  const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join(".");
  }
  return null;
}

// IPv6 私网/内网判断：回环、未指定、IPv4-mapped、ULA（fc00::/7）、link-local（fe80::/10）。
function isPrivateIpv6(host) {
  if (host === "::" || host === "::1" || host === "0:0:0:0:0:0:0:1") return true;
  const mapped = ipv4FromIpv6Mapped(host);
  if (mapped) return isPrivateHost(mapped);
  const first = host.split(":")[0];
  // ULA fc00::/7：首段以 fc/fd 开头；link-local fe80::/10：首段以 fe8/fe9/fea/feb 开头。
  if (/^f[cd]/.test(first)) return true;
  if (/^fe[89ab]/.test(first)) return true;
  return false;
}

// 私有/内网主机判断，供 assertSafeEndpoint / validateEndpoint 复用。
function isPrivateHost(host) {
  // URL.hostname 对 IPv6 保留方括号（如 "[::1]"），统一去掉后再判断。
  const h = String(host || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || /^127\./.test(h)) return true;
  if (h.includes(":")) return isPrivateIpv6(h);
  // 标准点分 IPv4：按网段判断，避免依赖前缀字符串匹配漏掉 127/8 等网段。
  const ipv4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const octets = ipv4.slice(1).map(Number);
    if (octets.some(n => n > 255)) return true; // 非标准 IPv4 一律视为不可信
    const [a, b] = octets;
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||   // CGNAT 100.64/10
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168);
  }
  return false;
}

// 统一的端点校验：https + 非内网/私网 + 无凭据。返回 trim 后的地址。
export function validateEndpoint(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) throw new Error("请先填写 AI API 地址。");
  let url;
  try { url = new URL(trimmed); } catch (_) { throw new Error("AI API 地址格式不正确。"); }
  if (url.protocol !== "https:") throw new Error("AI 服务地址必须为 https://，明文 http 会泄露简历内容。");
  if (url.username || url.password) throw new Error("AI 服务地址不能包含用户名或密码。");
  if (isPrivateHost(url.hostname)) throw new Error("不允许使用本地或内网地址作为 AI 服务。");
  return trimmed;
}

export function assertSafeEndpoint(endpoint) {
  const base = String(endpoint || "").trim();
  if (!base) throw new Error("未配置 AI API 地址。");
  let url;
  try { url = new URL(base); } catch (_) { throw new Error("AI API 地址格式不正确。"); }
  if (url.protocol !== "https:") throw new Error("AI 服务地址必须为 https://，明文 http 会泄露简历内容。");
  if (url.username || url.password) throw new Error("AI 服务地址不能包含用户名或密码。");
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

export function jobIdOf(job) {
  const explicit = String(job?.jobId || "").trim();
  if (explicit) return explicit;
  for (const value of [job?.detailUrl, job?.key, job?.url]) {
    const text = String(value || "").trim();
    if (!text) continue;
    const direct = text.match(/^jobId:(.+)$/);
    if (direct) return direct[1].trim();
    try {
      const match = new URL(text).pathname.match(/\/job_detail\/([^./?]+)(?:\.html)?/);
      if (match) return match[1];
    } catch (_) {}
  }
  return "";
}

export function jobIdentityKeys(job) {
  const keys = new Set();
  const add = (value) => {
    const text = String(value || "").trim();
    if (!text) return;
    keys.add(text);
    if (!/^https?:\/\//i.test(text)) return;
    try {
      const url = new URL(text);
      keys.add(`${url.origin}${url.pathname}`);
      const match = url.pathname.match(/\/job_detail\/([^./?]+)(?:\.html)?/);
      if (match) keys.add(`jobId:${match[1]}`);
    } catch (_) {}
  };
  const jobId = jobIdOf(job);
  const hasStrongIdentity = !!(jobId || job?.key || job?.detailUrl);
  if (jobId) add(`jobId:${jobId}`);
  add(job?.key);
  add(job?.detailUrl);
  // 只有缺少强身份时，才使用页面 URL 和公司/标题/地点作为保守兜底。
  if (!hasStrongIdentity) {
    const fallback = [job?.company, job?.title, job?.location].map(value => String(value || "").trim()).join("|");
    if (fallback !== "||") keys.add(`fallback:${fallback}`);
    else add(job?.url);
  }
  return [...keys];
}

export function sameJob(first, second) {
  const firstJobId = jobIdOf(first);
  const secondJobId = jobIdOf(second);
  if (firstJobId && secondJobId) return firstJobId === secondJobId;
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
  const { progress, error, rawAiResponse, queuedAt, ...rest } = job || {};
  return rest;
}

export function escapeCsv(value) {
  // 单元格以 = + - @ 或制表符/回车开头时，Excel/WPS 会按公式解析，前置单引号中和。
  const text = String(value ?? "");
  const neutralized = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${neutralized.replace(/"/g, '""')}"`;
}


// 沟通失败时的页面快照文案（纯函数）：把探针结果格式化为可读诊断。
export function buildCommunicationProbeText(probe) {
  if (!probe) return "";
  const dialogs = (probe.dialogs || [])
    .map(d => (d.text ? `${d.className || ""}「${d.text}」` : d.className || ""))
    .filter(Boolean)
    .join(" | ") || "无";
  return `页面=${probe.url || ""}；聊天输入框=${probe.hasComposer ? "有" : "无"}；可见弹层=${dialogs}`;
}
