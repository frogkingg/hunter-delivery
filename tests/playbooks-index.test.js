// playbooks 索引加载测试：面板侧 PLAYBOOKS 列表可加载、moka 校验通过且可被 findPlaybook 命中。
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAYBOOKS } from "../src/playbooks-index.js";
import { validatePlaybook, findPlaybook } from "../src/playbook-loader.js";

test("playbooks-index：PLAYBOOKS 数组可加载且包含 moka", () => {
  assert.ok(Array.isArray(PLAYBOOKS), "PLAYBOOKS 应为数组");
  assert.ok(PLAYBOOKS.length >= 1, "PLAYBOOKS 应至少包含一个站点 playbook");
  const moka = PLAYBOOKS.find(pb => pb.host === "app.mokahr.com");
  assert.ok(moka, "PLAYBOOKS 应包含 moka");
});

test("playbooks-index：moka 通过 validatePlaybook 校验且映射与 Template V2 字段对齐", () => {
  const moka = PLAYBOOKS.find(pb => pb.host === "app.mokahr.com");
  assert.equal(validatePlaybook(moka).ok, true, "moka 应通过 validatePlaybook");
  assert.ok(Array.isArray(moka.mappings) && moka.mappings.length >= 4, "moka 至少含 4 条映射");
  const fieldKeys = new Set(moka.mappings.map(m => m.fieldKey));
  assert.ok(fieldKeys.has("name") && fieldKeys.has("phone"), "moka 映射应覆盖姓名/手机号");
});

test("playbooks-index：findPlaybook 能按 host + 路由命中 moka", () => {
  const hit = findPlaybook(PLAYBOOKS, "https://app.mokahr.com/campus_apply/123");
  assert.ok(hit && hit.host === "app.mokahr.com", "应命中 moka");
  assert.equal(findPlaybook(PLAYBOOKS, "https://other.example.com/x"), null, "非 moka 站点不应命中");
});
