import { test } from "node:test";
import assert from "node:assert/strict";
import { CANONICAL_FIELDS, FIELD_BY_KEY, normalizeLabel, classifyControl } from "../src/form-fields.js";

test("CANONICAL_FIELDS: 至少 30 个字段，key 唯一，每个含 label 与 ≥3 关键词", () => {
  assert.ok(CANONICAL_FIELDS.length >= 30, `当前 ${CANONICAL_FIELDS.length} 个字段`);
  const keys = new Set(CANONICAL_FIELDS.map(f => f.key));
  assert.equal(keys.size, CANONICAL_FIELDS.length, "key 必须唯一");
  for (const field of CANONICAL_FIELDS) {
    assert.ok(field.label, `${field.key} 缺 label`);
    assert.ok(field.keywords.length >= 3, `${field.key} 关键词少于 3 个`);
  }
});

test("CANONICAL_FIELDS: 覆盖全部常见网申字段", () => {
  for (const key of ["name", "phone", "email", "gender", "birthDate", "idCard", "school", "degree", "major", "graduationYear", "workYears", "currentCity", "expectedCity", "expectedSalary", "expectedPosition", "selfEvaluation", "skills", "availableTime"]) {
    assert.ok(FIELD_BY_KEY[key], `缺少字段 ${key}`);
  }
});

test("normalizeLabel: 去必填/星号/空白/标点", () => {
  assert.equal(normalizeLabel("*姓名（必填）"), "姓名");
  assert.equal(normalizeLabel("姓名*"), "姓名");
  assert.equal(normalizeLabel("您的邮箱（必填）"), "您的邮箱");
  assert.equal(normalizeLabel("请填写手机号"), "手机号");
  assert.equal(normalizeLabel("Full Name"), "fullname");
  assert.equal(normalizeLabel("联系电话："), "联系电话");
  assert.equal(normalizeLabel(""), "");
  assert.equal(normalizeLabel("  "), "");
  assert.equal(normalizeLabel("现居城市（选填）"), "现居城市");
  assert.equal(normalizeLabel("请输入姓名(必填)"), "姓名");
});

test("normalizeLabel: 去全角空格与混合空白", () => {
  assert.equal(normalizeLabel("毕业　院校"), "毕业院校");
  assert.equal(normalizeLabel("毕业 院校"), "毕业院校");
});

test("classifyControl: 原生控件类型映射", () => {
  assert.equal(classifyControl({ tag: "input", type: "text" }).type, "text");
  assert.equal(classifyControl({ tag: "input", type: "tel" }).type, "tel");
  assert.equal(classifyControl({ tag: "input", type: "email" }).type, "email");
  assert.equal(classifyControl({ tag: "input", type: "number" }).type, "number");
  assert.equal(classifyControl({ tag: "input", type: "date" }).type, "date");
  assert.equal(classifyControl({ tag: "input", type: "radio" }).type, "radio");
  assert.equal(classifyControl({ tag: "input", type: "checkbox" }).type, "checkbox");
  assert.equal(classifyControl({ tag: "select" }).type, "select");
  assert.equal(classifyControl({ tag: "textarea" }).type, "textarea");
});

test("classifyControl: 密码/文件/隐藏控件标记 skipped", () => {
  for (const type of ["password", "file", "hidden", "submit", "button"]) {
    const result = classifyControl({ tag: "input", type });
    assert.equal(result.type, "text");
    assert.equal(result.skipped, true, `${type} 应标记 skipped`);
  }
});

test("classifyControl: 组件库自定义控件识别", () => {
  assert.equal(classifyControl({ tag: "input", cls: "ant-select-selection-search-input" }).type, "custom-select");
  assert.equal(classifyControl({ tag: "div", cls: "el-select" }).type, "custom-select");
  assert.equal(classifyControl({ tag: "input", cls: "ant-picker-input" }).type, "custom-date");
  assert.equal(classifyControl({ tag: "div", cls: "el-date-editor" }).type, "custom-date");
});
