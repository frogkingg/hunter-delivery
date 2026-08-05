# 智能填充 Wave 2：联想下拉适配 + 敏感字段集合 + 选区填充 实现计划（2026-08-05）

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 三个独立增量：(1) 新增「输入型联想下拉」适配器——输入框聚焦后弹出候选（学校/公司/城市等），对候选项打分并选中匹配项；(2) 敏感字段集合——身份证/薪酬/紧急联系人等默认强制人工，规则/模板/AI 均不可绕过，除非用户显式确认；(3) 选区填充——用户框选页面某区域，只填充该区域内字段。

**架构：** 联想下拉在 `fill-content.js` 内新增 `applySuggestEntry`（复用 `collectCustomOptions`/`visiblePickerDropdown` 的候选收集思路，新增 `scoreSuggestion(text, value)` 打分与点击选中）；敏感字段集合在 `src/matcher.js` 增加 `SENSITIVE_FIELD_KEYS` 常量并在 `matchRules`/`validateBinding` 强制执行 manual；选区填充在 `fill-content.js` 的 `scan`/`apply` 增加 `region` 选项，`src/fill-ui.js` 加「选区填充」入口。

**技术栈：** Chrome MV3、自包含 classic 脚本、ESM 纯函数模块、node:test + jsdom、Rollup。

**规格：** 依据 2026-08-05 调研结论（formfill autocompleteFiller：检测候选弹层→打分→键盘/鼠标选中；jobApplier/1lck：敏感字段 AI 永不代写；1lck：选区填入模式）。

**Git：** 分支 `codex/smart-fill-hardening`。每个任务一个 commit，中文 Conventional Commits。

---

## 文件结构与职责

| 文件 | 职责 | 本计划动作 |
|---|---|---|
| `fill-content.js` | 执行引擎 | 修改：`scoreSuggestion`、`applySuggestEntry`、`fillOne` 接入联想分支、`scan`/`apply` 支持 `region` |
| `src/matcher.js` | 匹配引擎 | 修改：`SENSITIVE_FIELD_KEYS` + 强制 manual |
| `src/fill-ui.js` | 面板编排 | 修改：选区填充入口与提示 |
| `tests/matcher.test.js` | 匹配单测 | 修改：敏感字段用例 |
| `test/fixtures/suggest-dropdown.html` | 联想下拉夹具 | 创建 |
| `test/fixtures/region-form.html` | 选区填充夹具 | 创建 |
| `test/fill-content-integration.test.js` | 引擎集成测试 | 修改：联想/选区用例 |
| `test/panel-smoke.test.js` | 面板测试 | 修改：选区按钮用例 |

不修改：`src/form-fields.js`、`src/site-templates.js`、`src/fill-log.js`、`src/messages.js`（若需新消息在现有 `SMART_FILL_APPLY` payload 内加可选字段）、`panel.html`（若需新按钮改为 fill-ui 动态创建，避免动静态骨架）。

---

## 任务 1：联想下拉适配器（灯→绿）

**目标：** 输入型联想控件（非 custom-select，而是 text 输入后弹候选）可自动选中匹配项。

**文件：** `fill-content.js`（修改）、`test/fixtures/suggest-dropdown.html`（创建）、`test/fill-content-integration.test.js`（修改）

- [ ] **步骤 1：创建联想下拉夹具**

`test/fixtures/suggest-dropdown.html`：一个输入框 + 一个 `ul[role="listbox"]`（初始隐藏，输入聚焦后显示），候选含「复旦大学/上海交通大学/同济大学」；点击候选时把其文本写入输入框：

```html
<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>联想下拉夹具</title></head>
<body>
  <form id="app">
    <label for="school">毕业院校</label>
    <input id="school" name="school" type="text" autocomplete="off">
    <ul id="suggest" role="listbox" hidden>
      <li role="option" data-value="复旦大学">复旦大学</li>
      <li role="option" data-value="上海交通大学">上海交通大学</li>
      <li role="option" data-value="同济大学">同济大学</li>
    </ul>
  </form>
  <script>
    const input = document.getElementById("school");
    const list = document.getElementById("suggest");
    input.addEventListener("focus", function () { list.hidden = false; });
    input.addEventListener("blur", function () { setTimeout(function () { list.hidden = true; }, 200); });
    list.addEventListener("mousedown", function (event) {
      const li = event.target.closest("li[role='option']");
      if (li) { input.value = li.dataset.value; list.hidden = true; }
    });
  </script>
</body>
</html>
```

- [ ] **步骤 2：新增红灯集成测试**

在 `test/fill-content-integration.test.js` 追加：

```js
test("联想下拉：候选打分并选中匹配项", async () => {
  const dom = loadFixture("suggest-dropdown.html");
  const doc = dom.window.document;
  const { fields, scanId, documentFingerprint, formFingerprint } = dom.window.__hunterFill.scan(doc);
  const school = fields.find(f => f.label.includes("毕业院校"));
  assert.ok(school, "应识别毕业院校字段");
  const res = await dom.window.__hunterFill.apply([{ id: school.id, value: "复旦大学", type: "text", fingerprint: school.fingerprint }], { scanId, documentFingerprint, formFingerprint });
  const r = res.results.find(x => x.id === school.id);
  assert.equal(r.ok, true, `联想下拉应选中：${r.error || ""}`);
  assert.equal(doc.getElementById("school").value, "复旦大学");
  dom.window.close();
});
```

运行：`node --test test/fill-content-integration.test.js`
预期：FAIL——当前文本分支直接 setter 写入，不会弹层/选候选（夹具 mousedown 逻辑未触发），且 value 被受控逻辑还原。

- [ ] **步骤 3：实现联想适配**

在 `fill-content.js` 新增（放在 `collectCustomOptions` 之后）：

```js
  // 候选项文本与期望值的相似度打分：归一化包含 + 前缀 + 编辑距离粗分。
  function scoreSuggestion(text, value) {
    const a = normalizeCompare(text);
    const b = normalizeCompare(value);
    if (!a || !b) return 0;
    if (a === b) return 100;
    if (a.includes(b) || b.includes(a)) return 80 - Math.abs(a.length - b.length);
    if (a.startsWith(b) || b.startsWith(a)) return 60;
    let common = 0;
    const max = Math.max(a.length, b.length);
    for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] === b[i]) common++;
    return Math.round((common / max) * 40);
  }

  async function applySuggestEntry(entry, value) {
    const input = entry.el;
    input.focus();
    await sleep(80);
    const roots = customOptionRoots(entry.container || entry.el);
    const candidates = [];
    for (const root of roots) {
      const nodes = root.querySelectorAll("[role='option'], li, .ant-select-item, .el-select-dropdown__item");
      nodes.forEach(node => {
        const text = cleanString(node.textContent);
        if (text) candidates.push({ node, text, score: scoreSuggestion(text, value) });
      });
    }
    const best = candidates.filter(c => c.score >= 50).sort((a, b) => b.score - a.score)[0];
    if (!best) return null; // 无匹配候选 → 回退标准打字路径
    triggerAction(best.node);
    await sleep(120);
    if (!verifyValue(entry, entry.type, value)) return null;
    return { ok: true, via: "suggest" };
  }
```

在 `fillOne` 的 `entry.kind === "custom"` 分支前插入：若 `type` 为 `text/tel/email/textarea` 且容器存在候选弹层特征（`customOptionRoots` 返回非空），先尝试 `applySuggestEntry`，返回非 null 即成功，否则回退原逻辑。

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/fill-content-integration.test.js && npm run check && npm test`
预期：新增用例 PASS；全部回归 PASS。

- [ ] **步骤 5：Commit**

```bash
git add fill-content.js test/fixtures/suggest-dropdown.html test/fill-content-integration.test.js
git commit -m "feat(智能填充): 联想下拉候选打分与选中适配器（Wave 2 任务 1）"
```

---

## 任务 2：敏感字段集合（默认人工，三重不可绕过）

**目标：** 身份证号/薪酬/紧急联系人/监护人/证明人/工签等敏感字段，规则、模板、AI 均不得自动填为 match；仅用户显式确认（`userConfirmed: true`）可填。

**文件：** `src/matcher.js`（修改）、`tests/matcher.test.js`（修改）

- [ ] **步骤 1：新增红灯单测**

在 `tests/matcher.test.js` 追加：

```js
test("敏感字段集合：默认强制 manual，用户确认后可填", () => {
  const fields = [
    { id: "f1", label: "身份证号", type: "text", evidence: [{ source: "label", text: "身份证号", weight: 90 }], context: {} },
    { id: "f2", label: "期望薪资", type: "text", evidence: [{ source: "label", text: "期望薪资", weight: 90 }], context: {} },
    { id: "f3", label: "紧急联系人姓名", type: "text", evidence: [{ source: "label", text: "紧急联系人姓名", weight: 90 }], context: {} },
  ];
  const resume = { name: "张三", phone: "13800138000", idCard: "110101199806010011", expectedSalary: "30-40K" };
  const matches = matchRules(fields, resume);
  for (const m of matches) assert.equal(m.status, "manual", `${m.label} 应默认 manual`);
  const confirmed = validateBinding(fields[0], "idCard", resume, { source: "manual", userConfirmed: true });
  assert.equal(confirmed.status, "match");
});
```

运行：`node --test tests/matcher.test.js`
预期：FAIL——当前身份证/期望薪资/紧急联系人可被规则命中为 match。

- [ ] **步骤 2：实现 SENSITIVE_FIELD_KEYS**

在 `src/matcher.js` 顶部常量区新增：

```js
// 敏感字段：默认强制人工，规则/模板/AI 均不可自动填为 match（除非 userConfirmed）。
export const SENSITIVE_FIELD_KEYS = new Set([
  "idCard", "salary", "expectedSalary", "emergencyContact", "emergencyPhone",
  "guardian", "guarantor", "referrer", "workAuthorization", "politicalStatus",
]);
```

在 `matchRules` 生成 match 后、以及 `validateBinding` 校验入口处，追加同一守卫：`if (SENSITIVE_FIELD_KEYS.has(fieldKey) && !options.userConfirmed) return { ...match, status: "manual", reason: "敏感字段，需人工确认" }`（`validateBinding` 内对非确认来源直接短路为 manual）。

- [ ] **步骤 3：运行测试验证通过**

运行：`node --test tests/matcher.test.js && npm run check && npm test`
预期：新增用例 PASS；现有全部回归 PASS。

- [ ] **步骤 4：Commit**

```bash
git add src/matcher.js tests/matcher.test.js
git commit -m "feat(智能填充): 敏感字段集合默认人工且三重不可绕过（Wave 2 任务 2）"
```

---

## 任务 3：选区填充（只填框选区域）

**目标：** 面板进入「选区填充」模式：用户在页面点击某个容器（如紧急联系人区块），content 只填充该容器内已识别字段。

**文件：** `fill-content.js`（修改）、`src/fill-ui.js`（修改）、`test/fixtures/region-form.html`（创建）、`test/panel-smoke.test.js`（修改）

- [ ] **步骤 1：创建选区夹具 + 红灯测试**

`test/fixtures/region-form.html`：两个 section（「基本信息」含姓名/手机号；「紧急联系人」含联系人姓名/电话）。红灯测试：调用 `scan`（带 `region` 参数指向紧急联系人容器）后 `fields` 只含紧急联系人两个字段。

```js
test("选区填充：region 限定扫描范围", () => {
  const dom = loadFixture("region-form.html");
  const doc = dom.window.document;
  const region = doc.querySelector("#emergency");
  const { fields } = dom.window.__hunterFill.scan(doc, { region });
  assert.ok(fields.length === 2, `应只识别选区内字段：${fields.length}`);
  assert.ok(fields.every(f => /紧急联系人|联系人/.test(f.label)));
  dom.window.close();
});
```

运行：`node --test test/fill-content-integration.test.js`
预期：FAIL——当前 `scan(doc)` 忽略 region，返回全部 4 个字段。

- [ ] **步骤 2：实现 scan 支持 region**

`fill-content.js` 的 `scan(doc, scanOptions = {})`：在扫描根节点选择处，若 `scanOptions.region` 为元素（或 CSS 选择器）则以其为扫描根，`locatorBundle`/`uniquePath` 相对该根生成（沿用现有 `:scope` 思路）；`apply` 的 `preflightFills` 不受影响（fieldId 唯一性由 region 内扫描保证）。同步在 `SMART_FILL_SCAN` 消息 payload 增加可选 `region`（`src/messages.js` 注释同步）。

- [ ] **步骤 3：面板加入口**

`src/fill-ui.js`：在智能填充工具条动态创建一个「选区填充」按钮（不依赖 panel.html 静态骨架）：点击后 `chrome.tabs.sendMessage({ type: "SMART_FILL_PICK_REGION" })`——在 `fill-content.js` 的消息分支新增 `SMART_FILL_PICK_REGION`：进入拾取态，用户点击页面元素后把该元素作为 region 回调扫描并返回结果。面板收到结果后按现有 `renderFillMatches` 渲染。`test/panel-smoke.test.js` 断言点击按钮后发送 `SMART_FILL_PICK_REGION` 消息。

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/panel-smoke.test.js test/fill-content-integration.test.js && npm run check && npm test && npm run build`
预期：全部 PASS。

- [ ] **步骤 5：Commit**

```bash
git add fill-content.js src/fill-ui.js src/messages.js test/fixtures/region-form.html test/fill-content-integration.test.js test/panel-smoke.test.js
git commit -m "feat(智能填充): 选区填充模式（region 扫描 + 面板入口）（Wave 2 任务 3）"
```

---

## Wave 2 验收

- [ ] `npm run check && npm test && npm run build` 全绿，现有测试零回归
- [ ] 联想下拉夹具：候选打分选中「复旦大学」，无匹配时回退打字路径且不误选
- [ ] 敏感字段：身份证/期望薪资/紧急联系人默认 manual；`userConfirmed: true` 时才可填；AI/模板路径同样被拦（`validateBinding` 唯一出口）
- [ ] 选区填充：region 扫描只返回选区内字段；面板入口可用
- [ ] 安全不变量保持：`preflightFills`/fingerprint/scanId 路径不变
