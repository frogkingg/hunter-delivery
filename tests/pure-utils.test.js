import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeHtml, safeUrl, validateEndpoint, sanitizeGreeting, trimLog } from "../src/pure-utils.js";

test("escapeHtml: 空值/undefined → 空串", () => {
  assert.equal(escapeHtml(undefined), "");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(""), "");
});

test("escapeHtml: 普通 HTML 被转义", () => {
  assert.equal(escapeHtml("<b>hi</b>"), "&lt;b&gt;hi&lt;/b&gt;");
});

test("escapeHtml: 引号注入被转义，属性无法闭合", () => {
  const out = escapeHtml('x" onfocus="alert(1)');
  assert.ok(out.includes("&quot;"));
  assert.ok(!out.includes('"'));
});

test("escapeHtml: 单引号 → &#39;", () => {
  assert.equal(escapeHtml("'"), "&#39;");
});

test("escapeHtml: 与号 → &amp;", () => {
  assert.equal(escapeHtml("a&b"), "a&amp;b");
});

test("escapeHtml: 与原 DOM 实现等价（对照常见输入）", () => {
  // 原 DOM 实现：textContent 编码 & < >，再替换 " 和 '。
  // 新实现显式处理这五个字符，对以下输入结果一致。
  const cases = ["", "<b>hi</b>", 'x"y', "a'b", "&", "<>&\"'", "正常中文", "1 < 2 && 3 > 0"];
  for (const input of cases) {
    const expected = String(input ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
    assert.equal(escapeHtml(input), expected);
  }
});

test("safeUrl: https 原样返回", () => {
  assert.equal(safeUrl("https://ok.com/x"), "https://ok.com/x");
});

test("safeUrl: http 原样返回", () => {
  assert.equal(safeUrl("http://ok.com"), "http://ok.com");
});

test("safeUrl: 相对路径原样返回", () => {
  assert.equal(safeUrl("/relative/path"), "/relative/path");
});

test("safeUrl: javascript: → #", () => {
  assert.equal(safeUrl("javascript:alert(1)"), "#");
});

test("safeUrl: data: → #", () => {
  assert.equal(safeUrl("data:text/html,<script>alert(1)</script>"), "#");
});

test("safeUrl: 空值 → #", () => {
  assert.equal(safeUrl(""), "#");
  assert.equal(safeUrl(undefined), "#");
  assert.equal(safeUrl(null), "#");
});

test("validateEndpoint: 合法 https 返回原值", () => {
  assert.equal(validateEndpoint("https://api.openai.com/v1"), "https://api.openai.com/v1");
});

test("validateEndpoint: http 抛必须为 https", () => {
  assert.throws(() => validateEndpoint("http://api.openai.com/v1"), /https/);
});

test("validateEndpoint: localhost 抛不允许本地或内网", () => {
  assert.throws(() => validateEndpoint("https://localhost/v1"), /本地或内网/);
});

test("validateEndpoint: 127.0.0.1 抛", () => {
  assert.throws(() => validateEndpoint("https://127.0.0.1/v1"), /本地或内网/);
});

test("validateEndpoint: 192.168.1.1 抛", () => {
  assert.throws(() => validateEndpoint("https://192.168.1.1/v1"), /本地或内网/);
});

test("validateEndpoint: 10.0.0.1 抛", () => {
  assert.throws(() => validateEndpoint("https://10.0.0.1/v1"), /本地或内网/);
});

test("validateEndpoint: 172.16.0.1 抛", () => {
  assert.throws(() => validateEndpoint("https://172.16.0.1/v1"), /本地或内网/);
});

test("validateEndpoint: 172.31.0.1 抛", () => {
  assert.throws(() => validateEndpoint("https://172.31.0.1/v1"), /本地或内网/);
});

test("validateEndpoint: 172.32.0.1 通过（不在内网范围）", () => {
  assert.equal(validateEndpoint("https://172.32.0.1/v1"), "https://172.32.0.1/v1");
});

test("validateEndpoint: 169.254.1.1 抛", () => {
  assert.throws(() => validateEndpoint("https://169.254.1.1/v1"), /本地或内网/);
});

test("validateEndpoint: 非法 URL 抛格式不正确", () => {
  assert.throws(() => validateEndpoint("not a url"), /格式不正确/);
});

test("validateEndpoint: 空值抛请先填写", () => {
  assert.throws(() => validateEndpoint(""), /请先填写/);
  assert.throws(() => validateEndpoint("   "), /请先填写/);
});

test("sanitizeGreeting: 正常招呼语返回 trim 后原值", () => {
  assert.equal(sanitizeGreeting("  你好，我对这个岗位很感兴趣  "), "你好，我对这个岗位很感兴趣");
});

test("sanitizeGreeting: 空值抛请先生成", () => {
  assert.throws(() => sanitizeGreeting(""), /请先生成或填写招呼语/);
  assert.throws(() => sanitizeGreeting("   "), /请先生成或填写招呼语/);
});

test("sanitizeGreeting: 超长抛招呼语过长", () => {
  assert.throws(() => sanitizeGreeting("a".repeat(601)), /招呼语过长/);
});

test("sanitizeGreeting: 含 微信123456 抛疑似联系方式", () => {
  assert.throws(() => sanitizeGreeting("你好，我的微信123456"), /疑似包含联系方式/);
});

test("sanitizeGreeting: 含 weixin:123456 抛", () => {
  assert.throws(() => sanitizeGreeting("联系weixin:123456"), /疑似包含联系方式/);
});

test("sanitizeGreeting: 含 https://x.com 抛疑似链接", () => {
  assert.throws(() => sanitizeGreeting("详见 https://x.com"), /疑似包含链接/);
});

test("sanitizeGreeting: 含 微信 但无数字 → 通过", () => {
  assert.equal(sanitizeGreeting("加微信聊聊"), "加微信聊聊");
});

test("sanitizeGreeting: 含 qq 但无 5 位以上数字 → 通过", () => {
  assert.equal(sanitizeGreeting("qq联系"), "qq联系");
});

test("trimLog: 正常截断到 max 条", () => {
  assert.deepEqual(trimLog([1, 2, 3], 2), [1, 2]);
});

test("trimLog: max 大于数组长度 → 返回原数组", () => {
  assert.deepEqual(trimLog([1, 2, 3], 5), [1, 2, 3]);
});

test("trimLog: 空数组 → 空数组", () => {
  assert.deepEqual(trimLog([], 3), []);
});

test("trimLog: max=0 → 空数组", () => {
  assert.deepEqual(trimLog([1, 2, 3], 0), []);
});

test("trimLog: max 为负数 → 空数组", () => {
  assert.deepEqual(trimLog([1, 2, 3], -1), []);
});

test("trimLog: max 为非数字 → 空数组", () => {
  assert.deepEqual(trimLog([1, 2, 3], "abc"), []);
});

test("trimLog: 非数组输入 → 空数组", () => {
  assert.deepEqual(trimLog(null, 3), []);
  assert.deepEqual(trimLog(undefined, 3), []);
});
