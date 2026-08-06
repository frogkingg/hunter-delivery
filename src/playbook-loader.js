// playbook 加载/匹配/校验。纯函数模块，Node 可测。
// playbook 复用 Template V2 语义映射 schema，随扩展发布（只读）。
import { isValidResumePath } from "./resume-fields.js";

const FIELD_KEYS = new Set([
  "name", "phone", "email", "gender", "birthDate", "school", "degree", "major",
  "graduationYear", "currentCity", "expectedCity", "expectedSalary", "expectedPosition",
  "workYears", "currentCompany", "currentTitle", "selfEvaluation", "idCard",
]);

// 与 fill-content 字段 slot 枚举对齐：single/start/end/prefix/main。
const SLOT_KEYS = new Set(["single", "start", "end", "prefix", "main"]);

export function validatePlaybook(pb) {
  if (!pb || pb.schemaVersion !== 2) return { ok: false, error: "schemaVersion 必须为 2" };
  if (!pb.host) return { ok: false, error: "缺少 host" };
  if (!Array.isArray(pb.mappings)) return { ok: false, error: "缺少 mappings" };
  if (pb.scope?.routePattern != null) {
    try {
      parseRoutePattern(pb.scope.routePattern);
    } catch (_) {
      return { ok: false, error: `routePattern 无法编译: ${pb.scope.routePattern}` };
    }
  }
  for (const m of pb.mappings) {
    if (!FIELD_KEYS.has(m.fieldKey)) return { ok: false, error: `未知 fieldKey: ${m.fieldKey}` };
    if (!m.siteLabel || !m.controlType) return { ok: false, error: `mapping 缺少 siteLabel/controlType: ${m.fieldKey}` };
    if (m.slot != null && !SLOT_KEYS.has(m.slot)) return { ok: false, error: `mapping ${m.fieldKey} 非法 slot: ${m.slot}` };
    // valueRef 声明了就必须能在当前简历 schema 上解析，防止"毕业时间/毕业院校"等映射静默失效。
    if (m.valueRef != null) {
      if (m.valueRef.source !== "resume" || !isValidResumePath(m.valueRef.path)) {
        return { ok: false, error: `mapping ${m.fieldKey} valueRef 路径无效: ${m.valueRef?.path || ""}` };
      }
    }
  }
  return { ok: true };
}

export function parseRoutePattern(pattern) {
  // 先转义正则特殊字符，再用占位符保护 **，最后处理单 * 并还原 **：
  // ** → .*（跨 / 匹配），单 * → [^/]*（不跨 /）。
  const escaped = String(pattern || "/**")
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*");
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