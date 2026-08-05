import { test } from "node:test";
import assert from "node:assert/strict";
import { MATCHER_DATASET } from "./data/matcher-dataset.js";
import { matchRules, applyAiResults, buildAiMatchPrompt, matchFields, validateBinding } from "../src/matcher.js";
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
  internshipCompany: "字节跳动", internshipTitle: "产品实习生", internshipStart: "2021-06",
  internshipEnd: "2021-09", internshipPeriod: "2021-06 至 2021-09", internshipDescription: "用户调研与需求文档",
  projectName: "智能招聘平台", projectRole: "项目负责人", projectCompany: "某科技集团",
  projectStart: "2022-03", projectEnd: "2022-06", projectPeriod: "2022-03 至 2022-06",
  projectDescription: "简历匹配算法，召回率提升 20%", profileSummary: "3 年产品经验，专注 B 端",
  additionalInfo: "可全职，一周内到岗", awards: "国家奖学金", certificates: "CET-6", campusExperience: "学生会主席",
};

function toFields(labels) {
  return labels.map((label, index) => ({ id: `f${index}`, type: "text", label, rawLabel: label, labelSource: "label", path: `#f${index}`, required: false, options: [], value: "", skipped: false }));
}

test("数据集规模 ≥200 且含 ≥5 个噪音标签", () => {
  assert.ok(MATCHER_DATASET.length >= 200, `实际 ${MATCHER_DATASET.length}`);
  assert.ok(MATCHER_DATASET.filter(c => !c.key).length >= 5, "噪音标签不足");
});

test("matchRules: 常见字段命中率 ≥95%（姓名/电话/邮箱等）", () => {
  const common = ["name", "phone", "email", "gender", "birthDate", "school", "degree", "major", "graduationYear", "workYears", "currentCity", "internshipCompany", "internshipTitle", "internshipPeriod", "internshipDescription", "projectName", "projectRole", "projectDescription", "profileSummary", "additionalInfo", "awards"];
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
  const results = matchRules(toFields(["工作年限"]), {});
  const hit = results[0];
  assert.equal(hit.status, "manual");
  assert.equal(hit.fieldKey, "workYears");
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
  const fields = [{ id: "f0", label: "工作年限", type: "text", skipped: false, options: [] }];
  const matches = [{ fieldId: "f0", fieldKey: "", value: "", confidence: null, source: "rule", status: "manual", reason: "未识别字段含义", label: "工作年限", type: "text" }];
  const ai = [{ fieldId: "f0", fieldKey: "workYears", confidence: "high", reason: "简历工作年限" }];
  const merged = applyAiResults(matches, ai, fields, FULL_RESUME);
  assert.equal(merged[0].fieldKey, "workYears");
  assert.equal(merged[0].value, "5年");
  assert.equal(merged[0].source, "ai");
  assert.equal(merged[0].status, "match");
});

test("applyAiResults: AI 返回未知字段或空值时保持 manual", () => {
  const fields = [{ id: "f0", label: "未知字段", type: "text", skipped: false, options: [] }];
  const matches = [{ fieldId: "f0", fieldKey: "", value: "", confidence: null, source: "rule", status: "manual", reason: "未识别字段含义" }];
  const merged1 = applyAiResults(matches, [{ fieldId: "f0", fieldKey: "notARealKey" }], fields, FULL_RESUME);
  assert.equal(merged1[0].status, "manual");
  const merged2 = applyAiResults(matches, [{ fieldId: "f0", fieldKey: "name" }], fields, { ...FULL_RESUME, name: "" });
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
  assert.ok(!content.includes("13800138000"));
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
  const results = await matchFields(toFields(["姓名", "你期望的工作城市"]), FULL_RESUME, {
    aiMatch: true,
    aiCall: async (messages) => {
      const payload = JSON.parse(messages[0].content.match(/页面字段证据：(\[[\s\S]*\])\n只输出/)?.[1] || "[]");
      needs.push(...payload.map(p => p.fieldId));
      return [{ fieldId: "f1", fieldKey: "expectedCity", confidence: "high" }];
    },
  });
  assert.deepEqual(needs, ["f1"], "只应调用一次且只含未识别字段");
  assert.equal(results[0].fieldKey, "name");
  assert.equal(results[1].fieldKey, "expectedCity");
  assert.equal(results[1].source, "ai");
  assert.equal(results[1].status, "manual", "纯 AI 文本语义建议需用户确认");
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

test("matchRules: select 选项不匹配时降级 manual（含子串合理匹配）", () => {
  const noHit = matchRules([{ id: "s1", type: "select", label: "学历", options: ["博士"] }], FULL_RESUME);
  assert.equal(noHit[0].status, "manual");
  assert.match(noHit[0].reason, /选项不匹配/);
  const hit = matchRules([{ id: "s2", type: "select", label: "工作年限", options: ["1-3年", "3-5年"] }], FULL_RESUME);
  assert.equal(hit[0].status, "match", "3-5年 包含 5年 视为合理匹配");
});

test("matchRules: select 无选项信息时不校验", () => {
  const result = matchRules([{ id: "s3", type: "select", label: "学历", options: [] }], FULL_RESUME);
  assert.equal(result[0].status, "match");
});

test("matchRules: 自定义下拉关闭态的当前展示值不作为完整选项集", () => {
  const result = matchRules([{
    id: "degree-custom",
    type: "custom-select",
    label: "学历",
    options: ["本科"],
    optionsComplete: false,
  }], { ...FULL_RESUME, degree: "硕士" });
  assert.equal(result[0].status, "match");
  assert.equal(result[0].value, "硕士");
});

test("matchRules: 区号下拉按手机号自动推导（不依赖标签）", () => {
  // 标签错位也无妨：选项特征即识别依据
  const fields = [
    { id: "cc1", type: "select", label: "姓名", options: ["+86", "+852", "+1"] },
    { id: "cc2", type: "select", label: "手机号码", options: ["+86", "+852"] },
  ];
  const r1 = matchRules(fields, FULL_RESUME);
  assert.equal(r1[0].fieldKey, "phone");
  assert.equal(r1[0].value, "+86", "大陆手机号应推导 +86");
  assert.equal(r1[0].status, "match");
  assert.equal(r1[1].fieldKey, "phone");
  assert.equal(r1[1].value, "+86");
});

test("matchRules: 区号下拉推导失败时 manual 而非填手机号值", () => {
  const result = matchRules(
    [{ id: "cc1", type: "select", label: "手机号码", options: ["+1", "+44"] }],
    FULL_RESUME
  );
  assert.equal(result[0].status, "manual", "无 +86 选项时不应填入手机号");
  assert.match(result[0].reason, /区号/);
  const empty = matchRules(
    [{ id: "cc2", type: "select", label: "手机号码", options: ["+86", "+852"] }],
    { ...FULL_RESUME, phone: "" }
  );
  assert.equal(empty[0].status, "manual", "简历无手机号时区号留手动");
});

test("matchRules: 带区号前缀的海外手机号推导区号", () => {
  const result = matchRules(
    [{ id: "cc1", type: "select", label: "手机号码", options: ["+86", "+852", "+1"] }],
    { ...FULL_RESUME, phone: "+852 61234567" }
  );
  assert.equal(result[0].value, "+852");
  assert.equal(result[0].status, "match");
});

test("matchRules: 格式兼容校验——姓名值进不了 tel/email/date 控件", () => {
  const r1 = matchRules([{ id: "t1", type: "tel", label: "手机号码", options: [] }], { ...FULL_RESUME, name: "张三", phone: "" });
  // 标签命中 phone 但简历 phone 为空 → 用 name 值验证格式拦截
  const r2 = matchRules([{ id: "t2", type: "tel", label: "姓名", options: [] }], FULL_RESUME);
  assert.equal(r2[0].status, "manual", "姓名值不应填入 tel 控件");
  assert.match(r2[0].reason, /格式|匹配/);
  const r3 = matchRules([{ id: "e1", type: "email", label: "姓名", options: [] }], FULL_RESUME);
  assert.equal(r3[0].status, "manual", "姓名值不应填入 email 控件");
  const r4 = matchRules([{ id: "d1", type: "date", label: "姓名", options: [] }], FULL_RESUME);
  assert.equal(r4[0].status, "manual", "姓名值不应填入 date 控件");
});

test("matchRules: 正常电话/邮箱/日期不受格式校验影响", () => {
  const r1 = matchRules([{ id: "t1", type: "tel", label: "手机号码", options: [] }], FULL_RESUME);
  assert.equal(r1[0].status, "match");
  const r2 = matchRules([{ id: "e1", type: "email", label: "邮箱", options: [] }], FULL_RESUME);
  assert.equal(r2[0].status, "match");
  const r3 = matchRules([{ id: "d1", type: "date", label: "出生日期", options: [] }], FULL_RESUME);
  assert.equal(r3[0].status, "match");
});

test("日期目标精度：month 接受年月，date 缺少日时降级人工", () => {
  const month = matchRules([{
    id: "month",
    type: "date",
    label: "出生年月",
    dateMeta: { framework: "native", nativeType: "month", mode: "month" },
    options: [],
  }], FULL_RESUME);
  assert.equal(month[0].status, "match");
  assert.equal(month[0].value, "1998-06");

  const date = matchRules([{
    id: "date",
    type: "date",
    label: "出生日期",
    dateMeta: { framework: "native", nativeType: "date", mode: "date" },
    options: [],
  }], FULL_RESUME);
  assert.equal(date[0].status, "manual");
  assert.match(date[0].reason, /格式/);

  const exactDate = matchRules([{
    id: "exact-date",
    type: "date",
    label: "出生日期",
    dateMeta: { framework: "native", nativeType: "date", mode: "date" },
    options: [],
  }], { ...FULL_RESUME, birthDate: "1998-06-15" });
  assert.equal(exactDate[0].status, "match");
});

test("matchRules: 紧急联系人上下文不得自动映射候选人本人信息", () => {
  const results = matchRules(toFields(["紧急联系人姓名", "紧急联系人电话", "Emergency Contact Name", "Parent Phone"]), FULL_RESUME);
  assert.ok(results.every(result => result.status === "manual"), JSON.stringify(results));
  assert.ok(results.every(result => /上下文|人工|无法确定/.test(result.reason)), JSON.stringify(results.map(result => result.reason)));
});

test("applyAiResults: AI 不能绕过 tel 类型冲突与规则层 manual", () => {
  const fields = [{ id: "tel-name", type: "tel", label: "姓名", options: [], skipped: false }];
  const rule = matchRules(fields, FULL_RESUME);
  assert.equal(rule[0].status, "manual");
  const merged = applyAiResults(
    rule,
    [{ fieldId: "tel-name", fieldKey: "name", value: "张三", confidence: "high" }],
    fields,
    FULL_RESUME
  );
  assert.equal(merged[0].status, "manual");
  assert.notEqual(merged[0].source, "ai", "冲突候选不得被标记为 AI 成功匹配");
});

test("applyAiResults: AI 不能绕过 skipped 与 select 选项校验", () => {
  const fields = [
    { id: "file1", type: "text", label: "上传简历", skipped: true, options: [] },
    { id: "degree1", type: "select", label: "学历", skipped: false, options: ["本科", "硕士"] },
  ];
  const rule = matchRules(fields, { ...FULL_RESUME, degree: "博士" });
  const merged = applyAiResults(
    rule,
    [
      { fieldId: "file1", fieldKey: "name", value: "张三", confidence: "high" },
      { fieldId: "degree1", fieldKey: "degree", value: "博士", confidence: "high" },
    ],
    fields,
    { ...FULL_RESUME, degree: "博士" }
  );
  assert.equal(merged[0].status, "manual");
  assert.equal(merged[1].status, "manual");
});

test("applyAiResults: 最终值必须从当前简历 fieldKey 解析，不接受 AI 编造值", () => {
  const fields = [{ id: "salary1", type: "text", label: "你的工龄多长", options: [], skipped: false }];
  const rule = matchRules(fields, FULL_RESUME);
  const merged = applyAiResults(
    rule,
    [{ fieldId: "salary1", fieldKey: "workYears", value: "999K", confidence: "high" }],
    fields,
    FULL_RESUME
  );
  assert.equal(merged[0].status, "manual", "缺少本地证据时仍需人工确认");
  assert.equal(merged[0].value, FULL_RESUME.workYears);
});

test("buildAiMatchPrompt: AI 只返回语义 fieldKey，不发送简历具体值", () => {
  const content = buildAiMatchPrompt(
    [{ fieldId: "f0", label: "你期望的薪资待遇", type: "text", evidence: [{ source: "label", text: "你期望的薪资待遇" }] }],
    FULL_RESUME
  )[0].content;
  assert.ok(!content.includes(FULL_RESUME.phone), "字段匹配无需向 AI 发送手机号");
  assert.ok(!content.includes(FULL_RESUME.email), "字段匹配无需向 AI 发送邮箱");
  assert.match(content, /fieldKey/);
  assert.ok(!/"value"/.test(content), "AI 输出协议不应包含 value");
});

test("applyAiResults: 通用 text 控件缺少本地证据时 AI 结果只作建议", () => {
  const fields = [{ id: "generic1", type: "text", label: "请补充信息", skipped: false, options: [] }];
  const matches = matchRules(fields, FULL_RESUME);
  const merged = applyAiResults(
    matches,
    [{ fieldId: "generic1", fieldKey: "name", confidence: "high" }],
    fields,
    FULL_RESUME
  );
  assert.equal(merged[0].fieldKey, "name");
  assert.equal(merged[0].source, "ai");
  assert.equal(merged[0].status, "manual");
  assert.match(merged[0].reason, /人工确认/);
});

test("重复经历字段：默认降级人工，并可用数组 ValueRef 精确绑定", () => {
  const fields = [
    { id: "school-1", type: "text", label: "学校", skipped: false, options: [], fingerprint: "fp-school-1" },
    { id: "school-2", type: "text", label: "学校", skipped: false, options: [], fingerprint: "fp-school-2" },
  ];
  const resume = {
    ...FULL_RESUME,
    education: [
      { school: "复旦大学" },
      { school: "清华大学" },
    ],
  };
  const results = matchRules(fields, resume);
  assert.ok(results.every(result => result.status === "manual" && result.lockedManual), JSON.stringify(results));
  const first = validateBinding(fields[0], "school", resume, {
    source: "manual",
    confidence: "high",
    userConfirmed: true,
    valueRef: { source: "resume", path: "education[0].school" },
  });
  const second = validateBinding(fields[1], "school", resume, {
    source: "manual",
    confidence: "high",
    userConfirmed: true,
    valueRef: { source: "resume", path: "education[1].school" },
  });
  assert.equal(first.value, "复旦大学");
  assert.equal(second.value, "清华大学");
  assert.equal(first.status, "match");
  assert.equal(second.status, "match");
});

test("区块语境：米哈游通用标签映射到对应经历条目而非现公司字段", () => {
  const context = (sectionKey, arrayKey, itemIndex = 0) => ({
    section: sectionKey,
    sectionKey,
    repeat: { arrayKey, itemIndex },
  });
  const fields = [
    { id: "company", type: "text", label: "公司名称", context: context("internship", "internships"), options: [] },
    { id: "industry", type: "text", label: "所在行业", context: context("internship", "internships"), options: [] },
    { id: "location", type: "text", label: "工作地点", context: context("internship", "internships"), options: [] },
    { id: "title", type: "text", label: "职位名称", context: context("internship", "internships"), options: [] },
    { id: "summary", type: "textarea", label: "工作职责", context: context("internship", "internships"), options: [] },
    { id: "project-role", type: "text", label: "职务", context: context("project", "projects"), options: [] },
    { id: "project-description", type: "textarea", label: "项目描述", context: context("project", "projects"), options: [] },
    { id: "project-responsibility", type: "textarea", label: "项目职责", context: context("project", "projects"), options: [] },
  ];
  const resume = {
    ...FULL_RESUME,
    internships: [{
      company: "甲公司",
      industry: "互联网",
      location: "上海",
      title: "产品实习生",
      description: "负责需求分析",
    }],
    projects: [{
      role: "负责人",
      description: "项目背景与成果",
      responsibility: "负责产品设计",
    }],
  };
  const results = Object.fromEntries(matchRules(fields, resume).map(result => [result.fieldId, result]));
  assert.equal(results.company.fieldKey, "internshipCompany");
  assert.equal(results.company.valueRef.path, "internships[0].company");
  assert.equal(results.industry.fieldKey, "internshipIndustry");
  assert.equal(results.location.fieldKey, "internshipLocation");
  assert.equal(results.title.fieldKey, "internshipTitle");
  assert.equal(results.summary.fieldKey, "internshipDescription");
  assert.equal(results["project-role"].fieldKey, "projectRole");
  assert.equal(results["project-description"].fieldKey, "projectDescription");
  assert.equal(results["project-responsibility"].fieldKey, "projectResponsibility");
});

test("教育日期范围：MM/YYYY 规范化并按同一经历 start/end 绑定", () => {
  const repeat = { arrayKey: "education", itemIndex: 0 };
  const fields = [
    {
      id: "edu-start",
      type: "custom-date",
      label: "起止时间",
      slot: "start",
      context: { section: "教育背景", sectionKey: "education", repeat },
      evidence: [{ source: "semantic", text: "教育开始时间", weight: 95 }],
      options: [],
    },
    {
      id: "edu-end",
      type: "custom-date",
      label: "毕业时间",
      slot: "end",
      context: { section: "教育背景", sectionKey: "education", repeat },
      options: [],
    },
  ];
  const results = matchRules(fields, {
    ...FULL_RESUME,
    education: [{ start: "09/2022", end: "11/2026" }],
  });
  assert.equal(results[0].fieldKey, "educationStart");
  assert.equal(results[0].value, "2022-09");
  assert.equal(results[0].valueRef.path, "education[0].start");
  assert.equal(results[1].fieldKey, "graduationYear");
  assert.equal(results[1].value, "2026-11");
  assert.equal(results[1].valueRef.path, "education[0].end");
});

test("教育日期范围：缺少任一端时整组降级人工，禁止写入半段范围", () => {
  const repeat = { arrayKey: "education", itemIndex: 0 };
  const fields = [
    {
      id: "edu-start",
      type: "custom-date",
      label: "起止时间",
      adapter: "date-range",
      slot: "start",
      context: { sectionKey: "education", repeat },
      evidence: [{ source: "semantic", text: "教育开始时间", weight: 95 }],
      options: [],
    },
    {
      id: "edu-end",
      type: "custom-date",
      label: "毕业时间",
      adapter: "date-range",
      slot: "end",
      context: { sectionKey: "education", repeat },
      options: [],
    },
  ];
  const results = matchRules(fields, {
    ...FULL_RESUME,
    education: [{ start: "", end: "06/2025" }],
  });
  assert.ok(results.every(result => result.status === "manual" && result.lockedManual));
  assert.ok(results.every(result => /同时具备开始和结束时间/.test(result.reason)));
});

test("敏感字段集合：默认强制 manual，用户确认后可填", () => {
  const fields = [
    { id: "f1", label: "身份证号", type: "text", evidence: [{ source: "label", text: "身份证号", weight: 90 }], context: {} },
    { id: "f2", label: "期望薪资", type: "text", evidence: [{ source: "label", text: "期望薪资", weight: 90 }], context: {} },
    { id: "f3", label: "紧急联系人姓名", type: "text", evidence: [{ source: "label", text: "紧急联系人姓名", weight: 90 }], context: {} },
  ];
  const resume = { name: "张三", phone: "13800138000", idCard: "110101199806010011", expectedSalary: "30-40K" };
  const matches = matchRules(fields, resume);
  for (const m of matches) assert.equal(m.status, "manual", `${m.label} 应默认 manual`);
  const confirmed = validateBinding(fields[0], "idCard", resume, { source: "manual", userConfirmed: true });
  assert.equal(confirmed.status, "match");
});

test("敏感字段集合：AI 也不能绕过，且不暴露简历值", () => {
  const fields = [{ id: "f0", label: "身份证号", type: "text", evidence: [{ source: "label", text: "身份证号", weight: 90 }], context: {} }];
  const matches = matchRules(fields, FULL_RESUME);
  assert.equal(matches[0].status, "manual");
  assert.equal(matches[0].value, "", "规则层敏感字段不携带简历值");
  const merged = applyAiResults(
    matches,
    [{ fieldId: "f0", fieldKey: "idCard", confidence: "high" }],
    fields,
    FULL_RESUME
  );
  assert.equal(merged[0].status, "manual", "AI 不能绕过敏感字段守卫");
  assert.equal(merged[0].value, "", "敏感字段不暴露简历值");
});
