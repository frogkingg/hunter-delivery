import { test } from "node:test";
import assert from "node:assert/strict";
import { structureSignature, readCache, writeCache, AI_CACHE_MAX } from "../src/ai-cache.js";

const fields = [
  { id: "input-1", label: "姓名", type: "text", slot: "single", options: [], context: { sectionKey: "basic" } },
  { id: "input-2", label: "手机号", type: "tel", slot: "single", options: [], context: { sectionKey: "basic" } },
];

test("structureSignature：字段顺序无关、内容变化则签名变化", () => {
  const a = structureSignature(fields);
  const b = structureSignature([...fields].reverse());
  const c = structureSignature(fields.map(f => f.label === "姓名" ? { ...f, label: "名字" } : f));
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("缓存：命中需签名+引擎版本+模型一致，TTL 过期即失效", () => {
  const store = {};
  writeCache(store, { signature: "sig1", engineVersion: 3, model: "deepseek-chat", entries: [{ fieldId: "input-1", fieldKey: "name", confidence: "high" }] });
  assert.ok(readCache(store, "sig1", 3, "deepseek-chat"));
  assert.equal(readCache(store, "sig1", 4, "deepseek-chat"), null, "引擎升级失效");
  assert.equal(readCache(store, "sig1", 3, "gpt-4o"), null, "换模型失效");
});

test("缓存容量：超过 AI_CACHE_MAX 淘汰最旧", () => {
  const store = {};
  for (let i = 0; i < AI_CACHE_MAX + 10; i++) {
    writeCache(store, { signature: `sig-${i}`, engineVersion: 3, model: "m", entries: [] }, new Date(1000 + i).toISOString());
  }
  assert.equal(Object.keys(store).length, AI_CACHE_MAX);
  assert.equal(readCache(store, "sig-0", 3, "m"), null, "最旧被淘汰");
});
