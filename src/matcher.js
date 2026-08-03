// 智能填充：匹配引擎（规则层 + AI 兜底编排）。
// 纯函数模块（aiCall 由调用方注入），Node 可测。
import { CANONICAL_FIELDS, FIELD_BY_KEY, RESUME_FIELD_LABELS, normalizeLabel } from "./form-fields.js";

// 关键词与标签同样去掉全部空白后做子串匹配（中英文标签都可能带空格/全角空格）。
const normalizeKeyword = keyword => String(keyword || "").replace(/\s+/g, "").toLowerCase();

function bestKeywordHit(label, keywords) {
  let best = { length: 0, keyword: "" };
  for (const keyword of keywords) {
    const normalized = normalizeKeyword(keyword);
    if (normalized && label.includes(normalized) && normalized.length > best.length) {
      best = { length: normalized.length, keyword: normalized };
    }
  }
  return best;
}

function confidenceFor(hit, label) {
  if (!hit.length) return null;
  if (hit.length >= 4) return "high";
  if (hit.length === 3) return "high";
  if (hit.length === 2) return label === hit.keyword ? "high" : "medium";
  return "low";
}

// 规则层匹配（同步）：对每个表单项找命中关键词最长的规范字段。
export function matchRules(fields, resumeFields) {
  const resume = resumeFields || {};
  return (Array.isArray(fields) ? fields : []).map(field => {
    const base = { fieldId: field.id, fieldKey: "", value: "", confidence: null, source: "rule", status: "manual", reason: "", label: field.label ?? field.rawLabel ?? "", type: field.type ?? "text" };
    if (field.skipped) return { ...base, reason: "该控件不支持自动填充（密码/文件/隐藏）" };
    const label = normalizeLabel(field.label);
    if (!label) return { ...base, reason: "未识别到字段标签" };
    let best = { length: 0, keyword: "", key: "" };
    for (const canonical of CANONICAL_FIELDS) {
      const hit = bestKeywordHit(label, canonical.keywords);
      if (hit.length > best.length) best = { ...hit, key: canonical.key };
    }
    if (!best.key) return { ...base, reason: "未识别字段含义" };
    const value = String(resume[best.key] ?? "").trim();
    const confidence = confidenceFor(best, label);
    if (!value) return { ...base, fieldKey: best.key, confidence, reason: `简历中缺少「${RESUME_FIELD_LABELS[best.key]}」信息` };
    if (field.type === "checkbox" && !/^(是|有|true|1|同意|愿意|会|否|无|false|0|不同意|不愿意|不会)$/i.test(value)) {
      return { ...base, fieldKey: best.key, value, confidence, status: "manual", reason: "勾选框需手动确认（简历值非明确布尔）" };
    }
    if ((field.type === "select" || field.type === "radio") && Array.isArray(field.options) && field.options.length) {
      const expected = value.replace(/\s+/g, "").toLowerCase();
      const hit = field.options.some(option => {
        const text = String(option || "").replace(/\s+/g, "").toLowerCase();
        return text && (text === expected || text.includes(expected) || expected.includes(text));
      });
      if (!hit) {
        return { ...base, fieldKey: best.key, value, confidence, status: "manual", reason: "简历值与页面选项不匹配，请手动选择" };
      }
    }
    return { ...base, fieldKey: best.key, value, confidence, status: "match", reason: `规则命中「${RESUME_FIELD_LABELS[best.key]}」` };
  });
}

// AI 结果合并：仅补全 manual 或低置信字段；未知 fieldKey / 空值保持 manual。
export function applyAiResults(matches, aiResults) {
  const byField = new Map();
  for (const entry of Array.isArray(aiResults) ? aiResults : []) {
    if (!byField.has(String(entry?.fieldId ?? ""))) byField.set(String(entry?.fieldId ?? ""), entry);
  }
  return (matches || []).map(match => {
    const entry = byField.get(match.fieldId);
    if (!entry) return match;
    const needsAi = match.status === "manual" || match.confidence === "low";
    if (!needsAi) return match;
    const key = String(entry.fieldKey || "").trim();
    const value = String(entry.value ?? "").trim();
    if (!FIELD_BY_KEY[key]) return { ...match, source: "ai", reason: "AI 未返回有效字段 key" };
    if (!value) return { ...match, source: "ai", status: "manual", reason: "AI 未能确定该字段值" };
    const confidence = ["high", "medium", "low"].includes(entry.confidence) ? entry.confidence : "medium";
    return { ...match, fieldKey: key, value, confidence, source: "ai", status: "match", reason: "AI 匹配" };
  });
}

// 构造 AI 匹配请求（返回 messages，jsonMode=true 由调用方设置）。
export function buildAiMatchPrompt(needsMatch, resumeFields) {
  const fields = needsMatch.map(m => ({ fieldId: m.fieldId, label: m.label ?? m.rawLabel ?? "", type: m.type ?? "text" }));
  const allowedKeys = CANONICAL_FIELDS.map(f => f.key).join("、");
  const content = `你是简历表单填写助手。根据简历内容，为下列网申表单字段匹配简历字段值。
可用简历字段 key（必须从中选择，无法确定则 fieldKey 为空字符串、value 为空字符串）：${allowedKeys}
简历字段 key 对照：${CANONICAL_FIELDS.map(f => `${f.key}=${f.label}`).join("；")}
简历字段值：${JSON.stringify(resumeFields || {})}
表单字段：${JSON.stringify(fields)}
只输出 JSON 数组，形如 [{"fieldId":"...","fieldKey":"...","value":"...","confidence":"high|medium|low","reason":"..."}]。
value 必须原样取自简历字段，不要改写、拼接或编造。`;
  return [{ role: "user", content }];
}

// 完整匹配：规则层 → 可选 AI 兜底。
export async function matchFields(fields, resumeFields, options = {}) {
  let matches = matchRules(fields, resumeFields);
  if (options?.aiMatch && typeof options?.aiCall === "function") {
    const needs = matches.filter(m => m.status === "manual" || m.confidence === "low");
    if (needs.length) {
      try {
        const messages = buildAiMatchPrompt(needs, resumeFields);
        const aiResults = await options.aiCall(messages);
        matches = applyAiResults(matches, aiResults);
      } catch (_error) {
        // AI 失败不阻塞填充：未识别字段保持 manual，交给用户手动处理。
      }
    }
  }
  return matches;
}
