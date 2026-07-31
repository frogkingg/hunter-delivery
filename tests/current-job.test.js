import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveJobPromptOverride } from "../src/current-job.js";

test("同一岗位保留新的本次写作要求", () => {
  const job = { jobId: "job-1" };
  assert.equal(resolveJobPromptOverride(job, job, "  突出项目管理  "), "突出项目管理");
});

test("同一岗位允许清空本次写作要求", () => {
  const job = { detailUrl: "https://www.zhipin.com/job_detail/job-1.html" };
  assert.equal(resolveJobPromptOverride(job, job, ""), "");
});

test("切换岗位时重置旧岗位写作要求", () => {
  const previous = { jobId: "job-1" };
  const next = { jobId: "job-2" };
  assert.equal(resolveJobPromptOverride(previous, next, "旧岗位要求"), "");
});
