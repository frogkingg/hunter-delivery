// 扫描/填充会话诊断包构建与脱敏。纯函数模块，Node 可测。

export const DIAG_MAX_ENTRIES = 100;

const PHONE = /\d{7,}/g;
const ID_CARD = /\d{17}[\dXx]/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// 文本内嵌 URL（到空白/中文标点/括号为止），逐个去除 query 与 hash。
const URL_IN_TEXT = /https?:\/\/[^\s，。；、）)"']+/g;

export function redactText(text) {
  let out = String(text ?? "");
  out = out.replace(ID_CARD, "***").replace(PHONE, "***").replace(EMAIL, "***");
  out = out.replace(URL_IN_TEXT, (m) => {
    try {
      const url = new URL(m);
      url.search = "";
      url.hash = "";
      return url.toString();
    } catch (_) { /* 非法 URL 原样返回 */ }
    return m;
  });
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
