// 智能填充：简历结构化字段提取（本地正则 + AI 提取 prompt 与合并）。
import { CANONICAL_FIELDS } from "./form-fields.js";

// 空字段模板：所有规范字段均为空字符串。
export const EMPTY_RESUME_FIELDS = Object.fromEntries(CANONICAL_FIELDS.map(f => [f.key, ""]));

// UI 渲染用：字段 key/label/类型。
export const RESUME_FIELDS_SCHEMA = CANONICAL_FIELDS.map(f => ({ key: f.key, label: f.label, type: f.type }));

// 复杂字段：本地正则难以可靠提取，AI 结果优先。
const COMPLEX_KEYS = new Set(["selfEvaluation", "skills", "languages", "hobbies", "availableTime", "portfolio", "education", "workHistory"]);

const firstMatch = (text, pattern) => {
  const match = String(text || "").match(pattern);
  return match ? match[1].trim() : "";
};

// 从简历文本中提取结构化字段（本地正则，同步纯函数）。
export function extractResumeFieldsLocal(text) {
  const source = String(text || "");
  const fields = { ...EMPTY_RESUME_FIELDS };
  fields.phone = firstMatch(source, /(1[3-9]\d{9})/);
  fields.email = firstMatch(source, /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);

  const lines = source.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const firstLine = lines[0] || "";
  if (/^[^\s|:：,，]{1,20}$/.test(firstLine) && !/\d{5,}/.test(firstLine)) fields.name = firstLine;

  const gender = source.match(/(^|[^\u4e00-\u9fa5])([男女])([^\u4e00-\u9fa5]|$)/);
  if (gender) fields.gender = gender[2];
  if (/(?:性别|gender)\s*[:：]\s*(男|女)/i.test(source)) fields.gender = RegExp.$1;

  const birth = source.match(/(\d{4})[-/年.](\d{1,2})月?/);
  if (birth) fields.birthDate = `${birth[1]}-${String(birth[2]).padStart(2, "0")}`;

  fields.currentCity = firstMatch(source, /(?:现居城市|现居住地|所在城市|常住城市|城市)\s*[:：]?\s*([\u4e00-\u9fa5·]{2,6})/);
  if (!fields.currentCity) {
    const meta = lines.find(line => /[男|女]/.test(line) && line.includes("|")) || "";
    const segments = meta.split(/[|｜]/).map(s => s.trim()).filter(Boolean);
    const last = segments[segments.length - 1] || "";
    if (/^[\u4e00-\u9fa5·]{2,6}$/.test(last) && !/\d/.test(last)) fields.currentCity = last;
  }

  fields.idCard = firstMatch(source, /(\d{17}[\dXx])/);
  fields.hometown = firstMatch(source, /(?:籍贯|生源地|户口所在地)\s*[:：]?\s*([\u4e00-\u9fa5·]{2,8})/);
  fields.address = firstMatch(source, /(?:通讯地址|联系地址|家庭住址|详细地址)\s*[:：]?\s*([^\n]{4,60})/);
  fields.postcode = firstMatch(source, /(?:邮编|邮政编码)\s*[:：]?\s*(\d{6})/);

  // 教育经历段落解析：时间区间 + 学校 + 专业 + 学历。
  const eduSection = source.match(/教育经历[\s\S]*?(?=工作经历|项目经历|自我评价|$)/);
  const eduText = eduSection ? eduSection[0] : source;
  if (!fields.school) fields.school = firstMatch(eduText, /(?:毕业院校|学校|院校|就读学校)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z（）()·]{2,30})/);
  const eduLine = eduText.match(/(\d{4})[-/年.]\d{1,2}月?\s*[至\-—到]?\s*(\d{4}|至今)[\d\-/\s年]*([\u4e00-\u9fa5A-Za-z（）()·]+)[\s]+([\u4e00-\u9fa5A-Za-z·、]+)[\s]+([\u4e00-\u9fa5A-Za-z·、]+)/);
  if (eduLine) {
    if (!fields.school) fields.school = eduLine[3];
    if (!fields.major) fields.major = eduLine[4];
    if (!fields.degree) fields.degree = eduLine[5];
    if (!fields.graduationYear) fields.graduationYear = eduLine[2] === "至今" ? "" : eduLine[2];
  }
  if (!fields.major) fields.major = firstMatch(eduText, /(?:专业|所学专业|主修专业)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z·、]{2,30})/);
  if (!fields.degree) fields.degree = firstMatch(eduText, /(博士|硕士|本科|大专|专科|高中)/);
  if (!fields.graduationYear) fields.graduationYear = firstMatch(eduText, /(?:毕业时间|毕业年份)\s*[:：]?\s*(\d{4})/);

  // 工作经历段落解析：公司 + 职位。
  const workSection = source.match(/工作经历[\s\S]*?(?=项目经历|教育经历|自我评价|$)/);
  const workText = workSection ? workSection[0] : source;
  const workLine = workText.match(/(\d{4})[-/年.]\d{1,2}月?\s*[至\-—到]?\s*(\d{4}|至今)[\d\-/\s年]*([\u4e00-\u9fa5A-Za-z（）()·]+)[\s]+([^\n]{2,30})/);
  if (workLine) {
    if (!fields.currentCompany) fields.currentCompany = workLine[3];
    if (!fields.currentTitle) fields.currentTitle = workLine[4].trim();
  }
  if (!fields.currentCompany) fields.currentCompany = firstMatch(source, /(?:当前公司|现公司|目前公司)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z（）()·]{2,30})/);
  if (!fields.currentTitle) fields.currentTitle = firstMatch(source, /(?:当前职位|现职位|目前职位)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z（）()·]{2,30})/);
  const workYearsMatch = source.match(/(\d+(?:\.\d+)?)\s*年/);
  if (workYearsMatch) fields.workYears = `${workYearsMatch[1]}年`;
  if (!fields.workYears) fields.workYears = firstMatch(source, /(?:工作年限|工作经验)\s*[:：]?\s*([\d一二三四五六七八九十]+年)/);

  const stop = /(?=\n\s*\n|专业技能|自我评价|教育经历|工作经历|项目经历|$)/;
  fields.selfEvaluation = firstMatch(source, /(?:自我评价|自我介绍|个人评价|个人简介)\s*[:：]?\s*([\s\S]+?)(?=\n\s*\n|专业技能|教育经历|工作经历|项目经历|$)/);
  fields.skills = firstMatch(source, /(?:专业技能|技能特长|个人技能)\s*[:：]?\s*([\s\S]+?)(?=\n\s*\n|自我评价|教育经历|工作经历|项目经历|$)/);
  fields.languages = firstMatch(source, /(?:语言能力|外语水平|英语水平)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z·、（）()0-9]{2,40})/);
  fields.hobbies = firstMatch(source, /(?:兴趣爱好|爱好|兴趣)\s*[:：]?\s*([^\n]{2,40})/);
  fields.availableTime = firstMatch(source, /(?:到岗时间|入职时间|最快到岗|可到岗)\s*[:：]?\s*([^\n]{2,20})/);
  fields.expectedSalary = firstMatch(source, /(?:期望薪资|期望薪酬|薪资要求)\s*[:：]?\s*([^\n]{2,20})/);
  fields.expectedCity = firstMatch(source, /(?:期望城市|意向城市)\s*[:：]?\s*([\u4e00-\u9fa5·]{2,6})/);
  fields.expectedPosition = firstMatch(source, /(?:期望职位|期望岗位|求职意向)\s*[:：]?\s*([^\n]{2,20})/);
  fields.github = firstMatch(source, /(?:github|github 地址|github账号)[\s:：]*([^\s\n]+)/i);
  fields.linkedin = firstMatch(source, /(?:linkedin|领英)[\s:：]*([^\s\n]+)/i);
  fields.politicalStatus = firstMatch(source, /(?:政治面貌)\s*[:：]?\s*([\u4e00-\u9fa5]{2,8})/);
  fields.maritalStatus = firstMatch(source, /(?:婚姻状况)\s*[:：]?\s*([\u4e00-\u9fa5]{2,4})/);
  fields.referral = firstMatch(source, /(?:推荐人|内推人)\s*[:：]?\s*([\u4e00-\u9fa5]{2,8})/);
  return fields;
}

// AI 提取 prompt：要求输出与 schema 一致的 JSON 对象。
export function buildResumeExtractPrompt() {
  const keyList = RESUME_FIELDS_SCHEMA.map(f => `${f.key}=${f.label}`).join("；");
  const content = `你是简历结构化提取助手。请从简历原文中提取字段，只提取原文明确出现的内容，不推测、不编造。
目标字段（key=中文名）：${keyList}
输出 JSON 对象，缺失的字段值为空字符串，例如 {"name":"张三","phone":"","email":""}。
只输出 JSON，不要输出其他说明。`;
  return [{ role: "user", content }];
}

// 合并本地与 AI 提取结果：复杂字段以 AI 为准，常见字段以本地为准，空值互相补齐。
export function mergeResumeFields(local, ai) {
  const base = { ...EMPTY_RESUME_FIELDS, ...(local || {}) };
  const aiFields = ai && typeof ai === "object" ? ai : {};
  const merged = {};
  for (const key of Object.keys(base)) {
    const localValue = String(base[key] ?? "").trim();
    const aiValue = String(aiFields[key] ?? "").trim();
    if (COMPLEX_KEYS.has(key)) merged[key] = aiValue || localValue;
    else merged[key] = localValue || aiValue;
  }
  return merged;
}
