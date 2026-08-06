// 扫描/填充会话诊断包构建与脱敏。纯函数模块，Node 可测。

export const DIAG_MAX_ENTRIES = 100;

const PHONE = /\d{7,}/g;
// 带空格/连字符分隔的 11 位手机号（如 138 1234 5678 / 138-1234-5678）。
const PHONE_SEPARATED = /1\d{2}[\s-]?\d{4}[\s-]?\d{4}/g;
const ID_CARD = /\d{17}[\dXx]/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 文本内嵌 URL（到空白/中文标点/括号为止）。先整体剥离 userinfo（避免 user:pass@ 被
// EMAIL 正则先行破坏导致 URL 解析失败），再去除 query 与 hash。
const URL_IN_TEXT = /https?:\/\/[^\s，。；、）)"']+/g;

export function redactText(text) {
  let out = String(text ?? "");
  // URL 优先处理：userinfo 中的 user:pass@ 若先被 EMAIL 正则替换，URL 会变成非法形态而无法剥离 query。
  out = out.replace(URL_IN_TEXT, (m) => {
    try {
      const url = new URL(m);
      url.username = "";
      url.password = "";
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch (_) { /* 非法 URL 原样返回 */ }
    return m;
  });
  out = out.replace(ID_CARD, "***").replace(PHONE_SEPARATED, "***").replace(PHONE, "***").replace(EMAIL, "***");
  return out;
}

export function buildDiagnostics(input = {}) {
  const fields = (input.fields || []).slice(0, DIAG_MAX_ENTRIES).map(f => ({
    id: f.id, label: redactText(f.label), type: f.type,
  }));
  const failures = (input.failures || []).slice(0, DIAG_MAX_ENTRIES).map(f => ({
    fieldId: f.fieldId, siteLabel: redactText(f.siteLabel), type: f.type, reason: redactText(f.reason),
  }));
  return {
    engineVersion: input.engineVersion,
    scanId: input.scanId,
    url: redactText(input.url),
    fields,
    matchedBy: input.matchedBy || {},
    failures,
    ai: input.ai ? { requested: !!input.ai.requested, model: input.ai.model || "", fieldsSent: (input.ai.fieldsSent || []).slice(0, DIAG_MAX_ENTRIES) } : null,
    timings: input.timings || {},
    durationMs: input.durationMs || 0,
  };
}