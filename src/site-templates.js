// 智能填充：站点模板记忆（按 hostname 记忆字段映射，供下次同站复用）。
// 纯函数模块，Node 可测。

export const TEMPLATE_MAX = 50;

// 站点模板 key：hostname（端口忽略，应用平台通常同一 host 共用一套表单）。
export function templateKey(url) {
  try { return new URL(url).hostname; } catch (_) { return String(url || "").split("/")[0]; }
}

// 由匹配结果构建模板：仅收录 match 且含 fieldKey 的字段。
export function buildTemplateFromMatches(host, origin, matches) {
  const now = new Date().toISOString();
  return {
    host,
    origin,
    fields: (Array.isArray(matches) ? matches : [])
      .filter(m => m.status === "match" && m.fieldKey)
      .map(m => ({ fieldKey: m.fieldKey, path: m.path || "", siteLabel: m.label ?? m.rawLabel ?? "", value: m.value ?? "", edited: !!m.edited, updatedAt: now })),
    updatedAt: now,
  };
}

// 把模板值套用到本次匹配：字段标签（归一化后）一致则覆盖为模板值。
export function applyTemplate(matches, template) {
  if (!template || !Array.isArray(template.fields)) return matches;
  return (matches || []).map(match => {
    const entry = template.fields.find(f => f.siteLabel === (match.label ?? match.rawLabel ?? "") && f.fieldKey === match.fieldKey);
    if (!entry || !entry.value) return match;
    return {
      ...match,
      value: entry.value,
      source: "template",
      status: "match",
      confidence: "high",
      reason: `站点模板记忆（${entry.fieldKey}）`,
      edited: !!entry.edited,
    };
  });
}

// 保存/更新模板：同名站点字段合并更新，新字段追加。
export function saveTemplateFromResults(host, origin, matches, existingTemplate) {
  const fresh = buildTemplateFromMatches(host, origin, matches);
  const priorFields = existingTemplate && existingTemplate.host === host ? existingTemplate.fields || [] : [];
  // 合并：本次扫描到的字段覆盖同名历史字段，历史字段（分步/分页表单未再扫描到的）保留追加。
  const merged = fresh.fields.map(freshField => {
    const prior = priorFields.find(p => p.fieldKey === freshField.fieldKey && p.siteLabel === freshField.siteLabel);
    // 保留历史 edited 标记：用户手动修正过的值优先级更高。
    return { ...freshField, edited: freshField.edited || !!(prior && prior.edited) };
  });
  for (const prior of priorFields) {
    const exists = merged.some(m => m.fieldKey === prior.fieldKey && m.siteLabel === prior.siteLabel);
    if (!exists) merged.push(prior);
  }
  return { host, origin, fields: merged, updatedAt: new Date().toISOString() };
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
