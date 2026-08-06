import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TEMPLATE_MAX, buildTemplateFromMatches, saveTemplateFromResults,
  applyTemplate, capTemplates, templateKey,
} from "../src/site-templates.js";

const mkMatch = (fieldId, fieldKey, value, source, status = "match") => ({
  fieldId, fieldKey, value, confidence: "high", source, status, reason: "",
  label: fieldKey, rawLabel: fieldKey, type: "text", path: `#${fieldId}`, fingerprint: `fp-${fieldId}`,
});

test("templateKey: 提取 hostname", () => {
  assert.equal(templateKey("https://apply.example.com/x"), "apply.example.com");
  assert.equal(templateKey(""), "");
});

test("buildTemplateFromMatches: 仅收录 match 且有 fieldKey 的字段", () => {
  const matches = [mkMatch("f1", "name", "张三"), mkMatch("f2", "", "", "rule", "manual"), mkMatch("f3", "phone", "13800138000")];
  const template = buildTemplateFromMatches("example.com", "https://apply.example.com/x", matches);
  assert.equal(template.origin, "https://apply.example.com/x");
  assert.equal(template.mappings.length, 2);
  const name = template.mappings.find(f => f.fieldKey === "name");
  assert.deepEqual(name.valueRef, { source: "resume", path: "name" });
  assert.equal(name.pathHint, "#f1");
  assert.equal("value" in name, false);
  assert.ok(name.updatedAt);
});

test("applyTemplate: 同字段身份套用语义映射并从当前简历取值", () => {
  const matches = [
    { fieldId: "a1", fieldKey: "name", value: "李四", confidence: "high", source: "rule", status: "match", label: "姓名", rawLabel: "姓名", type: "text", path: "#a1", fingerprint: "fp-name" },
    { fieldId: "a2", fieldKey: "", value: "", confidence: null, source: "rule", status: "manual", label: "未知字段", rawLabel: "未知字段" },
  ];
  const template = buildTemplateFromMatches("example.com", "https://apply.example.com", matches, { formFingerprint: "form-a" });
  const applied = applyTemplate(matches, template, { name: "赵六" }, { formFingerprint: "form-a" });
  assert.equal(applied[0].value, "赵六");
  assert.equal(applied[0].source, "template");
  assert.equal(applied[0].status, "match");
  assert.equal(applied[1].status, "manual", "未识别字段不受模板影响");
});

test("applyTemplate: 无模板时不改变匹配", () => {
  const matches = [mkMatch("f1", "name", "张三")];
  assert.deepEqual(applyTemplate(matches, null), matches);
});

test("saveTemplateFromResults: 只持久化字段映射", () => {
  const matches = [{ ...mkMatch("f1", "name", "张三"), userConfirmed: true }, mkMatch("f2", "phone", "13900000000")];
  const existing = null;
  const template = saveTemplateFromResults("example.com", "https://apply.example.com", matches, existing);
  assert.equal(template.mappings.length, 2);
  assert.equal(template.mappings[0].userConfirmed, true);
  assert.equal("value" in template.mappings[0], false);
});

test("saveTemplateFromResults: 已存在模板时更新同名站点字段", () => {
  const existing = buildTemplateFromMatches("example.com", "https://apply.example.com", [mkMatch("f1", "name", "旧值")]);
  const matches = [mkMatch("f1", "name", "新值"), mkMatch("f9", "email", "a@b.com")];
  const template = saveTemplateFromResults("example.com", "https://apply.example.com", matches, existing);
  assert.deepEqual(template.mappings.find(f => f.fieldKey === "name").valueRef, { source: "resume", path: "name" });
  assert.equal(template.mappings.length, 2);
});

test("capTemplates: 超过上限时淘汰最旧（LRU 按 updatedAt）", () => {
  const templates = {};
  const now = Date.now();
  for (let i = 0; i < TEMPLATE_MAX + 5; i++) {
    templates[`host${i}`] = { host: `host${i}`, origin: `https://host${i}`, fields: [], updatedAt: new Date(now - (TEMPLATE_MAX + 5 - i) * 1000).toISOString() };
  }
  const capped = capTemplates(templates);
  const hosts = Object.keys(capped);
  assert.equal(hosts.length, TEMPLATE_MAX);
  assert.ok(!hosts.includes("host0"), "最旧的 host0 应被淘汰");
  assert.ok(hosts.includes(`host${TEMPLATE_MAX + 4}`), "最新的应保留");
});

test("saveTemplateFromResults: 合并历史字段（分步表单跨步记忆）", () => {
  const prior = buildTemplateFromMatches("example.com", "https://apply.example.com/x", [
    mkMatch("f1", "name", "张三"),
    mkMatch("f2", "phone", "旧号"),
  ]);
  // 第二次扫描只扫到 name 与 email（分步表单下一步）
  const current = [mkMatch("f1", "name", "张三"), mkMatch("f5", "email", "a@b.com")];
  const template = saveTemplateFromResults("example.com", "https://apply.example.com/x", current, prior);
  const keys = template.mappings.map(f => f.fieldKey).sort();
  assert.deepEqual(keys, ["email", "name", "phone"], "历史字段应保留追加");
  assert.equal(JSON.stringify(template).includes("张三"), false);
  assert.equal(JSON.stringify(template).includes("旧号"), false);
});

test("Template V2: 只保存语义映射，不持久化姓名手机号等具体值", () => {
  const matches = [
    { ...mkMatch("f1", "name", "张三"), fingerprint: "fp-name" },
    { ...mkMatch("f2", "phone", "13800138000"), fingerprint: "fp-phone" },
  ];
  const template = buildTemplateFromMatches(
    "example.com",
    "https://apply.example.com/x",
    matches,
    { formFingerprint: "form-a" }
  );
  assert.equal(template.schemaVersion, 2);
  assert.equal(template.scope.formFingerprint, "form-a");
  assert.ok(Array.isArray(template.mappings));
  assert.equal(JSON.stringify(template).includes("张三"), false);
  assert.equal(JSON.stringify(template).includes("13800138000"), false);
  assert.deepEqual(template.mappings.map(item => item.valueRef.path), ["name", "phone"]);
});

test("Template V2: 切换 profile 后按 valueRef 解析当前简历值", () => {
  const template = buildTemplateFromMatches(
    "example.com",
    "https://apply.example.com/x",
    [{ ...mkMatch("f1", "name", "张三"), label: "姓名", rawLabel: "姓名", fingerprint: "fp-name" }],
    { formFingerprint: "form-a" }
  );
  const current = [{
    ...mkMatch("next-name", "name", "李四"),
    label: "姓名",
    rawLabel: "姓名",
    fingerprint: "fp-name",
  }];
  const applied = applyTemplate(current, template, { name: "李四" }, { formFingerprint: "form-a" });
  assert.equal(applied[0].value, "李四", "模板不得复用旧 profile 的张三");
  assert.equal(applied[0].source, "template");
});

test("Template V2: 重复同标签字段按 fingerprint 区分，不取第一条", () => {
  const template = buildTemplateFromMatches(
    "example.com",
    "https://apply.example.com/x",
    [
      { ...mkMatch("school-1", "school", "本科院校"), label: "学校", rawLabel: "学校", fingerprint: "fp-school-1" },
      { ...mkMatch("school-2", "school", "硕士院校"), label: "学校", rawLabel: "学校", fingerprint: "fp-school-2" },
    ],
    { formFingerprint: "form-a" }
  );
  const current = [
    { ...mkMatch("next-1", "school", "当前院校"), label: "学校", rawLabel: "学校", fingerprint: "fp-school-1" },
    { ...mkMatch("next-2", "school", "当前院校"), label: "学校", rawLabel: "学校", fingerprint: "fp-school-2" },
  ];
  const applied = applyTemplate(current, template, { school: "当前院校" }, { formFingerprint: "form-a" });
  assert.equal(applied[0].templateMappingFingerprint, "fp-school-1");
  assert.equal(applied[1].templateMappingFingerprint, "fp-school-2");
});

test("Template V2: path 相同但字段指纹变化时不得套用旧映射", () => {
  const template = buildTemplateFromMatches(
    "example.com",
    "https://apply.example.com/x",
    [{ ...mkMatch("f1", "name", "张三"), label: "姓名", fingerprint: "fp-old" }],
    { formFingerprint: "form-a" }
  );
  const current = [{ ...mkMatch("f1", "phone", "13800138000"), label: "姓名", fingerprint: "fp-new" }];
  const applied = applyTemplate(current, template, { name: "李四", phone: "13900000000" }, { formFingerprint: "form-a" });
  assert.equal(applied[0].source, current[0].source);
  assert.equal(applied[0].fieldKey, "phone");
  assert.equal(applied[0].value, "13800138000");
});

test("saveTemplateFromResults: 敏感字段 userConfirmed 不持久化", () => {
  const matches = [{ ...mkMatch("f1", "idCard", "110101199806010011"), userConfirmed: true }];
  const template = saveTemplateFromResults("example.com", "https://apply.example.com", matches, null);
  assert.equal(template.mappings[0].fieldKey, "idCard");
  assert.equal(template.mappings[0].userConfirmed, false);
});

test("applyTemplate: 敏感字段忽略持久化 userConfirmed（旧模板带确认标记也不自动填入）", () => {
  const matches = [{
    fieldId: "a1", fieldKey: "", value: "", confidence: null, source: "rule", status: "manual",
    label: "身份证号", rawLabel: "身份证号", type: "text", fingerprint: "fp-idcard",
  }];
  const template = {
    schemaVersion: 2, host: "example.com", origin: "https://example.com",
    scope: { formFingerprint: "form-a" },
    mappings: [{
      fieldFingerprint: "fp-idcard", siteLabel: "身份证号", controlType: "text", slot: "single",
      fieldKey: "idCard", valueRef: { source: "resume", path: "idCard" }, userConfirmed: true,
    }],
    updatedAt: "",
  };
  const applied = applyTemplate(matches, template, { idCard: "110101199806010011" }, { formFingerprint: "form-a" });
  assert.equal(applied[0].status, "manual", "敏感字段不得因模板 userConfirmed 自动 match");
});