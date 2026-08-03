// 智能填充：简历结构化字段提取（本地正则 + AI 提取 prompt 与合并）。
// 教育/实习/项目为多条目数组（可扩展），同时聚合出匹配层使用的标量字段。
import { CANONICAL_FIELDS } from "./form-fields.js";

// 空字段模板：标量字段为空字符串，经历类字段为空数组。
export const EMPTY_RESUME_FIELDS = {
  ...Object.fromEntries(CANONICAL_FIELDS.map(f => [f.key, ""])),
  education: [],
  internships: [],
  projects: [],
};

// UI 渲染用：字段 key/label/类型/分组。
export const RESUME_FIELDS_SCHEMA = CANONICAL_FIELDS.map(f => ({ key: f.key, label: f.label, type: f.type, group: f.group }));

// 经历条目分组配置（教育/实习/项目）：多条目卡片编辑器的字段定义。
export const ENTRY_GROUPS = [
  {
    key: "education", title: "教育经历", resumeKey: "education",
    fields: [
      { key: "school", label: "学校" },
      { key: "degree", label: "学历" },
      { key: "major", label: "专业" },
      { key: "start", label: "开始时间" },
      { key: "end", label: "结束时间" },
    ],
    summary: entry => [entry.start, entry.end, entry.school, entry.degree].filter(Boolean).join(" · "),
    empty: (seq = 0) => ({ id: `edu-${Date.now()}-${seq}`, start: "", end: "", school: "", degree: "", major: "" }),
  },
  {
    key: "internships", title: "实习经历", resumeKey: "internships",
    fields: [
      { key: "company", label: "公司" },
      { key: "title", label: "岗位" },
      { key: "start", label: "开始时间" },
      { key: "end", label: "结束时间" },
      { key: "description", label: "实习内容", textarea: true },
    ],
    summary: entry => [entry.start, entry.end, entry.company, entry.title].filter(Boolean).join(" · "),
    empty: (seq = 0) => ({ id: `int-${Date.now()}-${seq}`, start: "", end: "", company: "", title: "", description: "" }),
  },
  {
    key: "projects", title: "项目经历", resumeKey: "projects",
    fields: [
      { key: "name", label: "项目名称" },
      { key: "company", label: "项目公司" },
      { key: "role", label: "项目角色" },
      { key: "start", label: "开始时间" },
      { key: "end", label: "结束时间" },
      { key: "description", label: "项目内容", textarea: true },
    ],
    summary: entry => [entry.start, entry.end, entry.name, entry.role].filter(Boolean).join(" · "),
    empty: (seq = 0) => ({ id: `prj-${Date.now()}-${seq}`, start: "", end: "", name: "", company: "", role: "", description: "" }),
  },
];

// 复杂字段（AI 优先）：文本类描述字段与补充内容。
const COMPLEX_KEYS = new Set([
  "selfEvaluation", "skills", "languages", "hobbies", "availableTime", "portfolio",
  "internshipDescription", "projectDescription", "profileSummary", "additionalInfo",
  "awards", "certificates", "campusExperience",
]);

const pad2 = value => String(value || "").padStart(2, "0");
const firstMatch = (text, pattern) => {
  const match = String(text || "").match(pattern);
  return match ? match[1].trim() : "";
};
const cleanLine = line => String(line || "").trim().replace(/^[-*•·]\s*/, "");
const isSectionHead = line => /^(教育经历|实习经历|项目经历|工作经历)/.test(line);

// 时间区间行：2021-06 至 2021-09 字节跳动 产品实习生（结束可为 至今 / 纯年份）。
const TIME_RANGE_LINE = /(\d{4})[-/年.](\d{1,2})月?\s*[至\-—到]?\s*(?:(\d{4})[-/年.](\d{1,2})月?|至今)[\d\-/\s年]*([^\n]{2,60})/;

// 把段落按时间区间行切块：每块含头部（时间 + 其余文本）与后续描述行。
function parseSectionBlocks(sectionText) {
  const lines = String(sectionText || "").split(/\r?\n/).map(cleanLine).filter(Boolean);
  const blocks = [];
  let current = null;
  let pending = []; // 首个时间行之前的标签行（如「项目名称：xxx」）并入首块
  for (const line of lines) {
    const head = line.match(TIME_RANGE_LINE);
    if (head) {
      current = {
        start: `${head[1]}-${pad2(head[2])}`,
        end: head[3] ? (head[4] ? `${head[3]}-${pad2(head[4])}` : head[3]) : "",
        rest: head[5].trim(),
        lines: pending,
      };
      pending = [];
      blocks.push(current);
    } else if (current && !isSectionHead(line)) {
      current.lines.push(line.replace(/^[-*•·]?\s*/, ""));
    } else if (!current && !isSectionHead(line)) {
      pending.push(line.replace(/^[-*•·]?\s*/, ""));
    }
  }
  return blocks;
}

function normalizeEntry(entry) {
  const out = {};
  for (const [key, value] of Object.entries(entry || {})) out[key] = String(value ?? "").trim();
  return out;
}

// —— 教育经历条目 ——
export function parseEducationEntries(eduText) {
  const entries = parseSectionBlocks(eduText).map((block, index) => {
    const parts = block.rest.split(/\s+/).filter(Boolean);
    return normalizeEntry({
      id: `edu-${index + 1}`, start: block.start, end: block.end,
      school: parts[0] || "", major: parts[1] || "", degree: parts[2] || "",
    });
  });
  if (!entries.length) {
    const school = firstMatch(eduText, /(?:毕业院校|学校|院校|就读学校)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z（）()·]{2,30})/);
    const major = firstMatch(eduText, /(?:专业|所学专业|主修专业)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z·、]{2,30})/);
    const degree = firstMatch(eduText, /(博士|硕士|本科|大专|专科|高中)/);
    if (school || major || degree) entries.push(normalizeEntry({ id: "edu-1", start: "", end: "", school, major, degree }));
  }
  return entries;
}

// —— 实习经历条目 ——
export function parseInternshipEntries(internText) {
  const entries = parseSectionBlocks(internText).map((block, index) => {
    const parts = block.rest.split(/\s+/).filter(Boolean);
    return normalizeEntry({
      id: `int-${index + 1}`, start: block.start, end: block.end,
      company: parts[0] || "", title: parts.slice(1).join(" ") || "",
      description: block.lines.slice(0, 5).join("；").slice(0, 500),
    });
  });
  if (!entries.length) {
    const company = firstMatch(internText, /(?:实习公司|实习单位|实习企业)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z（）()·]{2,30})/);
    const title = firstMatch(internText, /(?:实习岗位|实习职位)\s*[:：]?\s*([^\n]{2,30})/);
    if (company || title) {
      const descLines = internText.split(/\r?\n/).map(cleanLine).filter(line => line && !/^\d{4}[-/年.]\d{1,2}/.test(line) && !/^(实习公司|实习岗位)\s*[:：]/.test(line));
      entries.push(normalizeEntry({ id: "int-1", start: "", end: "", company, title, description: descLines.slice(0, 3).join("；").slice(0, 300) }));
    }
  }
  return entries;
}

// —— 项目经历条目 ——
export function parseProjectEntries(projectText) {
  const entries = parseSectionBlocks(projectText).map((block, index) => {
    const parts = block.rest.split(/\s+/).filter(Boolean);
    const blockText = block.lines.join("\n");
    const name = firstMatch(`${block.rest}\n${blockText}`, /(?:项目名称|项目名)\s*[:：]?\s*([^\n]{2,40})/) || parts[0] || "";
    const role = firstMatch(blockText, /(?:项目角色|项目职责|担任角色)\s*[:：]?\s*([^\n]{2,30})/) || parts.slice(1).join(" ") || "";
    // 公司：优先标签；否则若首词未用作项目名（如来自「项目名称：」标签），首词视为项目公司。
    const company = firstMatch(blockText, /(?:项目公司|所属公司|项目单位)\s*[:：]?\s*([^\n]{2,40})/) || (name !== parts[0] ? parts[0] : "") || "";
    const description = block.lines.filter(line => !/^项目(名称|角色|时间|公司)\s*[:：]/.test(line)).slice(0, 5).join("；").slice(0, 500);
    return normalizeEntry({ id: `prj-${index + 1}`, start: block.start, end: block.end, name, company, role, description });
  });
  if (!entries.length) {
    const name = firstMatch(projectText, /(?:项目名称|项目名)\s*[:：]?\s*([^\n]{2,40})/);
    const role = firstMatch(projectText, /(?:项目角色|项目职责|担任角色)\s*[:：]?\s*([^\n]{2,30})/);
    const company = firstMatch(projectText, /(?:项目公司|所属公司|项目单位)\s*[:：]?\s*([^\n]{2,40})/);
    if (name || role || company) {
      const descLines = projectText.split(/\r?\n/).map(cleanLine).filter(line => line && !/^\d{4}[-/年.]\d{1,2}/.test(line) && !/^项目(名称|角色|时间|公司)\s*[:：]/.test(line));
      entries.push(normalizeEntry({ id: "prj-1", start: "", end: "", name, company, role, description: descLines.slice(0, 3).join("；").slice(0, 300) }));
    }
  }
  return entries;
}

// 从经历条目聚合匹配层使用的标量字段（取结束时间最近的一条；空列表保留原值以兼容旧数据）。
export function aggregateResumeFields(fields) {
  const out = { ...fields };
  const latest = list => (Array.isArray(list) ? [...list] : []).sort((a, b) => String(b.end || "").localeCompare(String(a.end || "")))[0];
  const edu = latest(out.education);
  if (edu) {
    out.school = edu.school || "";
    out.degree = edu.degree || "";
    out.major = edu.major || "";
    out.graduationYear = edu.end ? edu.end.slice(0, 4) : "";
  }
  const intern = latest(out.internships);
  if (intern) {
    out.internshipCompany = intern.company || "";
    out.internshipTitle = intern.title || "";
    out.internshipStart = intern.start || "";
    out.internshipEnd = intern.end || "";
    out.internshipPeriod = [intern.start, intern.end || "至今"].filter(Boolean).join(" 至 ");
    out.internshipDescription = intern.description || "";
  }
  const project = latest(out.projects);
  if (project) {
    out.projectName = project.name || "";
    out.projectCompany = project.company || "";
    out.projectRole = project.role || "";
    out.projectStart = project.start || "";
    out.projectEnd = project.end || "";
    out.projectPeriod = [project.start, project.end || "至今"].filter(Boolean).join(" 至 ");
    out.projectDescription = project.description || "";
  }
  return out;
}

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

  const birthLabeled = source.match(/(?:出生日期|出生年月|生日)\s*[:：]?\s*(\d{4})[-/年.](\d{1,2})月?/);
  const birthMeta = source.match(/(?:男|女)\s*[|｜]\s*(\d{4})[-/年.](\d{1,2})月?/);
  const birth = birthLabeled || birthMeta;
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

  // 教育经历：多条目解析（时间区间 + 学校 + 专业 + 学历）。
  const eduSection = source.match(/教育经历[\s\S]*?(?=工作经历|实习经历|项目经历|自我评价|个人简介|$)/);
  const eduText = eduSection ? eduSection[0] : source;
  fields.education = parseEducationEntries(eduText);

  // 工作经历概要：公司 + 职位（供「现公司/现职位」标量使用）。
  const workSection = source.match(/工作经历[\s\S]*?(?=实习经历|项目经历|教育经历|自我评价|个人简介|$)/);
  const workText = workSection ? workSection[0] : source;
  const workLine = workText.match(TIME_RANGE_LINE);
  if (workLine) {
    const parts = workLine[5].split(/\s+/).filter(Boolean);
    if (!fields.currentCompany) fields.currentCompany = parts[0] || "";
    if (!fields.currentTitle) fields.currentTitle = parts.slice(1).join(" ") || "";
  }
  if (!fields.currentCompany) fields.currentCompany = firstMatch(source, /(?:当前公司|现公司|目前公司|就职公司)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z（）()·]{2,30})/);
  if (!fields.currentTitle) fields.currentTitle = firstMatch(source, /(?:当前职位|现职位|目前职位|现任岗位)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z（）()·]{2,30})/);
  // 工作年限：只接受 ≤15 年，避免「2020年毕业」等误提为工作年限。
  const workYearsMatch = source.match(/(\d{1,2}(?:\.\d+)?)\s*年/);
  if (workYearsMatch && Number(workYearsMatch[1]) <= 15) fields.workYears = `${workYearsMatch[1]}年`;
  if (!fields.workYears) fields.workYears = firstMatch(source, /(?:工作年限|工作经验)\s*[:：]?\s*([\d一二三四五六七八九十]+年)/);

  // 实习经历 / 项目经历：多条目解析。
  const internSection = source.match(/实习经历[\s\S]*?(?=项目经历|工作经历|教育经历|自我评价|个人简介|获奖情况|证书|补充内容|$)/);
  fields.internships = parseInternshipEntries(internSection ? internSection[0] : "");
  const projectSection = source.match(/项目经历[\s\S]*?(?=实习经历|工作经历|教育经历|自我评价|个人简介|获奖情况|证书|补充内容|$)/);
  fields.projects = parseProjectEntries(projectSection ? projectSection[0] : "");

  fields.awards = firstMatch(source, /(?:获奖情况|获奖经历|所获奖励|荣誉奖项)\s*[:：]?\s*([^\n]{2,80})/);
  fields.certificates = firstMatch(source, /(?:资格证书|证书|职业证书|技能证书)\s*[:：]?\s*([^\n]{2,80})/);
  fields.campusExperience = firstMatch(source, /(?:校园经历|学生工作|社团经历)\s*[:：]?\s*([^\n]{2,80})/);
  fields.additionalInfo = firstMatch(source, /(?:补充内容|补充说明|其他说明|附加信息)\s*[:：]?\s*([^\n]{2,120})/);
  fields.profileSummary = firstMatch(source, /(?:个人简介|个人概述|个人介绍)\s*[:：]?\s*([\s\S]+?)(?=\n\s*\n|自我评价|专业技能|教育经历|工作经历|实习经历|项目经历|获奖情况|证书|补充内容|$)/);
  fields.selfEvaluation = firstMatch(source, /(?:自我评价|自我介绍|个人评价|自我描述)\s*[:：]?\s*([\s\S]+?)(?=\n\s*\n|个人简介|专业技能|教育经历|工作经历|实习经历|项目经历|$)/);
  fields.skills = firstMatch(source, /(?:专业技能|技能特长|个人技能)\s*[:：]?\s*([\s\S]+?)(?=\n\s*\n|自我评价|教育经历|工作经历|实习经历|项目经历|$)/);
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
  return aggregateResumeFields(fields);
}

// AI 提取 prompt：要求输出标量 + 多条目数组的 JSON 对象。
export function buildResumeExtractPrompt() {
  const scalarList = RESUME_FIELDS_SCHEMA
    .filter(f => !["education", "internship", "project"].includes(f.group))
    .map(f => `${f.key}=${f.label}`).join("；");
  const content = `你是简历结构化提取助手。请从简历原文中提取字段，只提取原文明确出现的内容，不推测、不编造。
标量字段（key=中文名，缺失为空字符串）：${scalarList}
数组字段（输出全部条目，按时间从早到晚，无则 []）：
education = [{ "start": "开始时间", "end": "结束时间", "school": "学校", "degree": "学历", "major": "专业" }]
internships = [{ "start": "开始时间", "end": "结束时间", "company": "公司", "title": "岗位", "description": "实习内容" }]
projects = [{ "start": "开始时间", "end": "结束时间", "name": "项目名称", "company": "项目公司", "role": "项目角色", "description": "项目内容" }]
输出 JSON 对象，例如 {"name":"张三","phone":"","education":[],"internships":[],"projects":[]}。
只输出 JSON，不要输出其他说明。`;
  return [{ role: "user", content }];
}

// 合并本地与 AI 提取结果：复杂标量以 AI 为准，常见标量以本地为准，空值互相补齐；
// 经历数组以 AI（非空时）为准；最后重新聚合标量。
export function mergeResumeFields(local, ai) {
  const base = { ...EMPTY_RESUME_FIELDS, ...(local || {}) };
  const aiFields = ai && typeof ai === "object" ? ai : {};
  const merged = {};
  for (const key of Object.keys(base)) {
    if (key === "education" || key === "internships" || key === "projects") continue;
    const localValue = String(base[key] ?? "").trim();
    const aiValue = String(aiFields[key] ?? "").trim();
    if (COMPLEX_KEYS.has(key)) merged[key] = aiValue || localValue;
    else merged[key] = localValue || aiValue;
  }
  const pickEntries = (key, prefix) => {
    const list = Array.isArray(aiFields[key]) && aiFields[key].length ? aiFields[key] : base[key];
    return (Array.isArray(list) ? list : []).map((entry, index) => normalizeEntry({ id: `${prefix}-${index + 1}`, ...entry }));
  };
  merged.education = pickEntries("education", "edu");
  merged.internships = pickEntries("internships", "int");
  merged.projects = pickEntries("projects", "prj");
  return aggregateResumeFields(merged);
}
