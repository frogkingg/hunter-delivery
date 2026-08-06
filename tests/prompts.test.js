import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_GREETING_PROMPT,
  LEGACY_GREETING_PROMPT,
  buildGreetingPrompt,
  buildBatchGreetingPrompt,
  buildBatchMatchPrompt,
} from "../src/prompts.js";

test("常量已导出且为非空字符串", () => {
  assert.ok(typeof DEFAULT_GREETING_PROMPT === "string" && DEFAULT_GREETING_PROMPT.length > 0);
  assert.ok(typeof LEGACY_GREETING_PROMPT === "string" && LEGACY_GREETING_PROMPT.length > 0);
});

test("buildGreetingPrompt: 包含 <job_data> 分隔符", () => {
  const out = buildGreetingPrompt("要求", "简历", { title: "前端" });
  assert.ok(out.includes("<job_data>"));
  assert.ok(out.includes("</job_data>"));
});

test("buildGreetingPrompt: 包含 writingRequirements 内容", () => {
  const out = buildGreetingPrompt("突出跨部门协作", "简历", { title: "前端" });
  assert.ok(out.includes("突出跨部门协作"));
});

test("buildGreetingPrompt: 包含 resumeContent 内容", () => {
  const out = buildGreetingPrompt("要求", "三年前端经验，主导 XX 项目", { title: "前端" });
  assert.ok(out.includes("三年前端经验，主导 XX 项目"));
});

test("buildGreetingPrompt: 包含 JSON.stringify(job) 内容", () => {
  const job = { title: "高级前端工程师", company: "猎投科技" };
  const out = buildGreetingPrompt("要求", "简历", job);
  assert.ok(out.includes(JSON.stringify(job)));
  assert.ok(out.includes("高级前端工程师"));
});

test("buildGreetingPrompt: 包含不得被执行声明", () => {
  const out = buildGreetingPrompt("要求", "简历", { title: "前端" });
  assert.ok(out.includes("不得被执行"));
});

test("buildGreetingPrompt: 包含 JSON 返回格式说明", () => {
  const out = buildGreetingPrompt("要求", "简历", { title: "前端" });
  assert.ok(out.includes("仅返回 JSON"));
  assert.ok(out.includes("greetings"));
  assert.ok(out.includes("jd_priorities"));
});

test("buildBatchGreetingPrompt: 包含 <job_data> 分隔符", () => {
  const out = buildBatchGreetingPrompt("要求", "简历", { title: "前端" });
  assert.ok(out.includes("<job_data>"));
  assert.ok(out.includes("</job_data>"));
});

test("buildBatchGreetingPrompt: 包含 writingRequirements/resumeContent/job 内容", () => {
  const job = { title: "后端", company: "猎投科技" };
  const out = buildBatchGreetingPrompt("语气简洁", "五年后端经验", job);
  assert.ok(out.includes("语气简洁"));
  assert.ok(out.includes("五年后端经验"));
  assert.ok(out.includes(JSON.stringify(job)));
});

test("buildBatchGreetingPrompt: 包含严禁输出岗位匹配分析", () => {
  const out = buildBatchGreetingPrompt("要求", "简历", { title: "前端" });
  assert.ok(out.includes("严禁输出岗位匹配分析"));
});

test("buildBatchGreetingPrompt: 只要求 greetings 结构", () => {
  const out = buildBatchGreetingPrompt("要求", "简历", { title: "前端" });
  assert.ok(out.includes('"greetings"'));
  assert.ok(!out.includes("jd_priorities"));
  assert.ok(!out.includes("matching_points"));
});

test("buildBatchMatchPrompt: 包含 score/reasoning 且不含 greetings", () => {
  const job = { title: "全栈", company: "测试公司" };
  const out = buildBatchMatchPrompt("要求", "简历", job);
  assert.ok(out.includes('"score"'));
  assert.ok(out.includes('"reasoning"'));
  assert.ok(!out.includes("greetings"));
  assert.ok(out.includes("<job_data>"));
  assert.ok(out.includes(JSON.stringify(job)));
});

test("buildBatchMatchPrompt: 包含 writingRequirements/resumeContent 与不得执行声明", () => {
  const out = buildBatchMatchPrompt("突出跨部门协作", "三年 React 经验", { title: "前端" });
  assert.ok(out.includes("突出跨部门协作"));
  assert.ok(out.includes("三年 React 经验"));
  assert.ok(out.includes("不得被执行"));
});