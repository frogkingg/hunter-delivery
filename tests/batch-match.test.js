import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeMatch, isDuplicateJob, buildBatchSummary } from "../src/batch-match.js";

test("sanitizeMatch: 正常返回取整后的 score 与 reasoning", () => {
  const out = sanitizeMatch({ score: 85.6, reasoning: "匹配度高" });
  assert.equal(out.score, 86);
  assert.equal(out.reasoning, "匹配度高");
});

test("sanitizeMatch: score 越界时 clamp 到 0-100", () => {
  assert.equal(sanitizeMatch({ score: 150 }).score, 100);
  assert.equal(sanitizeMatch({ score: -5 }).score, 0);
});

test("sanitizeMatch: reasoning 缺省为「未返回分析结论」", () => {
  assert.equal(sanitizeMatch({ score: 80 }).reasoning, "未返回分析结论");
  assert.equal(sanitizeMatch({ score: 80, reasoning: "   " }).reasoning, "未返回分析结论");
});

test("sanitizeMatch: score 非数字时抛错", () => {
  assert.throws(() => sanitizeMatch({ score: "高" }), /未返回有效匹配分/);
  assert.throws(() => sanitizeMatch({}), /未返回有效匹配分/);
});

test("isDuplicateJob: 按 jobId 命中队列/历史/岗位库", () => {
  const job = { jobId: "job-1", title: "前端", company: "A 公司" };
  assert.equal(isDuplicateJob(job, { deliveryQueue: [{ jobId: "job-1" }] }), true);
  assert.equal(isDuplicateJob(job, { recentDeliveries: [{ jobId: "job-1" }] }), true);
  assert.equal(isDuplicateJob(job, { jobLibrary: [{ jobId: "job-1" }] }), true);
  assert.equal(isDuplicateJob(job, { deliveryQueue: [{ jobId: "job-2" }] }), false);
});

test("isDuplicateJob: 无 jobId 时按 title+company 兜底", () => {
  const job = { title: "后端", company: "B 公司" };
  assert.equal(isDuplicateJob(job, { deliveryQueue: [{ title: "后端", company: "B 公司" }] }), true);
  assert.equal(isDuplicateJob(job, { deliveryQueue: [{ title: "后端", company: "C 公司" }] }), false);
});

test("isDuplicateJob: detailUrl 归一化去 query 与尾斜杠", () => {
  const job = { detailUrl: "https://www.zhipin.com/job_detail/job-9.html?securityId=x" };
  assert.equal(isDuplicateJob(job, { deliveryQueue: [{ detailUrl: "https://www.zhipin.com/job_detail/job-9.html" }] }), true);
});

test("buildBatchSummary: 汇总计数文案", () => {
  const out = buildBatchSummary({ scanned: 10, added: 3, lowScore: 5, duplicate: 1, failed: 1 });
  assert.match(out, /共扫描 10 个岗位/);
  assert.match(out, /匹配 3/);
  assert.match(out, /低分跳过 5/);
  assert.match(out, /去重跳过 1/);
  assert.match(out, /失败 1/);
});