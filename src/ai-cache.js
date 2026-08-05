// AI 映射缓存：按页面结构签名缓存 AI 的 fieldKey 建议。
// 纯函数模块，Node 可测。签名 = 字段证据规范化后的有序哈希。
// 注：writeCache 原地写入 store 并返回同一对象，兼容测试与返回值两种调用方式。

export const AI_CACHE_MAX = 100;
export const AI_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function structureSignature(fields, options = {}) {
  const parts = (Array.isArray(fields) ? fields : [])
    .filter(f => f?.status !== "skipped")
    .map(f => `${f.label}|${f.type}|${f.slot || "single"}|${(f.options || []).join("/")}|${f.context?.sectionKey || ""}`)
    .sort();
  return stableHash(JSON.stringify(parts) + (options.extra || ""));
}

function entryKey(signature, engineVersion, model) {
  return `${signature}::v${engineVersion}::${model || "default"}`;
}

export function readCache(store, signature, engineVersion, model, now = Date.now()) {
  const key = entryKey(signature, engineVersion, model);
  const entry = store?.[key];
  if (!entry) return null;
  if (now - new Date(entry.createdAt).getTime() > AI_CACHE_TTL_MS) return null;
  return entry.entries;
}

export function writeCache(store, input, createdAt = new Date().toISOString()) {
  const target = store || {};
  const key = entryKey(input.signature, input.engineVersion, input.model || "default");
  target[key] = { createdAt, entries: input.entries || [] };
  const keys = Object.keys(target).sort((a, b) => (target[a].createdAt < target[b].createdAt ? -1 : 1));
  while (keys.length > AI_CACHE_MAX) {
    delete target[keys.shift()];
  }
  return target;
}
