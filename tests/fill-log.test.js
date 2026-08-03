import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFillLog, summarizeResults, LOG_MAX } from "../src/fill-log.js";

test("appendFillLog: 新条目在前", () => {
  const logs = appendFillLog([], { host: "a.com", total: 1 });
  assert.equal(logs[0].host, "a.com");
  assert.ok(logs[0].time);
  assert.ok(logs[0].durationMs >= 0);
});

test("appendFillLog: 超过上限截断", () => {
  const logs = [];
  for (let i = 0; i < LOG_MAX + 10; i++) logs.push({ host: `h${i}` });
  const trimmed = appendFillLog(logs, { host: "new" });
  assert.equal(trimmed.length, LOG_MAX);
  assert.equal(trimmed[0].host, "new");
});

test("appendFillLog: 非法输入容错", () => {
  assert.deepEqual(appendFillLog(null, { host: "a" }).length, 1);
  assert.deepEqual(appendFillLog([], null).length, 0);
});

test("summarizeResults: 统计成功失败", () => {
  const results = [{ ok: true }, { ok: true }, { ok: false, error: "x" }];
  assert.deepEqual(summarizeResults(results), { total: 3, ok: 2, failed: 1 });
  assert.deepEqual(summarizeResults(null), { total: 0, ok: 0, failed: 0 });
});
