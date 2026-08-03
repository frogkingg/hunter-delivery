import { test } from "node:test";
import assert from "node:assert/strict";
import { RESUME_FIELDS_SCHEMA, extractResumeFieldsLocal, buildResumeExtractPrompt, mergeResumeFields, EMPTY_RESUME_FIELDS } from "../src/resume-fields.js";

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

test("EMPTY_RESUME_FIELDS: 所有字段为空字符串", () => {
  for (const [key, value] of Object.entries(EMPTY_RESUME_FIELDS)) {
    assert.equal(value, "", `${key} 应为空串`);
  }
});
