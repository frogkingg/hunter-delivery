# 智能填充 Wave 4：playbook 社区化 + 结构签名缓存 + 脱敏诊断闭环 实现计划（2026-08-05）

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 三个工程化增量：(1) 配置化 playbook——随扩展发布的高频系统字段映射/控件适配清单（复用 Template V2 schema）+ 校验脚本 + Issue 模板；(2) AI 映射缓存——按「页面结构签名」缓存 AI 的 fieldKey 建议，签名/引擎版本/模型/TTL 任一变化即失效；(3) 脱敏诊断闭环——扫描/填充会话可导出脱敏诊断包。

**架构：** 全部为新增纯函数 ESM 模块（`src/ai-cache.js`、`src/diagnostics.js`、`src/playbook-loader.js`、`src/playbooks/*.json`、`scripts/validate-playbooks.mjs`、`.github/ISSUE_TEMPLATE/site-adaptation.md`），Node 可直接单测；`src/fill-ui.js` 仅做接入（buildMatches 查/写缓存、applyTemplate 前应用 playbook、面板导出按钮）。不改 `fill-content.js` 执行引擎。

**技术栈：** Chrome MV3、ESM、node:test、Rollup、Node CLI 脚本。

**规格：** 依据 2026-08-05 调研结论（jobApplier：50+ ATS selector playbook + refresh 脚本 + 社区共建；1lck：映射缓存按页面结构签名、诊断日志脱敏导出上限 50；OpenJobAutofill：Issue 反馈模板）。

**Git：** 分支 `codex/smart-fill-hardening`。每个任务一个 commit，中文 Conventional Commits。

---

## 文件结构与职责

| 文件 | 职责 | 本计划动作 |
|---|---|---|
| `src/ai-cache.js` | AI 映射缓存（纯函数） | 创建：`structureSignature`、`readCache`、`writeCache`、LRU/TTL |
| `src/diagnostics.js` | 诊断包构建与脱敏（纯函数） | 创建：`buildDiagnostics`、`redact`、上限 |
| `src/playbook-loader.js` | playbook 加载/匹配/校验（纯函数） | 创建：`loadPlaybooks`、`findPlaybook`、`validatePlaybook` |
| `src/playbooks/moka.json` | 示例 playbook | 创建（Moka 站最小可用映射） |
| `scripts/validate-playbooks.mjs` | playbook 校验 CLI | 创建：遍历校验 + CI 入口 |
| `.github/ISSUE_TEMPLATE/site-adaptation.md` | 站点适配 Issue 模板 | 创建 |
| `src/fill-ui.js` | 面板编排 | 修改：接入 ai-cache、playbook、诊断导出按钮 |
| `tests/ai-cache.test.js` | 缓存单测 | 创建 |
| `tests/diagnostics.test.js` | 诊断单测 | 创建 |
| `tests/playbook-loader.test.js` | playbook 单测 | 创建 |

不修改：`fill-content.js`、`src/matcher.js`、`src/site-templates.js`、`src/form-fields.js`、`src/messages.js`。

---

## 任务 1：AI 映射缓存（结构签名）

**目标：** AI 的字段映射建议按结构签名缓存，减少重复调用；字段变化/引擎升级/换模型即失效。

**文件：** `src/ai-cache.js`（创建）、`tests/ai-cache.test.js`（创建）

- [ ] **步骤 1：红灯测试**

创建 `tests/ai-cache.test.js`：

```js
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
```

运行：`node --test tests/ai-cache.test.js`
预期：FAIL——模块不存在（`ERR_MODULE_NOT_FOUND`）。

- [ ] **步骤 2：实现 `src/ai-cache.js`**

```js
// AI 映射缓存：按页面结构签名缓存 AI 的 fieldKey 建议。
// 纯函数模块，Node 可测。签名 = 字段证据规范化后的有序哈希。

export const AI_CACHE_MAX = 100;
export const AI_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

function stableHash(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function structureSignature(fields, options = {}) {
  const parts = (Array.isArray(fields) ? fields : [])
    .filter(f => f?.status !== "skipped")
    .map(f => `${f.label}|${f.type}|${f.slot || "single"}|${(f.options || []).join("/")}|${f.context?.sectionKey || ""}`)
    .sort();
  return stableHash(JSON.stringify(parts) + (options.extra || ""));
}

function entryKey(signature, engineVersion, model) {
  return `${signature}::v${engineVersion}::${model || "default"}`;
}

export function readCache(store, signature, engineVersion, model, now = Date.now()) {
  const key = entryKey(signature, engineVersion, model);
  const entry = store?.[key];
  if (!entry) return null;
  if (now - new Date(entry.createdAt).getTime() > AI_CACHE_TTL_MS) return null;
  return entry.entries;
}

export function writeCache(store, input, createdAt = new Date().toISOString()) {
  const key = entryKey(input.signature, input.engineVersion, input.model || "default");
  const next = { ...(store || {}) };
  next[key] = { createdAt, entries: input.entries || [] };
  const keys = Object.keys(next).sort((a, b) => (next[a].createdAt < next[b].createdAt ? -1 : 1));
  while (keys.length > AI_CACHE_MAX) {
    delete next[keys.shift()];
  }
  return next;
}
```

- [ ] **步骤 3：运行测试验证通过**

运行：`node --test tests/ai-cache.test.js && npm run check && npm test`
预期：全部 PASS。

- [ ] **步骤 4：Commit**

```bash
git add src/ai-cache.js tests/ai-cache.test.js
git commit -m "feat(智能填充): AI 映射缓存按结构签名（Wave 4 任务 1）"
```

---

## 任务 2：脱敏诊断包

**目标：** 扫描/填充会话可构建脱敏诊断包，供 Issue 反馈与排障。

**文件：** `src/diagnostics.js`（创建）、`tests/diagnostics.test.js`（创建）

- [ ] **步骤 1：红灯测试**

创建 `tests/diagnostics.test.js`：

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDiagnostics, redactText, DIAG_MAX_ENTRIES } from "../src/diagnostics.js";

test("redactText：手机号/身份证/邮箱打码，URL 去 query/hash", () => {
  const out = redactText("联系人 13800138000，身份证 110101199806010011，邮箱 a@b.com，来自 https://x.com/a?token=1#frag");
  assert.ok(!out.includes("13800138000"));
  assert.ok(!out.includes("110101199806010011"));
  assert.ok(!out.includes("a@b.com"));
  assert.ok(!out.includes("token=1"));
  assert.ok(out.includes("https://x.com/a"));
});

test("buildDiagnostics：结构完整且不泄露简历值", () => {
  const diag = buildDiagnostics({
    engineVersion: 3, scanId: "s1", url: "https://apply.example.com/form?x=1",
    fields: [{ id: "i1", label: "姓名", type: "text" }],
    matchedBy: { rule: 1, template: 0, playbook: 0, ai: 0 },
    failures: [{ fieldId: "i2", siteLabel: "手机号", type: "tel", reason: "回读校验失败" }],
    ai: { requested: true, model: "deepseek-chat", fieldsSent: ["i2"] },
    timings: { scanMs: 85, matchMs: 12, applyMs: 460 },
    resume: { name: "张三", phone: "13800138000" },
  });
  assert.equal(diag.engineVersion, 3);
  assert.ok(!JSON.stringify(diag).includes("13800138000"), "诊断包不得包含简历具体值");
  assert.ok(!JSON.stringify(diag).includes("token=1"));
  assert.ok(diag.ai.fieldsSent.length === 1);
});

test("上限：entries 超 DIAG_MAX_ENTRIES 截断", () => {
  const fields = Array.from({ length: DIAG_MAX_ENTRIES + 5 }, (_, i) => ({ id: `i${i}`, label: `字段${i}`, type: "text" }));
  const diag = buildDiagnostics({ fields });
  assert.ok(diag.fields.length <= DIAG_MAX_ENTRIES);
});
```

运行：`node --test tests/diagnostics.test.js`
预期：FAIL——模块不存在。

- [ ] **步骤 2：实现 `src/diagnostics.js`**

```js
// 扫描/填充会话诊断包构建与脱敏。纯函数模块，Node 可测。

export const DIAG_MAX_ENTRIES = 100;

const PHONE = /\d{7,}/g;
const ID_CARD = /\d{17}[\dXx]/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function redactText(text) {
  let out = String(text ?? "");
  out = out.replace(ID_CARD, "***").replace(PHONE, "***").replace(EMAIL, "***");
  try {
    const url = new URL(out);
    url.search = "";
    url.hash = "";
    out = url.toString();
  } catch (_) { /* 非 URL 原样返回 */ }
  return out;
}

export function buildDiagnostics(input = {}) {
  const fields = (input.fields || []).slice(0, DIAG_MAX_ENTRIES).map(f => ({
    id: f.id, label: redactText(f.label), type: f.type,
  }));
  const failures = (input.failures || []).slice(0, DIAG_MAX_ENTRIES).map(f => ({
    fieldId: f.fieldId, siteLabel: redactText(f.siteLabel), type: f.type, reason: redactText(f.reason),
  }));
  return {
    engineVersion: input.engineVersion,
    scanId: input.scanId,
    url: redactText(input.url),
    fields,
    matchedBy: input.matchedBy || {},
    failures,
    ai: input.ai ? { requested: !!input.ai.requested, model: input.ai.model || "", fieldsSent: (input.ai.fieldsSent || []).slice(0, DIAG_MAX_ENTRIES) } : null,
    timings: input.timings || {},
    durationMs: input.durationMs || 0,
  };
}
```

- [ ] **步骤 3：运行测试验证通过**

运行：`node --test tests/diagnostics.test.js && npm run check && npm test`
预期：全部 PASS。

- [ ] **步骤 4：Commit**

```bash
git add src/diagnostics.js tests/diagnostics.test.js
git commit -m "feat(智能填充): 脱敏诊断包构建（Wave 4 任务 2）"
```

---

## 任务 3：playbook 加载器 + 校验脚本 + 示例

**目标：** playbook 可加载/匹配/校验；CI 可校验全部 playbook；Issue 模板就位。

**文件：** `src/playbook-loader.js`（创建）、`src/playbooks/moka.json`（创建）、`scripts/validate-playbooks.mjs`（创建）、`.github/ISSUE_TEMPLATE/site-adaptation.md`（创建）、`tests/playbook-loader.test.js`（创建）

- [ ] **步骤 1：红灯测试**

创建 `tests/playbook-loader.test.js`：

```js
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
```

运行：`node --test tests/playbook-loader.test.js`
预期：FAIL——模块不存在。

- [ ] **步骤 2：实现 `src/playbook-loader.js` + 示例 + 校验脚本**

`src/playbook-loader.js`：

```js
// playbook 加载/匹配/校验。纯函数模块，Node 可测。
// playbook 复用 Template V2 语义映射 schema，随扩展发布（只读）。

const FIELD_KEYS = new Set([
  "name", "phone", "email", "gender", "birthDate", "school", "degree", "major",
  "graduationYear", "currentCity", "expectedCity", "expectedSalary", "expectedPosition",
  "workYears", "currentCompany", "currentTitle", "selfEvaluation", "idCard",
]);

export function validatePlaybook(pb) {
  if (!pb || pb.schemaVersion !== 2) return { ok: false, error: "schemaVersion 必须为 2" };
  if (!pb.host) return { ok: false, error: "缺少 host" };
  if (!Array.isArray(pb.mappings)) return { ok: false, error: "缺少 mappings" };
  for (const m of pb.mappings) {
    if (!FIELD_KEYS.has(m.fieldKey)) return { ok: false, error: `未知 fieldKey: ${m.fieldKey}` };
    if (!m.siteLabel || !m.controlType) return { ok: false, error: `mapping 缺少 siteLabel/controlType: ${m.fieldKey}` };
  }
  return { ok: true };
}

export function parseRoutePattern(pattern) {
  const escaped = String(pattern || "/**").replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*");
  return new RegExp(`^${escaped}$`);
}

export function findPlaybook(playbooks, url) {
  let host = "";
  try { host = new URL(url).hostname; } catch (_) { host = String(url || "").split("/")[0]; }
  const path = (() => { try { return new URL(url).pathname; } catch (_) { return ""; } })();
  for (const pb of playbooks || []) {
    if (pb.host !== host) continue;
    if (pb.scope?.routePattern && !parseRoutePattern(pb.scope.routePattern).test(path)) continue;
    return pb;
  }
  return null;
}
```

`src/playbooks/moka.json`：按 Wave 2 任务 1 的映射结构写一份最小可用 playbook（host `app.mokahr.com`，mappings 含姓名/手机号/毕业院校/毕业时间，`denyList`/`requireManual`，`version: "2026-08-05"`）。

`scripts/validate-playbooks.mjs`：

```js
// 校验 src/playbooks/*.json：node scripts/validate-playbooks.mjs
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validatePlaybook } from "../src/playbook-loader.js";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../src/playbooks");
let failed = 0;
for (const name of readdirSync(dir).filter(n => n.endsWith(".json"))) {
  const pb = JSON.parse(readFileSync(join(dir, name), "utf8"));
  const result = validatePlaybook(pb);
  console.log(`${name}: ${result.ok ? "OK" : `FAIL ${result.error}`}`);
  if (!result.ok) failed++;
}
process.exit(failed ? 1 : 0);
```

`.github/ISSUE_TEMPLATE/site-adaptation.md`：按调研结论写模板（站点名称/URL/页面类型、问题类型勾选、失败字段列表、截图、诊断包、扩展版本）。

- [ ] **步骤 3：运行测试验证通过**

运行：`node --test tests/playbook-loader.test.js && node scripts/validate-playbooks.mjs && npm run check && npm test`
预期：全部 PASS；校验脚本输出 `moka.json: OK`。

- [ ] **步骤 4：Commit**

```bash
git add src/playbook-loader.js src/playbooks/moka.json scripts/validate-playbooks.mjs .github/ISSUE_TEMPLATE/site-adaptation.md tests/playbook-loader.test.js
git commit -m "feat(智能填充): playbook 加载器/校验脚本/示例与 Issue 模板（Wave 4 任务 3）"
```

---

## 任务 4：面板接入（缓存 + playbook + 诊断导出）

**目标：** `buildMatches` 先查 AI 缓存、未命中调 AI 后写缓存；`applyTemplate` 前应用 playbook；面板新增「导出诊断包」按钮。

**文件：** `src/fill-ui.js`（修改）、`test/panel-smoke.test.js`（修改）、`package.json`（修改：`check` 增加新模块语法检查）

- [ ] **步骤 1：红灯测试**

`test/panel-smoke.test.js` 追加：面板存在「导出诊断包」按钮；点击后触发下载（mock `URL.createObjectURL`/`chrome.downloads` 或 window.alert 提示已导出）。预期 FAIL（按钮不存在）。另在 `tests/` 侧断言 `buildMatches` 命中缓存时不再调用 `ai`（用注入 fake aiCall 的 `matchFields` 验证——在 `tests/matcher.test.js` 或新 `tests/ai-cache-integration.test.js` 中：第一次调用 aiCall 1 次，第二次相同结构签名命中缓存 0 次）。

- [ ] **步骤 2：实现接入**

1. `src/fill-ui.js`：
   - `buildMatches` 的 AI 分支改为：`const signature = structureSignature(state.fillScanFields, { extra: formFingerprint })` → `const cached = readCache(aiCacheStore, signature, ENGINE_VERSION, config.model)` → 命中用 `applyAiResults(matches, cached, ...)`；未命中调 `ai(...)` 成功后 `writeCache`（`aiCacheStore` 用模块级变量 + `chrome.storage.local` 持久化可选）。
   - `buildMatches` 在 `applyTemplate` 前插入 `findPlaybook`：命中且 `validatePlaybook` OK 时，把 playbook.mappings 按 `applyTemplate` 同构逻辑应用（构造临时 Template V2 对象调用 `applyTemplate`，`source: "playbook"`）。
   - 新增「导出诊断包」按钮：收集 `state.fillScanSession` + `state.fillMatches` + `state.fillAiEnabled` 等 → `buildDiagnostics(...)` → 生成 Blob 下载 `hunter-fill-diagnostics-<scanId>.json`。
2. `package.json` 的 `check` 脚本追加 `node --check src/ai-cache.js && node --check src/diagnostics.js && node --check src/playbook-loader.js`。

- [ ] **步骤 3：运行测试验证通过**

运行：`node --test test/panel-smoke.test.js tests/ai-cache.test.js tests/diagnostics.test.js tests/playbook-loader.test.js && npm run check && npm test && npm run build`
预期：全部 PASS；`dist/panel.js` 含缓存/playbook/诊断逻辑。

- [ ] **步骤 4：Commit**

```bash
git add src/fill-ui.js package.json test/panel-smoke.test.js tests/ai-cache-integration.test.js
git commit -m "feat(智能填充): 接入 AI 缓存/playbook/诊断导出（Wave 4 任务 4）"
```

---

## Wave 4 验收

- [ ] `node scripts/validate-playbooks.mjs` 通过；`npm run check && npm test && npm run build` 全绿，现有测试零回归
- [ ] 同一结构页面第二次匹配不再重复调 AI（缓存命中）；改字段/换模型/升引擎后重新调用
- [ ] playbook 命中站点（`app.mokahr.com/campus_apply/**`）优先于规则、与模板并存（模板 userConfirmed 覆盖 playbook）
- [ ] 导出诊断包不含简历具体值、URL 去 query/hash；Issue 模板字段齐全
- [ ] 安全不变量保持：playbook/缓存结果仍过 `validateBinding`；缓存不落具体值（只存 fieldKey 建议）
