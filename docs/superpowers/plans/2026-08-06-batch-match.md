# 批量 AI 匹配「筛选器化」实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 修复批量 AI 匹配+投递的 C1–C7 阻断 bug，并把功能收敛为「扫描+阈值筛选」，招呼语生成/投递复用现有清单链路；默认关闭自动投递并加确认门；补测试与 check 门禁。

**架构：** batch-match.js 只做扫描编排与阈值筛选（轻量 AI 调用只出 score+reasoning）；入选岗位写入投递清单（status=待生成，绑定 activeProfile().name）；招呼语生成与投递完全复用 queue.js 的 generateQueue/startQueue。content.js 提供逐卡片扫描与「点击+等待详情加载」的选中能力。

**技术栈：** Chrome MV3、ES Modules、node:test + jsdom、Rollup。无新依赖。

**规格：** `docs/superpowers/specs/2026-08-06-batch-match-design.md`

---

## 文件结构

| 文件 | 职责（变更后） |
|---|---|
| `src/batch-match.js` | 批量筛选编排 + 纯函数 `sanitizeMatch`/`isDuplicateJob`/`buildBatchSummary` |
| `src/prompts.js` | `buildBatchMatchPrompt`（只出 score+reasoning）；删除 `buildBatchMatchAndGreetingPrompt` |
| `content.js` | `scanListJobs`（逐卡片）、`selectListJob`（点击+轮询等待）、onMessage async 化 |
| `src/render.js` | `renderQueueItem` 展示 matchScore/matchReasoning |
| `panel.html` | `batchAutoSendCheck` 默认不勾选；文案改为「存入投递清单」 |
| `package.json` | check 追加 `src/batch-match.js` |
| `tests/batch-match.test.js` | 新增：sanitizeMatch / isDuplicateJob / buildBatchSummary |
| `tests/prompts.test.js` | 更新：buildBatchMatchPrompt；删除旧测试 |
| `test/content-integration.test.js` | 更新：scanListJobs 逐卡片、selectListJob 等待匹配 |
| `test/panel-smoke.test.js` | 更新：断言 batch 按钮绑定 + checkbox 默认不勾选 |

---

### 任务 1：prompts.js — 轻量筛选 prompt

**文件：**
- 修改：`src/prompts.js`（新增 `buildBatchMatchPrompt`，删除 `buildBatchMatchAndGreetingPrompt`）
- 测试：`tests/prompts.test.js`

- [ ] **步骤 1：改写失败测试**（删除旧 buildBatchMatchAndGreetingPrompt 测试，新增 buildBatchMatchPrompt 断言：含 score/reasoning、含 `<job_data>`、含 job 序列化、不含 greetings）

```js
test("buildBatchMatchPrompt: 只要求 score/reasoning 结构", () => {
  const job = { title: "全栈", company: "测试公司" };
  const out = buildBatchMatchPrompt("要求", "简历", job);
  assert.ok(out.includes('"score"'));
  assert.ok(out.includes('"reasoning"'));
  assert.ok(!out.includes("greetings"));
  assert.ok(out.includes("<job_data>"));
  assert.ok(out.includes(JSON.stringify(job)));
});
```

- [ ] **步骤 2：运行测试确认失败**：`node --test tests/prompts.test.js` → 报 `buildBatchMatchPrompt is not a function`
- [ ] **步骤 3：实现**：在 `src/prompts.js` 新增 `buildBatchMatchPrompt`（要求仅返回 `{"score":0-100,"reasoning":"1-2 句"}`，禁止输出招呼语/其它字段），删除 `buildBatchMatchAndGreetingPrompt`
- [ ] **步骤 4：运行测试确认通过**
- [ ] **步骤 5：Commit**（`git commit -m "feat(批量匹配): 轻量筛选 prompt 只输出 score/reasoning"`）

---

### 任务 2：batch-match.js 纯函数（TDD）

**文件：**
- 创建：`tests/batch-match.test.js`
- 修改：`src/batch-match.js`

- [ ] **步骤 1：编写失败测试**（sanitizeMatch：clamp 0-100/取整/缺省 reasoning/非数字→抛错；isDuplicateJob：jobId 优先、title+company 兜底、跨 queue/recent/library、URL 归一化；buildBatchSummary：计数文案）
- [ ] **步骤 2：运行确认失败**：`node --test tests/batch-match.test.js`
- [ ] **步骤 3：实现纯函数**并导出：

```js
export function sanitizeMatch(raw) {
  const score = Number(raw?.score);
  if (!Number.isFinite(score)) throw new Error("AI 未返回有效匹配分");
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasoning: String(raw?.reasoning || "").trim() || "未返回分析结论",
  };
}

export function isDuplicateJob(job, { deliveryQueue = [], recentDeliveries = [], jobLibrary = [] } = {}) {
  const normalizeUrl = url => (url || "").split("?")[0].replace(/\/+$/, "");
  const jobKey = job.jobId || normalizeUrl(job.detailUrl);
  const match = item => {
    const itemKey = item.jobId || normalizeUrl(item.detailUrl);
    return (jobKey && itemKey && jobKey === itemKey) || (job.title === item.title && job.company === item.company);
  };
  return deliveryQueue.some(match) || recentDeliveries.some(match) || jobLibrary.some(match);
}

export function buildBatchSummary({ scanned, added, lowScore, duplicate, failed }) {
  return `批量匹配完成！共扫描 ${scanned} 个岗位：匹配 ${added}、低分跳过 ${lowScore}、去重跳过 ${duplicate}、失败 ${failed}。`;
}
```

- [ ] **步骤 4：运行确认通过**
- [ ] **步骤 5：Commit**

---

### 任务 3：content.js — 扫描/选中/异步消息

**文件：**
- 修改：`content.js`
- 测试：`test/content-integration.test.js`

- [ ] **步骤 1：编写失败测试**：在 content-integration.test.js 增加卡片 DOM mock；`SCAN_LIST_JOBS` 断言每张卡片独立 title/company；`SELECT_LIST_JOB` 断言点击后轮询到匹配 job 才返回、超时返回 `{ok:false,reason}`
- [ ] **步骤 2：运行确认失败**
- [ ] **步骤 3：实现**：
  - `scanListJobs()` 逐卡片 `card.querySelector(...)`，移除全局 scopedText 作用域
  - `selectListJob(index)` 改 async：点击 → 每 200ms 轮询 `extractJob()` 直到 jobId（有则）或 title 与卡片匹配，最多 3s → `{ ok:true, job }` / `{ ok:false, reason }`
  - onMessage 监听器 async 包装 + `return true`（保留 SEND_MESSAGE 既有 return true 路径）
- [ ] **步骤 4：运行确认通过**（含全量 `npm test`）
- [ ] **步骤 5：Commit**

---

### 任务 4：batch-match.js 主流程重构

**文件：**
- 修改：`src/batch-match.js`

- [ ] **步骤 1：重写 `startBatchMatch`**：前置校验（apiKey/candidateProfile/activeProfile）→ tab 校验 → 容量对齐（`avail=20-queue.length`，`N=min(input,avail)`）→ SCAN_LIST_JOBS → 循环（进度 UI/选中/去重/AI 筛选重试 1 次/计数）→ 熔断（连续失败≥3）→ 汇总 → 自动投递（默认关 + confirm + selectedQueueKeys + generateQueue + startQueue）
- [ ] **步骤 2：`setBatchMatchingState` 显隐修复**：运行中显示停止按钮、开始禁用；结束恢复
- [ ] **步骤 3：`updateProgressUI` 显示进度框**（首次调用移除 hidden）
- [ ] **步骤 4：`stopBatchMatch` 保留汇总文本**（不再清 0/0）
- [ ] **步骤 5：验证**：`npm run check` + `npm test` + 面板冒烟
- [ ] **步骤 6：Commit**

---

### 任务 5：render.js 队列卡片展示分数与理由

**文件：**
- 修改：`src/render.js`

- [ ] **步骤 1：`renderQueueItem` 增加匹配区块**：`item.matchScore` 存在时展示「匹配分 X/100 · reasoning」
- [ ] **步骤 2：验证**：`npm run check` + `npm test`（panel-smoke 覆盖渲染路径）
- [ ] **步骤 3：Commit**

---

### 任务 6：panel.html 默认关 + 文案

**文件：**
- 修改：`panel.html`、`test/panel-smoke.test.js`

- [ ] **步骤 1：`batchAutoSendCheck` 去掉 checked**；提示文案改为「高于阈值的岗位存入投递清单，可在清单中生成招呼语并投递」
- [ ] **步骤 2：panel-smoke 增加断言**：`#batchAutoSendCheck` 存在且 `checked === false`；`#startBatchMatch`/`#stopBatchMatch` 绑定 onclick
- [ ] **步骤 3：运行 `node --test test/panel-smoke.test.js` 通过**
- [ ] **步骤 4：Commit**

---

### 任务 7：门禁 + 全量验证 + 收尾

**文件：**
- 修改：`package.json`

- [ ] **步骤 1：check 追加 `src/batch-match.js`**
- [ ] **步骤 2：全量验证**：`npm run check && npm test && npm run build`
- [ ] **步骤 3：Commit**（`docs(批量匹配): 批量筛选器化实现`）

---

## 验证命令

```bash
npm run check
npm test
npm run build
```

## 已知限制（见规格 §8）
- BOSS 真实 DOM 选择器需真站验证（本计划不含真站自动化）。
- 停止仅两岗位边界生效（非流式 AI 请求无法中断）。