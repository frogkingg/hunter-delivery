import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TEMPLATE_MAX, buildTemplateFromMatches, saveTemplateFromResults,
  applyTemplate, capTemplates, templateKey,
} from "../src/site-templates.js";

const mkMatch = (fieldId, fieldKey, value, source, status = "match") => ({
  fieldId, fieldKey, value, confidence: "high", source, status, reason: "",
  label: fieldKey, rawLabel: fieldKey, type: "text", path: `#${fieldId}`,
});

test("templateKey: 提取 hostname", () => {
  assert.equal(templateKey("https://apply.example.com/x"), "apply.example.com");
  assert.equal(templateKey(""), "");
});

test("buildTemplateFromMatches: 仅收录 match 且有 fieldKey 的字段", () => {
  const matches = [mkMatch("f1", "name", "张三"), mkMatch("f2", "", "", "rule", "manual"), mkMatch("f3", "phone", "13800138000")];
  const template = buildTemplateFromMatches("example.com", "https://apply.example.com/x", matches);
  assert.equal(template.origin, "https://apply.example.com/x");
  assert.equal(template.fields.length, 2);
  const name = template.fields.find(f => f.fieldKey === "name");
  assert.equal(name.value, "张三");
  assert.equal(name.path, "#f1");
  assert.ok(name.updatedAt);
});

test("applyTemplate: 同标签字段套用模板值，source=template", () => {
  const matches = [
    { fieldId: "a1", fieldKey: "name", value: "李四", confidence: "high", source: "rule", status: "match", label: "姓名", rawLabel: "姓名" },
    { fieldId: "a2", fieldKey: "", value: "", confidence: null, source: "rule", status: "manual", label: "未知字段", rawLabel: "未知字段" },
  ];
  const template = { host: "example.com", origin: "https://apply.example.com", fields: [{ fieldKey: "name", path: "#a1", siteLabel: "姓名", value: "王五", edited: true, updatedAt: "2026-08-03T00:00:00Z" }], updatedAt: "2026-08-03T00:00:00Z" };
  const applied = applyTemplate(matches, template);
  assert.equal(applied[0].value, "王五");
  assert.equal(applied[0].source, "template");
  assert.equal(applied[0].status, "match");
  assert.equal(applied[1].status, "manual", "未识别字段不受模板影响");
});

test("applyTemplate: 无模板时不改变匹配", () => {
  const matches = [mkMatch("f1", "name", "张三")];
  assert.deepEqual(applyTemplate(matches, null), matches);
});

test("saveTemplateFromResults: 用户编辑值标记 edited 并持久化", () => {
  const matches = [mkMatch("f1", "name", "张三"), mkMatch("f2", "phone", "13900000000")];
  const existing = null;
  const template = saveTemplateFromResults("example.com", "https://apply.example.com", matches, existing);
  assert.equal(template.fields.length, 2);
  assert.equal(template.fields[0].value, "张三");
});

test("saveTemplateFromResults: 已存在模板时更新同名站点字段", () => {
  const existing = buildTemplateFromMatches("example.com", "https://apply.example.com", [mkMatch("f1", "name", "旧值")]);
  const matches = [mkMatch("f1", "name", "新值"), mkMatch("f9", "email", "a@b.com")];
  const template = saveTemplateFromResults("example.com", "https://apply.example.com", matches, existing);
  assert.equal(template.fields.find(f => f.fieldKey === "name").value, "新值");
  assert.equal(template.fields.length, 2);
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
