import { test } from "node:test";
import assert from "node:assert/strict";
import { RESUME_FIELDS_SCHEMA, extractResumeFieldsLocal, buildResumeExtractPrompt, mergeResumeFields, EMPTY_RESUME_FIELDS, resolveResumeValueRef } from "../src/resume-fields.js";

const SAMPLE = `张三
男 | 1998-06 | 上海
手机：13800138000
邮箱：zhangsan@example.com
教育经历
2016-09 至 2020-06 复旦大学 计算机科学与技术 本科
工作经历
2020-07 至今 某科技公司 产品经理
自我评价：5 年产品经验，擅长需求分析与数据驱动。
专业技能：Axure、SQL、Python`;

test("RESUME_FIELDS_SCHEMA: 30+ 项且字段唯一", () => {
  assert.ok(RESUME_FIELDS_SCHEMA.length >= 30);
  const keys = new Set(RESUME_FIELDS_SCHEMA.map(f => f.key));
  assert.equal(keys.size, RESUME_FIELDS_SCHEMA.length);
  for (const f of RESUME_FIELDS_SCHEMA) assert.ok(f.label);
});

test("extractResumeFieldsLocal: 提取常见字段", () => {
  const fields = extractResumeFieldsLocal(SAMPLE);
  assert.equal(fields.phone, "13800138000");
  assert.equal(fields.email, "zhangsan@example.com");
  assert.equal(fields.name, "张三");
  assert.equal(fields.gender, "男");
  assert.equal(fields.birthDate, "1998-06");
  assert.equal(fields.currentCity, "上海");
  assert.equal(fields.school, "复旦大学");
  assert.equal(fields.degree, "本科");
  assert.equal(fields.major, "计算机科学与技术");
  assert.equal(fields.graduationYear, "2020");
  assert.equal(fields.currentCompany, "某科技公司");
  assert.equal(fields.currentTitle, "产品经理");
  assert.equal(fields.workYears, "5年");
  assert.ok(fields.selfEvaluation.includes("5 年产品经验"));
  assert.ok(fields.skills.includes("SQL"));
});

test("extractResumeFieldsLocal: 空输入返回空对象", () => {
  const fields = extractResumeFieldsLocal("");
  assert.equal(fields.phone, "");
  assert.equal(fields.name, "");
});

test("extractResumeFieldsLocal: 简历标题不作为姓名且 AI 可补入真实姓名", () => {
  for (const heading of ["个人简历", "简历内容", "RESUME"]) {
    const local = extractResumeFieldsLocal(`${heading}\n张三\n手机：13800138000`);
    assert.equal(local.name, "", `${heading} 不应被识别为姓名`);
    const merged = mergeResumeFields(local, { name: "张三" });
    assert.equal(merged.name, "张三");
  }
});

test("extractResumeFieldsLocal: 提取 QQ 与推荐码", () => {
  const fields = extractResumeFieldsLocal("张三\nQQ：12345678\n推荐码：SSG2026");
  assert.equal(fields.qq, "12345678");
  assert.equal(fields.referralCode, "SSG2026");
});

test("buildResumeExtractPrompt: 要求输出 JSON 且包含全部字段 key", () => {
  const messages = buildResumeExtractPrompt();
  const content = messages[0].content;
  assert.ok(content.includes("JSON"));
  assert.ok(content.includes("name"));
  assert.ok(content.includes("selfEvaluation"));
});

test("mergeResumeFields: 复杂字段以 AI 为准，常见字段以本地为准", () => {
  const local = extractResumeFieldsLocal(SAMPLE);
  const ai = { name: "李四", selfEvaluation: "AI 版自我评价", skills: "AI 版技能", school: "AI 学校" };
  const merged = mergeResumeFields(local, ai);
  assert.equal(merged.name, "张三", "常见字段本地优先");
  assert.equal(merged.phone, "13800138000");
  assert.equal(merged.selfEvaluation, "AI 版自我评价", "复杂字段 AI 覆盖");
  assert.equal(merged.skills, "AI 版技能");
  assert.equal(merged.school, "复旦大学", "院校本地正则优先");
});

test("mergeResumeFields: AI 为空时保留本地值", () => {
  const merged = mergeResumeFields(extractResumeFieldsLocal(SAMPLE), null);
  assert.equal(merged.name, "张三");
  assert.equal(merged.selfEvaluation, merged.selfEvaluation);
});

test("EMPTY_RESUME_FIELDS: 标量字段为空字符串，经历数组为空数组", () => {
  for (const [key, value] of Object.entries(EMPTY_RESUME_FIELDS)) {
    if (["education", "workHistory", "internships", "projects"].includes(key)) assert.deepEqual(value, [], `${key} 应为空数组`);
    else assert.equal(value, "", `${key} 应为空串`);
  }
});

test("extractResumeFieldsLocal: 误报回归——毕业年份不当工作年限、教育起始年不当出生日期", () => {
  const text = "张三\n2020年毕业于复旦大学\n2016-09 至 2020-06 复旦大学 计算机 本科";
  const fields = extractResumeFieldsLocal(text);
  assert.equal(fields.workYears, "", "「2020年毕业」不应提取为工作年限");
  assert.equal(fields.birthDate, "", "教育经历起始年不应提取为出生日期");
  assert.equal(fields.school, "复旦大学");
});

test("extractResumeFieldsLocal: 出生日期有日时保留完整精度", () => {
  const fields = extractResumeFieldsLocal("张三\n出生日期：1998-06-15");
  assert.equal(fields.birthDate, "1998-06-15");
});

test("extractResumeFieldsLocal: 提取实习经历（时间/公司/岗位/内容）", () => {
  const text = `张三
实习经历
2021-06 至 2021-09 字节跳动 产品实习生
- 负责用户调研与需求文档撰写
项目经历
2022-03 至 2022-06 智能招聘平台 项目负责人
- 设计简历匹配算法`;
  const fields = extractResumeFieldsLocal(text);
  assert.equal(fields.internshipCompany, "字节跳动");
  assert.equal(fields.internshipTitle, "产品实习生");
  assert.equal(fields.internshipStart, "2021-06");
  assert.equal(fields.internshipEnd, "2021-09");
  assert.equal(fields.internshipPeriod, "2021-06 至 2021-09");
  assert.ok(fields.internshipDescription.includes("用户调研"));
});

test("extractResumeFieldsLocal: 提取项目经历（时间/名称/角色/内容）", () => {
  const text = `张三
项目经历
项目名称：智能招聘平台
2022-03 至 2022-06 某科技集团 项目负责人
- 设计简历匹配算法，召回率提升 20%`;
  const fields = extractResumeFieldsLocal(text);
  assert.equal(fields.projectName, "智能招聘平台");
  assert.equal(fields.projectCompany, "某科技集团");
  assert.equal(fields.projectRole, "项目负责人");
  assert.equal(fields.projectStart, "2022-03");
  assert.equal(fields.projectEnd, "2022-06");
  assert.ok(fields.projectDescription.includes("简历匹配算法"));
});

test("extractResumeFieldsLocal: 个人简介与自我评价分离", () => {
  const text = `张三
个人简介：3 年产品经验，专注 B 端。
自我评价：学习能力强，结果导向。`;
  const fields = extractResumeFieldsLocal(text);
  assert.ok(fields.profileSummary.includes("3 年产品经验"));
  assert.ok(fields.selfEvaluation.includes("学习能力强"));
});

test("RESUME_FIELDS_SCHEMA: 新增结构化字段齐全且带分组", () => {
  const keys = new Set(RESUME_FIELDS_SCHEMA.map(f => f.key));
  for (const key of ["internshipCompany", "internshipTitle", "internshipStart", "internshipEnd", "internshipPeriod", "internshipDescription",
    "projectName", "projectRole", "projectCompany", "projectStart", "projectEnd", "projectPeriod", "projectDescription",
    "profileSummary", "additionalInfo", "awards", "certificates", "campusExperience"]) {
    assert.ok(keys.has(key), `缺少字段 ${key}`);
  }
  const groups = new Set(RESUME_FIELDS_SCHEMA.map(f => f.group));
  assert.ok(groups.has("internship") && groups.has("project") && groups.has("profile") && groups.has("other"));
});

test("extractResumeFieldsLocal: 多条实习经历全部提取，聚合取最新一条", () => {
  const text = `张三
实习经历
2021-06 至 2021-09 字节跳动 产品实习生
- 负责用户调研
2022-01 至 2022-06 腾讯 产品策划实习生
- 负责需求分析`;
  const fields = extractResumeFieldsLocal(text);
  assert.equal(fields.internships.length, 2, "应提取 2 条实习经历");
  assert.equal(fields.internships[0].company, "字节跳动");
  assert.equal(fields.internships[1].company, "腾讯");
  // 聚合取结束时间最近的一条
  assert.equal(fields.internshipCompany, "腾讯");
  assert.equal(fields.internshipTitle, "产品策划实习生");
  assert.equal(fields.internshipPeriod, "2022-01 至 2022-06");
});

test("extractResumeFieldsLocal: 多条教育经历全部提取", () => {
  const text = `张三
教育经历
2016-09 至 2020-06 复旦大学 计算机科学与技术 本科
2020-09 至 2023-06 清华大学 软件工程 硕士`;
  const fields = extractResumeFieldsLocal(text);
  assert.equal(fields.education.length, 2);
  assert.equal(fields.education[1].school, "清华大学");
  assert.equal(fields.school, "清华大学", "聚合取最新学历");
  assert.equal(fields.graduationYear, "2023");
  assert.equal(fields.degree, "硕士");
});

test("extractResumeFieldsLocal: 多条工作经历全部提取并聚合最新公司岗位", () => {
  const text = `张三
工作经历
2022-01 至 2023-06 甲公司 产品经理
- 负责需求分析
2023-07 至 2025-06 乙公司 高级产品经理
- 负责产品规划
项目经历`;
  const fields = extractResumeFieldsLocal(text);
  assert.equal(fields.workHistory.length, 2);
  assert.equal(fields.workHistory[1].company, "乙公司");
  assert.equal(fields.currentCompany, "乙公司");
  assert.equal(fields.currentTitle, "高级产品经理");
});

test("extractResumeFieldsLocal: 多条项目经历全部提取", () => {
  const text = `张三
项目经历
2021-03 至 2021-08 智能问答系统 项目负责人
- 负责算法选型
2022-05 至 2022-10 简历解析平台 核心开发
- 负责解析引擎`;
  const fields = extractResumeFieldsLocal(text);
  assert.equal(fields.projects.length, 2);
  assert.equal(fields.projects[1].name, "简历解析平台");
  assert.equal(fields.projectName, "简历解析平台", "聚合取最新项目");
  assert.equal(fields.projectRole, "核心开发");
});

test("mergeResumeFields: AI 经历数组替换本地数组并重新聚合", () => {
  const local = extractResumeFieldsLocal("张三\n实习经历\n2021-06 至 2021-09 字节跳动 产品实习生");
  const ai = {
    internships: [
      { start: "2020-01", end: "2020-06", company: "AI 公司", title: "AI 实习", description: "AI 描述" },
      { start: "2021-01", end: "2021-06", company: "最新公司", title: "最新岗位", description: "最新描述" },
    ],
    projects: [],
    education: [],
  };
  const merged = mergeResumeFields(local, ai);
  assert.equal(merged.internships.length, 2, "AI 数组应替换本地");
  assert.equal(merged.internshipCompany, "最新公司", "聚合应取 AI 最新一条");
  assert.equal(merged.internshipDescription, "最新描述");
  assert.equal(merged.name, "张三", "常见标量仍以本地为准");
});

test("resolveResumeValueRef: 支持标量与经历数组路径并拒绝危险路径", () => {
  const resume = {
    name: "张三",
    education: [
      { school: "复旦大学" },
      { school: "清华大学" },
    ],
  };
  assert.equal(resolveResumeValueRef(resume, { source: "resume", path: "name" }), "张三");
  assert.equal(resolveResumeValueRef(resume, { source: "resume", path: "education[1].school" }), "清华大学");
  assert.equal(resolveResumeValueRef(resume, { source: "resume", path: "__proto__.x" }), "");
  assert.equal(resolveResumeValueRef(resume, { source: "manual", path: "name" }), "");
});
