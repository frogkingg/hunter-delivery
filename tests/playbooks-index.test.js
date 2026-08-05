// playbooks 索引加载测试：面板侧 PLAYBOOKS 列表可加载、moka 校验通过且可被 findPlaybook 命中。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PLAYBOOKS } from "../src/playbooks-index.js";
import { validatePlaybook, findPlaybook } from "../src/playbook-loader.js";

const playbooksDir = join(dirname(fileURLToPath(import.meta.url)), "../src/playbooks");

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

test("playbooks-index：PLAYBOOKS 与 src/playbooks/*.json 无漂移（防双源漏同步）", () => {
  const files = readdirSync(playbooksDir).filter(name => name.endsWith(".json"));
  assert.ok(files.length >= 1, "src/playbooks 下应存在 JSON 文件");
  const onDiskByHost = new Map();
  for (const name of files) {
    const onDisk = JSON.parse(readFileSync(join(playbooksDir, name), "utf8"));
    onDiskByHost.set(onDisk.host, { name, onDisk });
  }
  // 磁盘 JSON 侧：每个站点都应在 PLAYBOOKS 中且深度相等
  for (const [host, { name, onDisk }] of onDiskByHost) {
    const indexed = PLAYBOOKS.find(pb => pb.host === host);
    assert.ok(indexed, `PLAYBOOKS 应包含磁盘来源 ${host}（${name}）`);
    assert.deepEqual(indexed, onDisk, `${name} 与 PLAYBOOKS 内联数据应完全一致（防漂移）`);
  }
  // PLAYBOOKS 侧：不应存在无磁盘 JSON 源的孤儿站点
  for (const pb of PLAYBOOKS) {
    assert.ok(onDiskByHost.has(pb.host), `PLAYBOOKS 中的 ${pb.host} 应存在对应 JSON 源文件`);
  }
});
