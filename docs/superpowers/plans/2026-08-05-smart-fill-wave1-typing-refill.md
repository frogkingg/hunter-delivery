# 智能填充 Wave 1：打字级交互回退 + 回填校验循环 实现计划（2026-08-05）

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 当 `fillOne` 现有「原生 setter + input/change/blur」填充后回读校验失败时，自动追加一次「逐字符模拟打字」（keydown→beforeinput→input→keyup→change→blur）重填并再次校验；仍失败才回报失败。让 React 受控组件/「必须真实输入」类表单从「必填报错」变为可填。

**架构：** 全部改动在 `fill-content.js`（自包含 IIFE，jsdom eval 测试）内部：新增 `typeText(el, value)` 逐字符输入引擎；新增 `fillTextWithRetry(entry, el, type, value)` 封装「标准填充→verify→打字重填→verify」；`fillOne` 文本类分支改用重试层；`apply` 的 results 增加 `retried` 标志与 `finalError`。面板 `src/fill-ui.js` 失败文案区分两种失败。

**技术栈：** Chrome MV3、自包含 classic 脚本、node:test + jsdom（`test/fill-content-integration.test.js` 模式）、Rollup。

**规格：** 依据 2026-08-05 调研结论（formfill 的 typingEngine：逐字符输入 + 清除/重打尾字符 + blur 提交；fill→verify→refill 循环）。

**Git：** 分支 `codex/smart-fill-hardening`（与 Wave 2/3/4 共用，按 Wave 顺序提交）。每个任务一个 commit，中文 Conventional Commits。

---

## 文件结构与职责

| 文件 | 职责 | 本计划动作 |
|---|---|---|
| `fill-content.js` | 扫描/填充执行引擎 | 修改：`typeText`、`fillTextWithRetry`、`fillOne` 文本分支、`apply` results 加 `retried`/`finalError` |
| `src/fill-ui.js` | 面板编排与结果渲染 | 修改：失败行文案区分「回读校验失败」/「模拟输入后仍失败」 |
| `test/fixtures/controlled-input.html` | 模拟 React 受控输入的夹具 | 创建 |
| `test/fill-content-integration.test.js` | 引擎集成测试 | 修改：新增受控输入用例 |

不修改：`src/matcher.js`、`src/form-fields.js`、`src/site-templates.js`、`src/fill-log.js`、`src/messages.js`（协议字段为新增可选字段，向后兼容）、`panel.html`、`manifest.json`。

---

## 任务 1：受控输入夹具 + 红灯测试

**目标：** 新增一个模拟「React 受控组件」的夹具：input 监听 `keydown`，只有收到完整键盘事件链才接受新值，否则还原并拒绝（模拟「必须真实输入」校验）。先写集成测试，确认当前引擎 FAIL。

**文件：** `test/fixtures/controlled-input.html`（创建）、`test/fill-content-integration.test.js`（修改）

- [ ] **步骤 1：创建夹具**

创建 `test/fixtures/controlled-input.html`（参考现有 `test/fixtures/zhilian.html` 的最小表单结构）：

```html
<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>受控输入夹具</title></head>
<body>
  <form id="app">
    <label for="name">姓名</label><input id="name" name="name" type="text">
    <label for="phone">手机号</label><input id="phone" name="phone" type="tel">
    <button type="submit">提交</button>
  </form>
  <script>
    // 模拟 React 受控组件：只接受经由真实键盘事件链写入的值。
    (function () {
      const accepts = new WeakMap();
      for (const input of document.querySelectorAll("input")) {
        input.addEventListener("keydown", function () { accepts.set(this, true); });
        input.addEventListener("input", function () {
          if (!accepts.get(this)) { this.value = ""; }
        });
        input.addEventListener("change", function () {
          if (!accepts.get(this)) { this.value = ""; }
        });
      }
    })();
  </script>
</body>
</html>
```

- [ ] **步骤 2：新增红灯测试**

在 `test/fill-content-integration.test.js` 的 FIXTURES 列表后追加用例（复用文件顶部 `loadFixture` / `engineSource` / `FULL_RESUME`）：

```js
test("受控输入（React 式）：verify 失败后打字重填成功", async () => {
  const dom = loadFixture("controlled-input.html");
  const doc = dom.window.document;
  const { fields, scanId, documentFingerprint, formFingerprint } = dom.window.__hunterFill.scan(doc);
  const name = fields.find(f => f.label.includes("姓名"));
  assert.ok(name, "应识别姓名字段");
  const res = await dom.window.__hunterFill.apply([{ id: name.id, value: "张三", type: "text", fingerprint: name.fingerprint }], { scanId, documentFingerprint, formFingerprint });
  assert.equal(res.ok, true);
  const r = res.results.find(x => x.id === name.id);
  assert.equal(r.ok, true, `姓名应填入：${r.error || ""}`);
  assert.equal(doc.getElementById("name").value, "张三");
  assert.equal(r.retried, true, "应走打字重填路径");
  dom.window.close();
});
```

运行：`node --test test/fill-content-integration.test.js`
预期：FAIL——`姓名应填入`（当前 `setNativeValue + dispatchInput` 不触发 `keydown`，受控校验拒绝 → `verifyValue` 失败 → 抛「回读校验失败」）。

- [ ] **步骤 3：Commit（红灯基线）**

```bash
git add test/fixtures/controlled-input.html test/fill-content-integration.test.js
git commit -m "test(智能填充): 受控输入夹具与打字重填红灯测试（Wave 1 任务 1）"
```

---

## 任务 2：typeText 打字引擎 + fillTextWithRetry

**目标：** 实现逐字符打字引擎与重试填充，让红灯变绿。

**文件：** `fill-content.js`

- [ ] **步骤 1：新增 typeText 与 fillTextWithRetry**

在 `dispatchInput`（第 946 行附近）之后新增：

```js
  // 逐字符模拟真实输入：keydown→beforeinput→input→keyup，提交时 change→blur。
  async function typeText(el, value, stepMs = 30) {
    const KeyEventCtor = typeof window.KeyboardEvent === "function" ? window.KeyboardEvent : Event;
    const typeChars = Array.from(String(value || ""));
    el.focus();
    el.select();
    if (typeof el.setRangeText === "function") {
      el.setRangeText("");
    } else {
      el.value = "";
    }
    for (const char of typeChars) {
      el.value += char;
      const opts = { key: char, bubbles: true, cancelable: true };
      el.dispatchEvent(new KeyEventCtor("keydown", opts));
      el.dispatchEvent(new Event("beforeinput", { bubbles: true, cancelable: true }));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new KeyEventCtor("keyup", opts));
      await sleep(stepMs);
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
    return el.value;
  }

  // 标准填充 → 回读校验 → 失败则打字重填 → 再次回读。
  async function fillTextWithRetry(entry, el, type, value) {
    const finalValue = type === "date" ? valueForNativeDate(el, value) : value;
    if (type === "date" && !finalValue) throw new Error("日期精度与页面控件不匹配，请手动选择");
    setNativeValue(el, finalValue);
    dispatchInput(el);
    if (verifyValue(el, type, finalValue)) return { ok: true, retried: false };
    await typeText(el, finalValue);
    if (!verifyValue(el, type, finalValue)) throw new Error("模拟输入后仍失败");
    return { ok: true, retried: true };
  }
```

- [ ] **步骤 2：fillOne 文本分支改用 fillTextWithRetry**

将 `fillOne`（第 1440-1456 行附近）末尾文本类分支：

```js
    setNativeValue(el, finalValue);
    dispatchInput(el);
    if (!verifyValue(el, type, finalValue)) throw new Error("回读校验失败");
    return { ok: true };
```

替换为：

```js
    return fillTextWithRetry(entry, el, type, value);
```

- [ ] **步骤 3：apply results 透传 retried**

在 `apply` 内收集 results 处，把 `fillTextWithRetry` 返回的 `retried` 写入 result：`results.push({ id: fill.id, ok: true, resolvedFingerprint: entryFingerprint(entry, target), verification: "ok", retried: result.retried || false })`（保持现有字段不变，仅新增可选 `retried`）。若未找到现有收集处，按 `resolvedFingerprint` 同结构新增该字段。

- [ ] **步骤 4：运行测试验证通过**

运行：`node --test test/fill-content-integration.test.js`
预期：全部 PASS（含新增受控输入用例）；`r.retried === true`。

运行回归：`npm run check && npm test`
预期：语法检查通过，现有全部测试（198+）不回归。

- [ ] **步骤 5：Commit**

```bash
git add fill-content.js
git commit -m "feat(智能填充): 打字级交互回退与回填校验循环（Wave 1 任务 2）"
```

---

## 任务 3：面板失败文案区分 + 协议字段同步

**目标：** 用户看到失败原因时能区分「普通回读失败」与「模拟输入后仍失败」；`src/messages.js` 的 APPLY results 注释同步新增 `retried` 可选字段。

**文件：** `src/fill-ui.js`、`src/messages.js`

- [ ] **步骤 1：更新红灯测试**

在 `test/panel-smoke.test.js` 增加断言：当 result 含 `error: "模拟输入后仍失败"` 时，失败行文案显示「已尝试模拟输入仍失败」。先写断言（FAIL：当前文案不含该提示）。

- [ ] **步骤 2：实现文案区分**

在 `src/fill-ui.js` 渲染失败行处（`matchRowHtml` / 失败 reason 展示），把 error 文案映射：`error.includes("模拟输入后仍失败")` → 显示「已尝试模拟输入仍失败，请手动填写」；其他保持原文案。

- [ ] **步骤 3：messages.js 同步**

`src/messages.js` 的 `SMART_FILL_APPLY.response.results` 描述追加 `retried: "boolean?"` 注释（协议向后兼容，不改结构）。

- [ ] **步骤 4：验证**

运行：`node --test test/panel-smoke.test.js && npm run check && npm test && npm run build`
预期：全部 PASS；`dist/fill-content.js` 重新生成且含 `typeText`。

- [ ] **步骤 5：Commit**

```bash
git add src/fill-ui.js src/messages.js test/panel-smoke.test.js
git commit -m "feat(智能填充): 失败文案区分打字重填路径（Wave 1 任务 3）"
```

---

## Wave 1 验收

- [ ] `npm run check && npm test && npm run build` 全绿，现有测试零回归
- [ ] 新增受控输入用例证明：verify 失败后自动打字重填成功，`retried: true`
- [ ] 原有非受控表单（`zhilian.html` 等 6 夹具）填充行为不变（仍走标准路径，`retried: false` 或省略）
- [ ] 安全不变量保持：fingerprint/scanId/会话校验路径未被绕过（`apply` 仍走 `preflightFills`）
