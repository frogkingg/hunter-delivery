import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDiagnostics, redactText, DIAG_MAX_ENTRIES } from "../src/diagnostics.js";

test("redactText：手机号/身份证/邮箱打码，URL 去 query/hash", () => {
  const out = redactText("联系人 13800138000，身份证 110101199806010011，邮箱 a@b.com，来自 https://x.com/a?token=1#frag");
  assert.ok(!out.includes("13800138000"));
  assert.ok(!out.includes("110101199806010011"));
  assert.ok(!out.includes("a@b.com"));
  assert.ok(!out.includes("token=1"));
  assert.ok(out.includes("https://x.com/a"));
});

test("buildDiagnostics：结构完整且不泄露简历值", () => {
  const diag = buildDiagnostics({
    engineVersion: 3, scanId: "s1", url: "https://apply.example.com/form?x=1",
    fields: [{ id: "i1", label: "姓名", type: "text" }],
    matchedBy: { rule: 1, template: 0, playbook: 0, ai: 0 },
    failures: [{ fieldId: "i2", siteLabel: "手机号", type: "tel", reason: "回读校验失败" }],
    ai: { requested: true, model: "deepseek-chat", fieldsSent: ["i2"] },
    timings: { scanMs: 85, matchMs: 12, applyMs: 460 },
    resume: { name: "张三", phone: "13800138000" },
  });
  assert.equal(diag.engineVersion, 3);
  assert.ok(!JSON.stringify(diag).includes("13800138000"), "诊断包不得包含简历具体值");
  assert.ok(!JSON.stringify(diag).includes("token=1"));
  assert.ok(diag.ai.fieldsSent.length === 1);
});

test("上限：entries 超 DIAG_MAX_ENTRIES 截断", () => {
  const fields = Array.from({ length: DIAG_MAX_ENTRIES + 5 }, (_, i) => ({ id: `i${i}`, label: `字段${i}`, type: "text" }));
  const diag = buildDiagnostics({ fields });
  assert.ok(diag.fields.length <= DIAG_MAX_ENTRIES);
});

test("redactText：带 userinfo 的 URL 剥离凭据与 query/hash，带分隔符手机号打码", () => {
  const out = redactText("联系 https://user:pass@example.com/path?token=abc#frag，手机 138 1234 5678 和 138-1234-5678");
  assert.ok(!out.includes("pass@example.com"));
  assert.ok(!out.includes("token=abc"));
  assert.ok(!out.includes("138 1234 5678"));
  assert.ok(!out.includes("138-1234-5678"));
  assert.ok(out.includes("https://example.com/path"));
});