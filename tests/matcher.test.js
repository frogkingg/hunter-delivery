import { test } from "node:test";
import assert from "node:assert/strict";
import { MATCHER_DATASET } from "./data/matcher-dataset.js";
import { matchRules, applyAiResults, buildAiMatchPrompt, matchFields } from "../src/matcher.js";
import { RESUME_FIELD_LABELS } from "../src/form-fields.js";

const FULL_RESUME = {
  name: "张三", phone: "13800138000", email: "zhangsan@example.com", gender: "男", birthDate: "1998-06",
  idCard: "110101199806010011", hometown: "北京", currentCity: "上海", address: "上海市浦东新区", postcode: "200120",
  school: "复旦大学", degree: "本科", major: "计算机科学与技术", graduationYear: "2020", workYears: "5年",
  currentCompany: "某科技公司", currentTitle: "产品经理", expectedCity: "上海", expectedSalary: "30-40K",
  expectedPosition: "高级产品经理", selfEvaluation: "5 年产品经验", skills: "Axure, SQL", languages: "英语 CET-6",
  hobbies: "阅读", availableTime: "随时到岗", referral: "王五", github: "https://github.com/zhangsan",
  linkedin: "https://linkedin.com/in/zhangsan", politicalStatus: "群众", maritalStatus: "未婚",
  portfolio: "https://zhangsan.dev",
};

function toFields(labels) {
  return labels.map((label, index) => ({ id: `f${index}`, type: "text", label, rawLabel: label, labelSource: "label", path: `#f${index}`, required: false, options: [], value: "", skipped: false }));
}

test("数据集规模 ≥200 且含 ≥5 个噪音标签", () => {
  assert.ok(MATCHER_DATASET.length >= 200, `实际 ${MATCHER_DATASET.length}`);
  assert.ok(MATCHER_DATASET.filter(c => !c.key).length >= 5, "噪音标签不足");
});

test("matchRules: 常见字段命中率 ≥95%（姓名/电话/邮箱等）", () => {
  const common = ["name", "phone", "email", "gender", "birthDate", "school", "degree", "major", "graduationYear", "workYears", "currentCity"];
  const cases = MATCHER_DATASET.filter(c => common.includes(c.key));
  assert.ok(cases.length >= 80, `常见字段样本 ${cases.length}`);
  const results = matchRules(toFields(cases.map(c => c.label)), FULL_RESUME);
  const correct = results.filter((r, index) => r.fieldKey === cases[index].key && r.status === "match").length;
  assert.ok(correct / cases.length >= 0.95, `常见字段命中率 ${correct}/${cases.length}`);
});

test("matchRules: 总体命中率 ≥85%（含噪音与复杂字段）", () => {
  const cases = MATCHER_DATASET;
  const results = matchRules(toFields(cases.map(c => c.label)), FULL_RESUME);
  const correct = results.filter((r, index) => {
    const expected = cases[index];
    return expected.key ? (r.fieldKey === expected.key && r.status === "match") : (r.fieldKey === "" && r.status === "manual");
  }).length;
  assert.ok(correct / cases.length >= 0.85, `总体命中率 ${correct}/${cases.length}`);
});

test("matchRules: 高置信度的常见字段", () => {
  const results = matchRules(toFields(["姓名", "手机号码", "邮箱"]), FULL_RESUME);
  assert.ok(results.every(r => r.confidence === "high"), JSON.stringify(results.map(r => r.confidence)));
});

test("matchRules: 简历缺少值时降级为 manual", () => {
  const results = matchRules(toFields(["期望薪资"]), {});
  const hit = results[0];
  assert.equal(hit.status, "manual");
  assert.equal(hit.fieldKey, "expectedSalary");
  assert.match(hit.reason, /简历中缺少/);
});

test("matchRules: skipped 控件标记 manual", () => {
  const results = matchRules([{ id: "p1", type: "text", label: "密码", skipped: true }], FULL_RESUME);
  assert.equal(results[0].status, "manual");
  assert.match(results[0].reason, /不支持自动填充/);
});

test("matchRules: 无标签字段标记 manual", () => {
  const results = matchRules([{ id: "x1", type: "text", label: "", skipped: false }], FULL_RESUME);
  assert.equal(results[0].status, "manual");
});

test("applyAiResults: AI 补全未识别字段", () => {
  const matches = [{ fieldId: "f0", fieldKey: "", value: "", confidence: null, source: "rule", status: "manual", reason: "未识别字段含义", label: "你期望的薪资", type: "text" }];
  const ai = [{ fieldId: "f0", fieldKey: "expectedSalary", value: "30-40K", confidence: "high", reason: "简历期望薪资" }];
  const merged = applyAiResults(matches, ai);
  assert.equal(merged[0].fieldKey, "expectedSalary");
  assert.equal(merged[0].value, "30-40K");
  assert.equal(merged[0].source, "ai");
  assert.equal(merged[0].status, "match");
});

test("applyAiResults: AI 返回未知字段或空值时保持 manual", () => {
  const matches = [{ fieldId: "f0", fieldKey: "", value: "", confidence: null, source: "rule", status: "manual", reason: "未识别字段含义" }];
  const merged1 = applyAiResults(matches, [{ fieldId: "f0", fieldKey: "notARealKey", value: "x" }]);
  assert.equal(merged1[0].status, "manual");
  const merged2 = applyAiResults(matches, [{ fieldId: "f0", fieldKey: "name", value: "" }]);
  assert.equal(merged2[0].status, "manual");
});

test("applyAiResults: AI 不覆盖已确认的规则匹配", () => {
  const matches = [{ fieldId: "f0", fieldKey: "name", value: "张三", confidence: "high", source: "rule", status: "match" }];
  const merged = applyAiResults(matches, [{ fieldId: "f0", fieldKey: "email", value: "hack@x.com" }]);
  assert.equal(merged[0].fieldKey, "name");
  assert.equal(merged[0].value, "张三");
});

test("buildAiMatchPrompt: 包含字段列表、简历字段与可用 key", () => {
  const messages = buildAiMatchPrompt([{ fieldId: "f0", label: "期望薪资", type: "text" }], FULL_RESUME);
  const content = messages[0].content;
  assert.ok(content.includes("fieldId"));
  assert.ok(content.includes("expectedSalary"));
  assert.ok(content.includes("13800138000"));
  assert.ok(content.includes(RESUME_FIELD_LABELS.name));
});

test("matchFields: aiMatch=false 不调用 AI", async () => {
  let called = false;
  const results = await matchFields(toFields(["姓名"]), FULL_RESUME, { aiMatch: false, aiCall: async () => { called = true; return []; } });
  assert.equal(called, false);
  assert.equal(results[0].fieldKey, "name");
});

test("matchFields: aiMatch=true 只对需要字段调用 AI", async () => {
  const needs = [];
  const results = await matchFields(toFields(["姓名", "你期望的薪资待遇"]), FULL_RESUME, {
    aiMatch: true,
    aiCall: async (messages) => {
      const payload = JSON.parse(messages[0].content.match(/表单字段：(\[.*?\])/s)?.[1] || "[]");
      needs.push(...payload.map(p => p.fieldId));
      return [{ fieldId: "f1", fieldKey: "expectedSalary", value: "30-40K", confidence: "high" }];
    },
  });
  assert.deepEqual(needs, ["f1"], "只应调用一次且只含未识别字段");
  assert.equal(results[0].fieldKey, "name");
  assert.equal(results[1].fieldKey, "expectedSalary");
  assert.equal(results[1].source, "ai");
});

test("matchFields: AI 调用失败时降级为 manual 不抛错", async () => {
  const results = await matchFields(toFields(["你期望的薪资待遇"]), FULL_RESUME, {
    aiMatch: true,
    aiCall: async () => { throw new Error("网络错误"); },
  });
  assert.equal(results[0].status, "manual");
});

test("matchRules: 非布尔勾选框标记 manual", () => {
  const results = matchRules([{ id: "c1", type: "checkbox", label: "技能", skipped: false }], FULL_RESUME);
  assert.equal(results[0].status, "manual");
  assert.match(results[0].reason, /手动确认/);
});

test("matchRules: 布尔勾选框可匹配", () => {
  const results = matchRules([{ id: "c2", type: "checkbox", label: "是否接受调剂", skipped: false }], { ...FULL_RESUME, name: "" });
  assert.equal(results[0].fieldKey, "");
});
