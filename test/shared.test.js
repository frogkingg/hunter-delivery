// 用 node --test 运行，无需第三方依赖。
// node --version >= 18 自带 node:test 与 node:assert。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  endpointUrl, hostOf, assertSafeEndpoint,
  jsonFrom, jobIdentityKeys, sameJob, dedupeJobLibrary,
  sanitizeJobForLibrary, escapeCsv,
  DEFAULTS
} from "../lib/shared.js";

// ——— endpointUrl ———

test("endpointUrl 补全 /chat/completions", () => {
  assert.equal(endpointUrl("https://api.openai.com/v1"), "https://api.openai.com/v1/chat/completions");
  assert.equal(endpointUrl("https://api.openai.com/v1/"), "https://api.openai.com/v1/chat/completions");
  assert.equal(endpointUrl("https://api.openai.com/v1/chat/completions"), "https://api.openai.com/v1/chat/completions");
});

test("endpointUrl 空值", () => {
  assert.equal(endpointUrl(""), "/chat/completions");
  assert.equal(endpointUrl(undefined), "/chat/completions");
});

// ——— hostOf ———

test("hostOf 提取 host", () => {
  assert.equal(hostOf("https://api.openai.com/v1/chat/completions"), "api.openai.com");
  assert.equal(hostOf("not a url"), "AI 服务");
});

// ——— assertSafeEndpoint ———

test("assertSafeEndpoint 接受 https 公网", () => {
  assertSafeEndpoint("https://api.openai.com/v1");
  assertSafeEndpoint("https://api.deepseek.com/v1");
});

test("assertSafeEndpoint 拒绝 http", () => {
  assert.throws(() => assertSafeEndpoint("http://api.openai.com/v1"), /https/);
});

test("assertSafeEndpoint 拒绝私有/内网地址", () => {
  assert.throws(() => assertSafeEndpoint("https://127.0.0.1/v1"));
  assert.throws(() => assertSafeEndpoint("https://localhost/v1"));
  assert.throws(() => assertSafeEndpoint("https://10.0.0.1/v1"));
  assert.throws(() => assertSafeEndpoint("https://192.168.1.1/v1"));
  assert.throws(() => assertSafeEndpoint("https://172.16.0.1/v1"));
  assert.throws(() => assertSafeEndpoint("https://169.254.169.254/v1"));
});

test("assertSafeEndpoint 拒绝空值与非法 URL", () => {
  assert.throws(() => assertSafeEndpoint(""), /未配置/);
  assert.throws(() => assertSafeEndpoint("not-a-url"), /格式不正确/);
});

// ——— jsonFrom ———

test("jsonFrom 解析纯 JSON", () => {
  assert.deepEqual(jsonFrom('{"a":1}'), { a: 1 });
});

test("jsonFrom 剥离 think 标签", () => {
  const raw = '<think>some reasoning</think>\n{"greetings":[{"text":"hi"}]}';
  assert.deepEqual(jsonFrom(raw), { greetings: [{ text: "hi" }] });
});

test("jsonFrom 从代码块提取", () => {
  const raw = '说明文字\n```json\n{"a":1}\n```\n后续';
  assert.deepEqual(jsonFrom(raw), { a: 1 });
});

test("jsonFrom 从前后说明文字中提取首个对象", () => {
  const raw = '好的，这是结果：{"a":1,"b":{"c":2}} 希望有帮助';
  assert.deepEqual(jsonFrom(raw), { a: 1, b: { c: 2 } });
});

test("jsonFrom 处理嵌套大括号与字符串内大括号", () => {
  const raw = '{"text":"包含 } 字符","nested":{"x":1}}';
  assert.deepEqual(jsonFrom(raw), { text: "包含 } 字符", nested: { x: 1 } });
});

test("jsonFrom 处理转义引号", () => {
  const raw = '{"text":"含\\"引号"}';
  assert.deepEqual(jsonFrom(raw), { text: '含"引号' });
});

test("jsonFrom 非 JSON 抛错", () => {
  assert.throws(() => jsonFrom("完全没有 JSON 的文字"), /不是可读取的 JSON/);
  assert.throws(() => jsonFrom(""), /不是可读取的 JSON/);
});

// ——— jobIdentityKeys / sameJob / dedupeJobLibrary ———

test("jobIdentityKeys 从 detailUrl 提取 jobId", () => {
  const keys = jobIdentityKeys({ detailUrl: "https://www.zhipin.com/job_detail/abc123.html?securityId=x" });
  assert.ok(keys.some(k => k === "jobId:abc123"));
});

test("sameJob 同 jobId 视为同一岗位", () => {
  const a = { jobId: "abc", title: "前端", company: "X" };
  const b = { detailUrl: "https://www.zhipin.com/job_detail/abc.html", title: "前端工程师", company: "X" };
  assert.ok(sameJob(a, b));
});

test("sameJob 不同岗位不误判", () => {
  const a = { jobId: "abc", title: "前端", company: "X" };
  const b = { jobId: "xyz", title: "后端", company: "Y" };
  assert.ok(!sameJob(a, b));
});

test("sameJob 列表页 url 仅在缺少 jobId/detailUrl/key 时作为兜底", () => {
  const listUrl = "https://www.zhipin.com/web/geek/jobs";
  const a = { url: listUrl, title: "前端", company: "X", location: "北京" };
  const b = { detailUrl: "https://www.zhipin.com/job_detail/xyz.html", url: listUrl, title: "后端", company: "Y", location: "上海" };
  assert.ok(!sameJob(a, b));
});

test("sameJob company|title|location 兜底匹配", () => {
  const a = { company: "X", title: "前端", location: "北京" };
  const b = { company: "X", title: "前端", location: "北京" };
  assert.ok(sameJob(a, b));
});

test("dedupeJobLibrary 去重同岗位保留首次", () => {
  const lib = [
    { jobId: "abc", title: "前端", company: "X", updatedAt: "1" },
    { detailUrl: "https://www.zhipin.com/job_detail/abc.html", title: "前端", company: "X", updatedAt: "2" },
    { jobId: "xyz", title: "后端", company: "Y" }
  ];
  const unique = dedupeJobLibrary(lib);
  assert.equal(unique.length, 2);
  assert.equal(unique[0].jobId, "abc");
});

test("dedupeJobLibrary 非数组返回空", () => {
  assert.deepEqual(dedupeJobLibrary(null), []);
  assert.deepEqual(dedupeJobLibrary("x"), []);
});

// ——— sanitizeJobForLibrary ———

test("sanitizeJobForLibrary 剔除临时字段", () => {
  const cleaned = sanitizeJobForLibrary({
    title: "前端", company: "X", progress: "投递中", error: "x",
    rawAiResponse: "...", queuedAt: "2024", status: "已沟通", greeting: "hi"
  });
  assert.deepEqual(cleaned, { title: "前端", company: "X", greeting: "hi" });
});

test("sanitizeJobForLibrary 处理空值", () => {
  assert.deepEqual(sanitizeJobForLibrary(null), {});
});

// ——— escapeCsv ———

test("escapeCsv 引号转义", () => {
  assert.equal(escapeCsv('含"引号"的'), '"含""引号""的"');
  assert.equal(escapeCsv("普通"), '"普通"');
  assert.equal(escapeCsv(null), '""');
});

// ——— 常量 ———

test("DEFAULTS 有必要字段", () => {
  assert.ok(DEFAULTS.endpoint.startsWith("https://"));
  assert.equal(DEFAULTS.apiKey, "");
});
