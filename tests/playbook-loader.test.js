import { test } from "node:test";
import assert from "node:assert/strict";
import { validatePlaybook, findPlaybook, parseRoutePattern } from "../src/playbook-loader.js";

const moka = {
  schemaVersion: 2, host: "app.mokahr.com",
  scope: { routePattern: "/campus_apply/**" },
  mappings: [
    { siteLabel: "姓名", controlType: "text", fieldKey: "name", valueRef: { source: "resume", path: "basic.name" } },
    { siteLabel: "手机号", controlType: "tel", fieldKey: "phone", valueRef: { source: "resume", path: "basic.phone" } },
  ],
  denyList: ["紧急联系人"], requireManual: ["idCard"],
};

test("validatePlaybook：合法通过，未知 fieldKey/缺 host 拒绝", () => {
  assert.equal(validatePlaybook(moka).ok, true);
  assert.equal(validatePlaybook({ ...moka, host: "" }).ok, false);
  assert.equal(validatePlaybook({ ...moka, mappings: [{ ...moka.mappings[0], fieldKey: "not-a-key" }] }).ok, false);
});

test("findPlaybook：按 host + 路由匹配；parseRoutePattern 通配", () => {
  const playbooks = [moka];
  assert.ok(findPlaybook(playbooks, "https://app.mokahr.com/campus_apply/123"));
  assert.equal(findPlaybook(playbooks, "https://other.example.com/x"), null);
  assert.ok(parseRoutePattern("/campus_apply/**").test("/campus_apply/123"));
});

test("parseRoutePattern：** 跨 / 匹配，单 * 不跨 /", () => {
  const multi = parseRoutePattern("/campus_apply/**");
  assert.equal(multi.source, "^\\/campus_apply\\/.*$", "** 应编译为 .* 以跨 / 匹配");
  assert.equal(multi.test("/campus_apply/123/step2"), true, "** 应匹配多段路径");
  assert.equal(multi.test("/campus_apply/123"), true, "** 也应匹配单段路径");
  assert.equal(parseRoutePattern("/**").test("/a/b/c"), true, "根 /** 应匹配任意深度");
  const single = parseRoutePattern("/campus_apply/*");
  assert.equal(single.test("/campus_apply/123/step2"), false, "单 * 不应跨 /");
  assert.equal(single.test("/campus_apply/123"), true, "单 * 应匹配单段");
});
