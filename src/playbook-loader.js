// playbook 加载/匹配/校验。纯函数模块，Node 可测。
// playbook 复用 Template V2 语义映射 schema，随扩展发布（只读）。

const FIELD_KEYS = new Set([
  "name", "phone", "email", "gender", "birthDate", "school", "degree", "major",
  "graduationYear", "currentCity", "expectedCity", "expectedSalary", "expectedPosition",
  "workYears", "currentCompany", "currentTitle", "selfEvaluation", "idCard",
]);

export function validatePlaybook(pb) {
  if (!pb || pb.schemaVersion !== 2) return { ok: false, error: "schemaVersion 必须为 2" };
  if (!pb.host) return { ok: false, error: "缺少 host" };
  if (!Array.isArray(pb.mappings)) return { ok: false, error: "缺少 mappings" };
  for (const m of pb.mappings) {
    if (!FIELD_KEYS.has(m.fieldKey)) return { ok: false, error: `未知 fieldKey: ${m.fieldKey}` };
    if (!m.siteLabel || !m.controlType) return { ok: false, error: `mapping 缺少 siteLabel/controlType: ${m.fieldKey}` };
  }
  return { ok: true };
}

export function parseRoutePattern(pattern) {
  const escaped = String(pattern || "/**").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

export function findPlaybook(playbooks, url) {
  let host = "";
  try { host = new URL(url).hostname; } catch (_) { host = String(url || "").split("/")[0]; }
  const path = (() => { try { return new URL(url).pathname; } catch (_) { return ""; } })();
  for (const pb of playbooks || []) {
    if (pb.host !== host) continue;
    if (pb.scope?.routePattern && !parseRoutePattern(pb.scope.routePattern).test(path)) continue;
    return pb;
  }
  return null;
}
