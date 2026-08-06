import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeMatch, isDuplicateJob, buildBatchSummary, buildBatchDiagnostic } from "../src/batch-match.js";

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

test("buildBatchDiagnostic: 汇总参数/结果/失败明细，且不含敏感内容", () => {
  const diag = buildBatchDiagnostic({
    params: { targetCount: 10, threshold: 75, autoSend: false, effectiveTarget: 10, listJobCount: 10 },
    result: { scanned: 10, added: 3, lowScore: 5, duplicate: 0, failed: 2, stopped: false },
    failures: [
      { title: "前端工程师", company: "甲公司", step: "AI 匹配", reason: "AI 服务连接超时（60 秒）" },
      { title: "后端工程师", company: "乙公司", step: "读取岗位详情", reason: "等待岗位详情加载超时" },
    ],
    config: { model: "gpt-4o", endpoint: "https://api.example.com", disableThinking: false, profileName: "标准简历", resumeLength: 800, greetingPromptLength: 100, queueCount: 3, libraryCount: 12 },
  });
  assert.equal(diag.type, "batch-match-diagnostic");
  assert.equal(diag.result.failed, 2);
  assert.equal(diag.failures.length, 2);
  assert.equal(diag.failures[0].step, "AI 匹配");
  assert.match(JSON.stringify(diag), /连接超时/);
  const json = JSON.stringify(diag);
  assert.ok(!json.includes("sk-"), "不应包含 API Key");
  assert.ok(!json.includes("apiKey"), "不应包含 apiKey 字段");
  assert.ok(!json.includes("resumeContent"), "不应包含简历原文");
  assert.ok(!json.includes("job_data"), "不应包含 JD");
});

test("buildBatchDiagnostic: failures 为空时正常输出空数组", () => {
  const diag = buildBatchDiagnostic({ params: { targetCount: 10 }, result: { failed: 0 }, failures: [], config: {} });
  assert.deepEqual(diag.failures, []);
});

test("buildBatchSummary: 无沟通入口跳过计数", () => {
  const out = buildBatchSummary({ scanned: 10, added: 2, lowScore: 4, duplicate: 1, noCommunication: 2, failed: 1 });
  assert.match(out, /无沟通入口跳过 2/);
  assert.match(out, /共扫描 10 个岗位/);
});

test("buildBatchSummary: 无无沟通入口时保持原格式", () => {
  const out = buildBatchSummary({ scanned: 10, added: 3, lowScore: 5, duplicate: 1, failed: 1 });
  assert.ok(!out.includes("无沟通入口"));
  assert.match(out, /共扫描 10 个岗位：匹配 3、低分跳过 5、去重跳过 1、失败 1/);
});

test("sanitizeMatch: 布尔/null/空串/字符串数字视为非法分数", () => {
  assert.throws(() => sanitizeMatch({ score: true }), /未返回有效匹配分/);
  assert.throws(() => sanitizeMatch({ score: null }), /未返回有效匹配分/);
  assert.throws(() => sanitizeMatch({ score: "" }), /未返回有效匹配分/);
  assert.throws(() => sanitizeMatch({ score: "85" }), /未返回有效匹配分/);
  assert.throws(() => sanitizeMatch({ score: Infinity }), /未返回有效匹配分/);
  assert.equal(sanitizeMatch({ score: 85 }).score, 85);
});

test("isDuplicateJob: 有 jobId 时不同岗位不因 title+company 相同误判", () => {
  const job = { jobId: "job-1", title: "前端", company: "A 公司", location: "北京" };
  assert.equal(isDuplicateJob(job, { deliveryQueue: [{ jobId: "job-2", title: "前端", company: "A 公司", location: "北京" }] }), false);
});