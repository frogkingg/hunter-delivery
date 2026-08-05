// 智能填充：匹配引擎（规则层 + AI 兜底编排）。
// 纯函数模块（aiCall 由调用方注入），Node 可测。
import {
  CANONICAL_FIELDS,
  FIELD_BY_KEY,
  RESUME_FIELD_LABELS,
  EVIDENCE_SOURCE_WEIGHTS,
  FIELD_CONSTRAINTS,
  normalizeLabel,
} from "./form-fields.js";
import { resolveResumeValueRef } from "./resume-fields.js";

// 关键词与标签同样去掉全部空白后做子串匹配（中英文标签都可能带空格/全角空格）。
const normalizeKeyword = keyword => String(keyword || "").replace(/\s+/g, "").toLowerCase();
const NORMALIZED_KEYWORDS = new Map(CANONICAL_FIELDS.map(field => [
  field.key,
  field.keywords.map(normalizeKeyword).filter(Boolean),
]));

// 敏感字段集合：默认强制人工，规则/模板/AI 均不可自动填为 match（除非 userConfirmed）。
// 覆盖规范 key（idCard/expectedSalary/politicalStatus/referral）与预留别名
// （salary/referrer/emergencyContact/guardian 等，防止未来新增规范字段时默认放开）。
export const SENSITIVE_FIELD_KEYS = new Set([
  "idCard", "salary", "expectedSalary", "emergencyContact", "emergencyPhone",
  "guardian", "guarantor", "referrer", "referral", "workAuthorization", "politicalStatus",
]);

function bestKeywordHit(label, keywords) {
  let best = { length: 0, keyword: "" };
  for (const normalized of keywords) {
    if (normalized && label.includes(normalized) && normalized.length > best.length) {
      best = { length: normalized.length, keyword: normalized };
    }
  }
  return best;
}

const COUNTRY_CODE_OPTION = /^\+?\d{1,4}$/;
const normalizeCompare = value => String(value || "").replace(/\s+/g, "").toLowerCase();
const BOOLEAN_VALUE = /^(是|有|true|1|同意|愿意|会|否|无|false|0|不同意|不愿意|不会)$/i;

function normalizeDateValue(value) {
  const text = String(value || "").trim();
  if (/^\d{4}$/.test(text) || /^\d{2}:\d{2}(?::\d{2})?$/.test(text)) return text;
  const dateTime = text.match(/^(\d{4})-(\d{2})-(\d{2})[T\s](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (dateTime) {
    return `${dateTime[1]}-${dateTime[2]}-${dateTime[3]}T${dateTime[4]}:${dateTime[5]}${dateTime[6] ? `:${dateTime[6]}` : ""}`;
  }
  let match = text.match(/^(\d{4})[-/.年](\d{1,2})(?:[-/.月](\d{1,2})日?)?$/);
  if (match) {
    const normalized = `${match[1]}-${String(match[2]).padStart(2, "0")}`;
    return match[3] ? `${normalized}-${String(match[3]).padStart(2, "0")}` : normalized;
  }
  match = text.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (match) return `${match[2]}-${String(match[1]).padStart(2, "0")}`;
  return text;
}

function datePrecision(value) {
  const text = normalizeDateValue(value);
  if (/^\d{4}$/.test(text)) return "year";
  if (/^\d{4}-\d{2}$/.test(text)) return "month";
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return "day";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(text)) return "datetime";
  if (/^\d{2}:\d{2}(?::\d{2})?$/.test(text)) return "time";
  return "";
}

function dateValueCompatible(field, value) {
  const precision = datePrecision(value);
  if (!precision) return false;
  const meta = field?.dateMeta || {};
  const nativeType = String(meta.nativeType || "").toLowerCase();
  const mode = String(meta.mode || "").toLowerCase();
  if (nativeType === "time" || mode === "time") return precision === "time";
  if (nativeType === "datetime-local" || mode === "datetime") return precision === "datetime";
  if (nativeType === "date") return ["day", "datetime"].includes(precision);
  if (nativeType === "month" || mode === "month") return ["month", "day", "datetime"].includes(precision);
  if (mode === "year") return ["year", "month", "day", "datetime"].includes(precision);
  // 自定义日期框未暴露 picker mode 时，允许执行适配器根据值和面板结构继续判定。
  return ["month", "day", "datetime"].includes(precision);
}

function fieldEvidence(field) {
  const provided = Array.isArray(field?.evidence) ? field.evidence : [];
  const list = provided.length
    ? provided
    : [{ source: field?.labelSource || "label", text: field?.label ?? field?.rawLabel ?? "", weight: undefined }];
  const context = field?.context || {};
  const attributes = field?.attributes || {};
  const extras = [
    { source: "section", text: context.section },
    { source: "group", text: context.group },
    { source: "name", text: attributes.name },
    { source: "id", text: attributes.id },
    { source: "autocomplete", text: attributes.autocomplete },
    { source: "inputmode", text: attributes.inputmode },
    { source: "placeholder", text: attributes.placeholder },
    { source: "aria", text: attributes.ariaLabel },
  ];
  const seen = new Set();
  return [...list, ...extras].flatMap(item => {
    const normalized = normalizeLabel(item?.text);
    if (!normalized) return [];
    const id = `${item.source || "none"}:${normalized}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{
      source: item.source || "none",
      text: String(item.text || ""),
      normalized,
      weight: Number.isFinite(item.weight) ? item.weight : (EVIDENCE_SOURCE_WEIGHTS[item.source] || 20),
    }];
  });
}

function fullContext(field, evidence = fieldEvidence(field)) {
  return normalizeLabel([
    field?.label,
    field?.rawLabel,
    field?.context?.section,
    field?.context?.group,
    ...evidence.map(item => item.text),
  ].filter(Boolean).join(" "));
}

function contextBlocked(field, fieldKey, evidence) {
  const deny = FIELD_CONSTRAINTS[fieldKey]?.denyContext || [];
  const context = fullContext(field, evidence);
  return deny.some(token => context.includes(normalizeLabel(token)));
}

function hardTypeCompatible(field, fieldKey) {
  const type = String(field?.type || "text").toLowerCase();
  if (type === "email") return fieldKey === "email";
  if (type === "tel") return fieldKey === "phone";
  if (type === "url") return ["github", "linkedin", "portfolio"].includes(fieldKey);
  if (type === "date" || type === "custom-date") {
    if (field?.dateMeta?.nativeType === "time" || field?.dateMeta?.mode === "time") return false;
    return FIELD_BY_KEY[fieldKey]?.type === "date" || ["graduationYear", "availableTime"].includes(fieldKey);
  }
  return true;
}

function typeCompatibilityScore(field, canonical) {
  if (!hardTypeCompatible(field, canonical.key)) return -1000;
  const type = String(field?.type || "text").toLowerCase();
  if (type === canonical.type) return 28;
  if (type === "custom-select" && canonical.type === "select") return 24;
  if ((type === "select" || type === "radio") && canonical.type === "select") return 20;
  if (type === "textarea" && canonical.type === "textarea") return 24;
  if (type === "text") return 4;
  return 8;
}

function sectionCompatibilityScore(field, canonical) {
  const sectionKey = field?.context?.sectionKey || "";
  if (!sectionKey) return 0;
  const groupBySection = {
    education: "education",
    internship: "internship",
    work: "work",
    project: "project",
  };
  const expectedGroup = groupBySection[sectionKey];
  if (expectedGroup) {
    if (canonical.group === expectedGroup) return 36;
    if (["education", "internship", "work", "project"].includes(canonical.group)) return -36;
    return 0;
  }
  const keysBySection = {
    award: new Set(["awardDate", "awardName", "awards"]),
    language: new Set(["languageType", "languageScore", "languageProficiency", "languages"]),
    game: new Set(["gameName", "gameLevel", "gameDuration"]),
  };
  const expectedKeys = keysBySection[sectionKey];
  if (!expectedKeys) return 0;
  return expectedKeys.has(canonical.key) ? 36 : -12;
}

function scoreCanonical(field, canonical, evidence) {
  if (contextBlocked(field, canonical.key, evidence)) return null;
  const typeScore = typeCompatibilityScore(field, canonical);
  if (typeScore < 0) return null;
  let strongest = null;
  let agreements = 0;
  for (const item of evidence) {
    const denyIdentifier = FIELD_CONSTRAINTS[canonical.key]?.denyIdentifier || [];
    const identifier = normalizeLabel(item.text);
    if (["id", "name"].includes(item.source) && denyIdentifier.some(token => identifier.includes(normalizeLabel(token)))) {
      continue;
    }
    const hit = bestKeywordHit(item.normalized, NORMALIZED_KEYWORDS.get(canonical.key) || []);
    if (!hit.length) continue;
    agreements += 1;
    const exact = item.normalized === hit.keyword;
    const score = item.weight + Math.min(hit.length, 16) * 3 + (exact ? 24 : 0);
    if (!strongest || score > strongest.score) strongest = { ...hit, score, source: item.source, exact };
  }
  if (!strongest) return null;
  return {
    key: canonical.key,
    keyword: strongest.keyword,
    hitLength: strongest.length,
    score: strongest.score + typeScore + sectionCompatibilityScore(field, canonical) + Math.min(Math.max(agreements - 1, 0), 3) * 8,
    agreements,
    source: strongest.source,
  };
}

function confidenceForScore(score, margin) {
  if (score >= 115 && margin >= 18) return "high";
  if (score >= 100 && margin >= 10) return "medium";
  return "low";
}

// 区号下拉：过滤占位项（请选择/-- 等）后，选项全部为 +数字（国家码）格式。
function looksLikeCountryCodeSelect(field) {
  const options = (Array.isArray(field.options) ? field.options : [])
    .filter(option => String(option || "").trim() && !/^(请选择|请选择区号|选择|--|暂无)$/.test(String(option).trim()));
  return options.length >= 2 && options.every(option => COUNTRY_CODE_OPTION.test(String(option).trim()));
}

function looksLikeCountryCodeField(field) {
  const label = normalizeLabel(field?.label ?? field?.rawLabel ?? "");
  return field?.adapter === "phone-country-code"
    || field?.slot === "prefix" && /(手机|电话|phone|mobile|tel)/.test(label)
    || /(手机区号|电话区号|国家区号|国际区号|countrycode|callingcode)/.test(label)
    || looksLikeCountryCodeSelect(field);
}

function looksLikeImCompound(field) {
  if (!["compound-prefix", "compound-value"].includes(field?.adapter)) return false;
  const context = normalizeLabel(`${field?.label || ""} ${field?.rawLabel || ""} ${field?.context?.group || ""}`);
  return /im|微信|qq|即时通讯/.test(context);
}

// 从简历手机号推导国家区号：带 + 前缀取前缀；大陆 1[3-9] 开头推导 +86。
export function deriveCountryCode(phone) {
  const value = String(phone || "").replace(/\s+/g, "");
  const withPrefix = value.match(/^\+(\d{1,3})/);
  if (withPrefix) return `+${withPrefix[1]}`;
  const digits = value.replace(/\D/g, "");
  if (/^1[3-9]\d{9}$/.test(digits)) return "+86";
  return "";
}

// 格式兼容校验：字段语义和控件强类型同时生效，所有匹配来源共用。
export function valueCompatible(field, fieldKey, value) {
  const type = String(field?.type || "text").toLowerCase();
  const text = String(value || "").trim();
  if (!text || !hardTypeCompatible(field, fieldKey)) return false;
  if (type === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) return false;
  if (type === "tel" && text.replace(/\D/g, "").length < 7) return false;
  if ((type === "date" || type === "custom-date") && !dateValueCompatible(field, text)) return false;
  if (type === "number" && !/^-?\d+(?:\.\d+)?$/.test(text.replace(/[,，]/g, ""))) return false;
  const format = FIELD_CONSTRAINTS[fieldKey]?.format;
  if (format === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(text)) return false;
  if (format === "phone" && looksLikeCountryCodeField(field)) return COUNTRY_CODE_OPTION.test(text);
  if (format === "phone" && !/^\+?\d[\d\- ()]{5,}$/.test(text)) return false;
  if (format === "name" && (/^\d+$/.test(text) || /@/.test(text) || text.length > 60)) return false;
  if (format === "date" && !datePrecision(text)) return false;
  if (format === "idCard" && !/^\d{17}[\dXx]$/.test(text)) return false;
  if (format === "postcode" && !/^\d{5,10}$/.test(text)) return false;
  if (format === "url" && !/^https?:\/\//i.test(text)) return false;
  return true;
}

function optionCompatible(field, value) {
  const type = String(field?.type || "");
  if (!["select", "radio", "custom-select"].includes(type)) return true;
  if (field?.optionsComplete === false) return true;
  if (!Array.isArray(field.options) || !field.options.length) return true;
  const expected = normalizeCompare(value);
  return field.options.some(option => {
    const text = normalizeCompare(option);
    return text && (text === expected || text.includes(expected) || expected.includes(text));
  });
}

function baseResult(field, source = "rule") {
  return {
    fieldId: field?.id ?? field?.fieldId ?? "",
    fieldKey: "",
    value: "",
    confidence: null,
    source,
    status: "manual",
    reason: "",
    label: field?.label ?? field?.rawLabel ?? "",
    rawLabel: field?.rawLabel ?? field?.label ?? "",
    type: field?.type ?? "text",
    path: field?.path || "",
    required: !!field?.required,
    options: Array.isArray(field?.options) ? field.options : [],
    optionsComplete: field?.optionsComplete !== false,
    skipped: !!field?.skipped,
    fingerprint: field?.fingerprint || "",
    evidence: Array.isArray(field?.evidence) ? field.evidence : [],
    context: field?.context || {},
    attributes: field?.attributes || {},
    adapter: field?.adapter || "",
    slot: field?.slot || "single",
    dateMeta: field?.dateMeta || null,
    locators: Array.isArray(field?.locators) ? field.locators : [],
  };
}

function contextualValueRef(field, fieldKey) {
  const repeat = field?.context?.repeat;
  if (!repeat || !Number.isInteger(repeat.itemIndex) || repeat.itemIndex < 0) {
    return { source: "resume", path: fieldKey };
  }
  const fieldMaps = {
    education: {
      school: "school",
      schoolLocation: "schoolLocation",
      college: "college",
      degree: "degree",
      major: "major",
      educationStart: "start",
      graduationYear: "end",
      studyMode: "studyMode",
    },
    internships: {
      internshipCompany: "company",
      internshipIndustry: "industry",
      internshipLocation: "location",
      internshipTitle: "title",
      internshipStart: "start",
      internshipEnd: "end",
      internshipPeriod: "period",
      internshipDescription: "description",
    },
    projects: {
      projectName: "name",
      projectCompany: "company",
      projectRole: "role",
      projectStart: "start",
      projectEnd: "end",
      projectPeriod: "period",
      projectDescription: "description",
      projectResponsibility: "responsibility",
    },
    workHistory: {
      currentCompany: "company",
      workIndustry: "industry",
      workLocation: "location",
      currentTitle: "title",
      workStart: "start",
      workEnd: "end",
      workDescription: "description",
    },
    gameExperiences: {
      gameName: "name",
      gameLevel: "level",
      gameDuration: "duration",
    },
    awardEntries: {
      awardDate: "date",
      awardName: "name",
      awards: "description",
    },
    languageEntries: {
      languageType: "type",
      languageScore: "score",
      languageProficiency: "proficiency",
      languages: "description",
    },
  };
  const entryKey = fieldMaps[repeat.arrayKey]?.[fieldKey];
  return entryKey
    ? { source: "resume", path: `${repeat.arrayKey}[${repeat.itemIndex}].${entryKey}` }
    : { source: "resume", path: fieldKey };
}

// 所有规则、模板、AI 与人工 fieldKey 选择都必须通过此唯一出口。
export function validateBinding(field, fieldKey, resumeFields, options = {}) {
  const base = baseResult(field, options.source || "rule");
  const key = String(fieldKey || "").trim();
  const confidence = options.confidence || null;
  if (base.skipped) return { ...base, confidence, reason: "该控件不支持自动填充（密码/文件/隐藏）" };
  if (!FIELD_BY_KEY[key]) return { ...base, confidence, reason: "未返回有效字段 key" };
  if (SENSITIVE_FIELD_KEYS.has(key) && !options.userConfirmed) {
    return { ...base, fieldKey: key, confidence: null, reason: "敏感字段，需人工确认" };
  }
  const evidence = fieldEvidence(field);
  if (contextBlocked(field, key, evidence)) {
    return { ...base, fieldKey: key, confidence, reason: "字段上下文与候选人本人信息冲突，需人工确认" };
  }
  if (!hardTypeCompatible(field, key)) {
    return { ...base, fieldKey: key, confidence, reason: "控件类型与字段语义不匹配，需人工确认" };
  }
  let value = "";
  const hasValueOverride = options.userConfirmed && Object.prototype.hasOwnProperty.call(options, "valueOverride");
  const requestedValueRef = options.valueRef?.source === "resume"
    ? options.valueRef
    : contextualValueRef(field, key);
  if (hasValueOverride) value = String(options.valueOverride ?? "").trim();
  else if (looksLikeCountryCodeField(field) && key === "phone") value = deriveCountryCode(resumeFields?.phone);
  else if (key === "imType") value = String(resumeFields?.imType || (resumeFields?.wechat ? "微信" : resumeFields?.qq ? "QQ" : "")).trim();
  else value = resolveResumeValueRef(resumeFields, requestedValueRef);
  if (["date", "custom-date"].includes(base.type) || FIELD_CONSTRAINTS[key]?.format === "date") {
    value = normalizeDateValue(value);
  }
  if (!value) {
    return { ...base, fieldKey: key, confidence, reason: `简历中缺少「${RESUME_FIELD_LABELS[key]}」信息` };
  }
  if (base.type === "checkbox" && !BOOLEAN_VALUE.test(value)) {
    return { ...base, fieldKey: key, value, confidence, reason: "勾选框需手动确认（简历值非明确布尔）" };
  }
  if (!optionCompatible(field, value)) {
    return { ...base, fieldKey: key, value, confidence, reason: "简历值与页面选项不匹配，请手动选择" };
  }
  if (!valueCompatible(field, key, value)) {
    return { ...base, fieldKey: key, value, confidence, reason: "控件类型与简历值格式不匹配，请手动核对" };
  }
  if (confidence === "low" && !options.userConfirmed) {
    return { ...base, fieldKey: key, value, confidence, reason: "匹配证据不足，需人工确认" };
  }
  return {
    ...base,
    fieldKey: key,
    value,
    confidence,
    status: "match",
    reason: options.reason || `${options.source === "ai" ? "AI" : options.source === "template" ? "模板" : "规则"}匹配「${RESUME_FIELD_LABELS[key]}」`,
    valueRef: hasValueOverride ? { source: "manual", path: key } : requestedValueRef,
    userConfirmed: !!options.userConfirmed,
  };
}

// 规则层匹配：多证据候选评分 → 候选分差 → 中央校验。
export function matchRules(fields, resumeFields) {
  const resume = resumeFields || {};
  const results = (Array.isArray(fields) ? fields : []).map(field => {
    const base = baseResult(field, "rule");
    if (base.skipped) return { ...base, reason: "该控件不支持自动填充（密码/文件/隐藏）" };

    if (looksLikeImCompound(field)) {
      if (field.adapter === "compound-prefix") {
        const validated = validateBinding(field, "imType", resume, {
          source: "rule",
          confidence: "high",
          reason: "IM 类型（按简历中的微信/QQ字段推导）",
        });
        return validated.status === "match" ? validated : { ...validated, lockedManual: true };
      }
      const key = resume.wechat ? "wechat" : resume.qq ? "qq" : "";
      if (!key) {
        return {
          ...base,
          lockedManual: true,
          reason: "简历中缺少微信或 QQ，无法确定 IM 类型与账号",
        };
      }
      return validateBinding(field, key, resume, {
        source: "rule",
        confidence: "high",
        reason: `IM 账号（使用「${RESUME_FIELD_LABELS[key]}」）`,
      });
    }

    if (looksLikeCountryCodeField(field)) {
      const derived = deriveCountryCode(resume.phone);
      const options = Array.isArray(field.options) ? field.options.filter(Boolean) : [];
      const hit = derived && (field.optionsComplete === false || !options.length || options.some(option => {
        const text = normalizeCompare(option);
        const code = normalizeCompare(derived);
        return text === code || text.includes(code);
      }));
      if (!hit) {
        return {
          ...base,
          fieldKey: "phone",
          value: derived || "",
          confidence: derived ? "medium" : null,
          reason: "无法匹配手机区号，请手动选择",
        };
      }
      return validateBinding(field, "phone", resume, {
        source: "rule",
        confidence: "high",
        reason: "手机区号（按简历手机号自动推导）",
      });
    }

    const evidence = fieldEvidence(field);
    if (!evidence.length) return { ...base, reason: "未识别到字段标签" };
    const candidates = CANONICAL_FIELDS
      .map(canonical => scoreCanonical(field, canonical, evidence))
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
    if (!candidates.length) {
      const context = fullContext(field, evidence);
      const risky = /(紧急联系人|联系人姓名|联系人电话|监护人|父亲|母亲|家长|证明人|emergencycontact|guardian|parentname|parentphone|parentemail|contactperson|contactphone|contactemail)/.test(context);
      const hasKeyword = CANONICAL_FIELDS.some(canonical =>
        evidence.some(item => bestKeywordHit(item.normalized, NORMALIZED_KEYWORDS.get(canonical.key) || []).length)
      );
      return {
        ...base,
        reason: risky
          ? "字段上下文指向第三方联系人，需人工确认"
          : hasKeyword ? "控件类型与字段语义不匹配，需人工确认" : "未识别字段含义",
      };
    }
    const best = candidates[0];
    const margin = best.score - (candidates[1]?.score || 0);
    const confidence = confidenceForScore(best.score, margin);
    const validated = validateBinding(field, best.key, resume, {
      source: "rule",
      confidence,
      reason: `规则命中「${RESUME_FIELD_LABELS[best.key]}」（${best.source}，分差 ${margin}）`,
    });
    return { ...validated, candidateScore: best.score, candidateMargin: margin };
  });
  const dateRanges = new Map();
  for (const result of results) {
    if (result.adapter !== "date-range" || !["start", "end"].includes(result.slot)) continue;
    const repeat = result.context?.repeat;
    const groupKey = repeat
      ? `${repeat.arrayKey}:${repeat.itemIndex}`
      : `${result.context?.formKey || ""}:${result.context?.group || result.label || "date-range"}`;
    if (!dateRanges.has(groupKey)) dateRanges.set(groupKey, []);
    dateRanges.get(groupKey).push(result);
  }
  for (const range of dateRanges.values()) {
    const start = range.find(result => result.slot === "start");
    const end = range.find(result => result.slot === "end");
    if (!start || !end || (start.status === "match" && end.status === "match")) continue;
    for (const result of range) {
      result.status = "manual";
      result.confidence = result.confidence === "high" ? "medium" : result.confidence;
      result.lockedManual = true;
      result.reason = "日期范围需同时具备开始和结束时间，请补齐后再填充";
    }
  }
  const repeatedGroups = {
    education: new Set(["school", "degree", "major", "graduationYear"]),
    workHistory: new Set(["currentCompany", "workIndustry", "workLocation", "currentTitle", "workStart", "workEnd", "workDescription"]),
    internships: new Set(["internshipCompany", "internshipIndustry", "internshipLocation", "internshipTitle", "internshipStart", "internshipEnd", "internshipPeriod", "internshipDescription"]),
    projects: new Set(["projectName", "projectCompany", "projectRole", "projectStart", "projectEnd", "projectPeriod", "projectDescription", "projectResponsibility"]),
    awardEntries: new Set(["awardDate", "awardName", "awards"]),
    languageEntries: new Set(["languageType", "languageScore", "languageProficiency", "languages"]),
  };
  for (const [arrayKey, fieldKeys] of Object.entries(repeatedGroups)) {
    if (!Array.isArray(resume[arrayKey]) || !resume[arrayKey].length) continue;
    for (const fieldKey of fieldKeys) {
      const repeated = results.filter(result => result.fieldKey === fieldKey && result.status === "match");
      if (repeated.length <= 1) continue;
      const valuePaths = repeated.map(result => result.valueRef?.source === "resume" ? result.valueRef.path : "");
      if (valuePaths.every(Boolean) && new Set(valuePaths).size === repeated.length) continue;
      for (const result of repeated) {
        result.status = "manual";
        result.confidence = "low";
        result.lockedManual = true;
        result.reason = `页面存在多个「${RESUME_FIELD_LABELS[fieldKey]}」字段，请选择对应经历条目`;
      }
    }
  }
  // 敏感字段兜底：即使规则层后续新增绕过 validateBinding 的路径，也强制 manual。
  for (const result of results) {
    if (result.status === "match" && SENSITIVE_FIELD_KEYS.has(result.fieldKey)) {
      result.status = "manual";
      result.value = "";
      result.confidence = null;
      result.lockedManual = true;
      result.userConfirmed = false;
      result.reason = "敏感字段，需人工确认";
    }
  }
  return results;
}

// AI 只提供 fieldKey；最终值从当前 profile 解析，并再次走中央校验。
export function applyAiResults(matches, aiResults, fields, resumeFields) {
  const byField = new Map();
  for (const entry of Array.isArray(aiResults) ? aiResults : []) {
    if (!byField.has(String(entry?.fieldId ?? ""))) byField.set(String(entry?.fieldId ?? ""), entry);
  }
  const fieldMap = new Map((Array.isArray(fields) ? fields : []).map(field => [field.id, field]));
  return (matches || []).map(match => {
    const entry = byField.get(match.fieldId);
    if (!entry) return match;
    if (!(match.status === "manual" || match.confidence === "low")) return match;
    if (match.lockedManual) return match;
    const field = fieldMap.get(match.fieldId) || match;
    const key = String(entry.fieldKey || "").trim();
    const confidence = ["high", "medium", "low"].includes(entry.confidence) ? entry.confidence : "medium";
    const canonical = FIELD_BY_KEY[key];
    const localEvidence = canonical ? scoreCanonical(field, canonical, fieldEvidence(field)) : null;
    const strongTypeEvidence = ["tel", "email", "date", "custom-date", "url"].includes(String(field.type || ""));
    const validated = validateBinding(field, key, resumeFields || {}, {
      source: "ai",
      confidence,
      reason: "AI 语义匹配（已通过本地校验）",
    });
    if (validated.status === "match" && !localEvidence && !strongTypeEvidence) {
      return {
        ...match,
        fieldKey: key,
        value: validated.value,
        valueRef: validated.valueRef,
        confidence,
        source: "ai",
        status: "manual",
        reason: "AI 给出语义建议，但缺少本地证据，请人工确认",
      };
    }
    return validated.status === "match" ? { ...match, ...validated } : { ...match, reason: validated.reason };
  });
}

// AI 只判断字段语义，不接收简历具体值，也不返回 value。
export function buildAiMatchPrompt(needsMatch, _resumeFields) {
  const fields = needsMatch.map(match => ({
    fieldId: match.fieldId,
    label: match.label ?? match.rawLabel ?? "",
    type: match.type ?? "text",
    evidence: match.evidence || [],
    context: match.context || {},
    options: match.options || [],
  }));
  const allowedKeys = CANONICAL_FIELDS.map(field => field.key).join("、");
  const content = `你是网申表单字段语义分类助手。只判断页面字段对应哪个规范字段，不生成或推测候选人数据。
可用字段 key（必须从中选择；无法确定时 fieldKey 为空字符串）：${allowedKeys}
字段 key 对照：${CANONICAL_FIELDS.map(field => `${field.key}=${field.label}`).join("；")}
页面字段证据：${JSON.stringify(fields)}
只输出 JSON 数组，形如 [{"fieldId":"...","fieldKey":"...","confidence":"high|medium|low","reason":"..."}]。
遇到紧急联系人、监护人、父母、证明人等第三方信息时返回空 fieldKey。`;
  return [{ role: "user", content }];
}

// 完整匹配：规则层 → 可选 AI 语义兜底 → 同一中央校验。
export async function matchFields(fields, resumeFields, options = {}) {
  let matches = matchRules(fields, resumeFields);
  if (options?.aiMatch && typeof options?.aiCall === "function") {
    const needs = matches.filter(match => match.status === "manual" || match.confidence === "low");
    if (needs.length) {
      try {
        const messages = buildAiMatchPrompt(needs, resumeFields);
        const aiResults = await options.aiCall(messages);
        matches = applyAiResults(matches, aiResults, fields, resumeFields);
      } catch (_error) {
        // AI 失败不阻塞填充：未识别字段保持 manual，交给用户手动处理。
      }
    }
  }
  return matches;
}
