// 工程化防漂移：npm run check 的 node --check 清单必须覆盖 src/ 下全部 JS，
// 新增模块若漏进门禁会在 CI/本地 check 时被本测试拦截。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const srcFiles = readdirSync(join(root, "src")).filter(name => name.endsWith(".js"));

test("npm run check 覆盖 src/ 下全部 JS 文件", () => {
  const check = pkg.scripts?.check || "";
  const missing = srcFiles.filter(file => !check.includes(`src/${file}`));
  assert.deepEqual(missing, [], `以下 src 文件未纳入 npm run check：${missing.join(", ")}`);
});

test("package.json 声明 Node engines（node --test glob 需要 Node >=21）", () => {
  assert.ok(pkg.engines?.node, "package.json 应声明 engines.node");
  assert.match(pkg.engines.node, />=21|>=22|\^2[12]/, `engines.node 应要求 Node >=21，当前：${pkg.engines.node}`);
});