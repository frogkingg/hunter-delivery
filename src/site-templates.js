// 智能填充：站点模板记忆（按 hostname 记忆字段映射，供下次同站复用）。
// 纯函数模块，Node 可测。
import { validateBinding } from "./matcher.js";

export const TEMPLATE_MAX = 50;
export const TEMPLATE_SCHEMA_VERSION = 2;

// 模板按 hostname + form fingerprint 隔离；无 fingerprint 时仅返回 hostname 兼容调用方。
export function templateKey(url, formFingerprint = "") {
  let host = "";
  try { host = new URL(url).hostname; } catch (_) { host = String(url || "").split("/")[0]; }
  return formFingerprint ? `${host}::${formFingerprint}` : host;
}

function mappingIdentity(mapping) {
  return mapping.fieldFingerprint
    || `${mapping.siteLabel || ""}|${mapping.controlType || ""}|${mapping.slot || "single"}|${mapping.fieldKey || ""}`;
}

function mappingFromMatch(match, now) {
  return {
    fieldFingerprint: match.fingerprint || "",
    pathHint: match.path || "",
    siteLabel: match.label ?? match.rawLabel ?? "",
    controlType: match.type || "text",
    slot: match.slot || "single",
    fieldKey: match.fieldKey,
    valueRef: match.valueRef?.source === "resume" ? match.valueRef : { source: "resume", path: match.fieldKey },
    userConfirmed: !!match.userConfirmed,
    updatedAt: now,
  };
}

// Template V2 只保存语义映射，不保存 profile 相关具体值。
export function buildTemplateFromMatches(host, origin, matches, options = {}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    host,
    origin,
    scope: {
      origin,
      formFingerprint: options.formFingerprint || "",
      routePattern: options.routePattern || "",
    },
    mappings: (Array.isArray(matches) ? matches : [])
      .filter(m => m.status === "match" && m.fieldKey && m.fingerprint)
      .map(match => mappingFromMatch(match, now)),
    updatedAt: now,
  };
}

function findMapping(match, mappings) {
  if (!match.fingerprint) return null;
  const exact = mappings.filter(mapping => mapping.fieldFingerprint === match.fingerprint);
  return exact.length === 1 ? exact[0] : null;
}

// 套用模板时按当前 profile 解析 valueRef，并再次经过中央绑定校验。
export function applyTemplate(matches, template, resumeFields = {}, options = {}) {
  if (!template || template.schemaVersion !== TEMPLATE_SCHEMA_VERSION || !Array.isArray(template.mappings)) return matches;
  if (options.formFingerprint && template.scope?.formFingerprint && options.formFingerprint !== template.scope.formFingerprint) return matches;
  return (matches || []).map(match => {
    const mapping = findMapping(match, template.mappings);
    if (!mapping?.fieldKey || mapping.valueRef?.source !== "resume") return match;
    const validated = validateBinding(match, mapping.fieldKey, resumeFields, {
      source: "template",
      confidence: "high",
      userConfirmed: !!mapping.userConfirmed,
      valueRef: mapping.valueRef,
      reason: `站点模板语义映射（${mapping.fieldKey}）`,
    });
    if (validated.status !== "match") return { ...match, reason: validated.reason };
    return {
      ...match,
      ...validated,
      templateMappingFingerprint: mapping.fieldFingerprint || mappingIdentity(mapping),
    };
  });
}

// 保存/更新模板：同一 form fingerprint 内按字段身份合并，分步表单的历史映射保留。
export function saveTemplateFromResults(host, origin, matches, existingTemplate, options = {}) {
  const fresh = buildTemplateFromMatches(host, origin, matches, options);
  const sameScope = existingTemplate?.schemaVersion === TEMPLATE_SCHEMA_VERSION
    && existingTemplate.host === host
    && (!fresh.scope.formFingerprint || existingTemplate.scope?.formFingerprint === fresh.scope.formFingerprint);
  const priorMappings = sameScope ? existingTemplate.mappings || [] : [];
  const merged = fresh.mappings.map(freshMapping => {
    const prior = priorMappings.find(mapping => mappingIdentity(mapping) === mappingIdentity(freshMapping));
    return { ...freshMapping, userConfirmed: freshMapping.userConfirmed || !!prior?.userConfirmed };
  });
  for (const prior of priorMappings) {
    const exists = merged.some(mapping => mappingIdentity(mapping) === mappingIdentity(prior));
    if (!exists) merged.push(prior);
  }
  return { ...fresh, mappings: merged, updatedAt: new Date().toISOString() };
}

// 站点模板容器上限：按 updatedAt 保留最新 TEMPLATE_MAX 个站点。
export function capTemplates(templates) {
  const entries = Object.entries(templates || {}).sort((a, b) => {
    const ta = (a[1] && a[1].updatedAt) || "";
    const tb = (b[1] && b[1].updatedAt) || "";
    return ta < tb ? -1 : ta > tb ? 1 : 0;
  });
  const kept = entries.slice(Math.max(0, entries.length - TEMPLATE_MAX));
  return Object.fromEntries(kept);
}
