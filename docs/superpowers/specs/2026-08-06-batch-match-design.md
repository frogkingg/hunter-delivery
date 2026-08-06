# 批量 AI 匹配与投递「筛选器化」改进设计规格（Plan A）

> 状态：草稿待审（2026-08-06）。依据：批量 AI 匹配+投递功能的产品/技术分析（C1–C7 阻断、I1–I8 重要、P1–P6 产品）与用户选定的方案 A。
> 关联实现计划：`docs/superpowers/plans/2026-08-06-batch-match.md`

## 1. 背景与问题

「批量 AI 匹配+投递」是 WIP 新功能（`src/batch-match.js`，未提交、零测试、未纳入 `npm run check`）。分析确认以下问题：

### 阻断级（Critical）

| # | 问题 | 影响 |
|---|---|---|
| C1 | `ai()` 返回 `{ok,text,usage}` 对象，代码对对象调 `.match()` → TypeError 被吞 → score=0 | 所有岗位按「0分<阈值」跳过，功能完全不可用 |
| C2 | 自动投递依赖 `selectedQueueKeys`，批量新增岗位从未被选中 | 默认「自动发送」必然失败 |
| C3 | 进度条容器 `hidden`、停止按钮 `hidden` 属性从未移除 | 运行全程无反馈、无停止入口 |
| C4 | `selectListJob` 点击后立即 `extractJob()`，不等详情加载 | 读到旧岗位/空数据，错误岗位入库 |
| C5 | `state.currentProfileName` 不存在 → 恒为「标准简历」 | runQueue 按 profileName 找简历发图片会失败 |
| C6 | `scanListJobs` 用 `scopedText` 但作用域错误（总取文档第一张卡片） | 列表 title/company 全错 |
| C7 | 新模块未纳入 `npm run check`、零测试 | 回归不被门禁捕获 |

### 重要级（Important）

- I1 AI 调用路径最弱：无 `jsonMode`、无重试、正则解析、`maxTokens` 默认 1800 可能截断。
- I2 一次调用生成 3 条招呼语只用 1 条（~2/3 token 浪费）。
- I3 无前置校验（apiKey / 简历），空简历会让 AI 编造。
- I4 `targetCount` max=50 与队列上限 20 不一致，后半程 QUEUE_ADD 全失败。
- I5 AI 失败被归为「0分<阈值」，误导用户。
- I6 运行中无 tab 守卫、无连续失败熔断。
- I7 停止无法中断进行中的非流式请求（仅边界生效）。
- I8 去重 title+company 兜底可能误判。

### 产品级（Product）

- P1 定位应为「批量筛选器」，投递复用现有清单链路。
- P3 队列卡片不展示 matchScore/matchReasoning，筛选透明性缺失。
- P4 默认自动发送风险高（BOSS 账号风控）。
- P5 一次 3 条招呼语只取 1 条，成本/延迟翻三倍。
- P6 进度/停止 UI 不可见、功能收在默认折叠的 `<details>` 中。

## 2. 目标与非目标

### 目标（本次范围）

1. 修复 C1–C7 全部阻断 bug。
2. 流程收敛：batch-match 收敛为「扫描 + 阈值筛选」，招呼语生成回归现有 `generateQueue`（流式、可编辑、失败重试、原始返回可诊断、正确绑定简历），投递回归现有 `startQueue`/`runQueue`。
3. 筛选调用轻量化：只输出 score+reasoning，成本降约 2/3；`jsonMode` + `parseAiJson` + 单次重试 + 更大 `maxTokens` 提升成功率。
4. 自动发送默认关闭 + 确认门。
5. 修复进度条/停止按钮显隐；队列卡片展示分数与理由；筛选结束输出汇总（扫描/匹配/低分/去重/失败）。
6. 补测试（纯逻辑 + prompt + content 扫描/选中 + 面板冒烟）并把 `src/batch-match.js` 纳入 `npm run check`。

### 非目标（本次范围外 / 方案 C backlog）

- 筛选报告卡片 UI、断点续跑、暂停/恢复。
- 多简历 × 多岗位矩阵筛选、阈值校准/反馈闭环。
- 批量 token/费用预估展示。
- 重构 background 投递引擎、改动 runQueue 节流策略。
- manifest 权限与版本号变更。

## 3. 目标流程

```
前置校验（apiKey / candidateProfile / activeProfile 缺一不可，缺则 toast 拦截）
打开 BOSS /web/geek/jobs 列表页 → 点「开始批量筛选」
  ┌───────────────────────────────────────────────┐
  │ 1. 校验活动 tab 为 zhipin /web/geek/jobs       │
  │ 2. N = min(输入数量, 队列剩余容量=20-queue.len) │  (avail<=0 拦截)
  │ 3. SCAN_LIST_JOBS 读列表索引                   │
  │ 4. 循环 i∈[0,N)：                              │
  │    a. 更新进度条/状态文本（显示停止按钮）        │
  │    b. SELECT_LIST_JOB(i)：点击→轮询详情加载→返回 │
  │    c. 失败→计数，连续≥3 熔断停止                 │
  │    d. isDuplicateJob 去重（jobId 优先）          │
  │    e. AI 筛选：buildMatchPrompt→ai(jsonMode,    │
  │       maxTokens=800)→parseAiJson；失败重试 1 次  │
  │    f. score≥T → QUEUE_ADD（含 matchScore/       │
  │       matchReasoning/profileName=activeProfile）│
  │    g. 低分/去重/失败分别计数并显示原因            │
  │ 5. 汇总：扫描 N｜匹配 M｜低分 K｜去重 D｜失败 F   │
  └───────────────────────────────────────────────┘
若勾选「匹配完成后自动投递」（默认关）且 M>0：
  confirm("已匹配 M 个岗位，将自动生成招呼语并投递，确认？")
  → selectedQueueKeys = 新增岗位 keys
  → generateQueue()（现有，流式生成）
  → startQueue()（现有，确认后投递）
```

## 4. 设计决策

### D1 轻量筛选调用（对应 I1/I2/I5）

- 新增 `buildBatchMatchPrompt(writingRequirements, resumeContent, job)`：只要求返回 `{"score": 0-100, "reasoning": "1-2 句话"}`，明确禁止生成招呼语或其它字段（省 token、降解析失败率）。
- 调用 `ai([...], 800, true)`（jsonMode=true, maxTokens=800）；返回后 `parseAiJson(rawRes.text)`（复用后台 `jsonFrom` 健壮解析）。
- 解析结果经 `sanitizeMatch(raw)` 纯函数校验：score 非数字/越界 → clamp 0-100 取整；reasoning 缺省为「未返回分析结论」；解析失败抛错。
- 单岗位 AI 失败重试 1 次；仍失败计入「失败 F」，状态文案显示「AI 匹配失败，已跳过」，**不得**显示为「0分<阈值」。
- 删除 `buildBatchMatchAndGreetingPrompt`（不再使用）。

### D2 复用生成/投递链路（对应 P1/C2）

- 批量新增的队列项**不再携带 greeting/greetings** → `QUEUE_ADD` 自动置 status=「待生成」。
- 自动投递 = 确认门 → `state.selectedQueueKeys = new Set(addedKeys)` → `generateQueue()` → `startQueue()`（均从 `queue.js` import，已 export）。
- 手动路径不变：用户到「投递清单」勾选 → 批量生成招呼语 → 开始投递。

### D3 自动发送默认关闭 + 确认门（对应 P4）

- `batchAutoSendCheck` 默认**不勾选**。
- 勾选且 M>0 时，投递前 `confirm()` 明确告知岗位数与动作。
- 面板文案同步更新：去掉「自动打招呼」，改为「存入投递清单，可在清单中生成招呼语并投递」。

### D4 content.js 扫描/选中修复（对应 C4/C6/I6）

- `scanListJobs()`：逐卡片 `card.querySelector(...)` 提取 title/company/href/jobId；不依赖全局 `scopedText` 作用域。
- `selectListJob(index)`：改为 async：点击 → 每 200ms 轮询 `extractJob()` 直到 jobId/title 与目标卡片匹配（最多 3s）→ 返回 `{ ok:true, job }`；超时返回 `{ ok:false, reason }`。
- onMessage 监听器改为 async 包装 + `return true`（与 `background.js` 同模式），保证 SELECT_LIST_JOB 异步响应可用；EXTRACT_JOB/SCAN_LIST_JOBS 等同步分支行为不变。

### D5 简历绑定修复（对应 C5/I3）

- 前置校验：`state.config.apiKey && state.config.candidateProfile && activeProfile()` 缺一不可，否则 toast 拦截（对齐 generateQueue 校验）。
- `profileName: activeProfile().name`（不再使用不存在的 `state.currentProfileName`）。

### D6 进度/停止 UI 修复（对应 C3/P6）

- `setBatchMatchingState(true)`：移除 `#stopBatchMatch` 的 hidden 属性、禁用开始按钮。
- `updateProgressUI` 首次调用时移除 `#batchProgressBox` 的 hidden class。
- `setBatchMatchingState(false)`：恢复停止按钮 hidden；进度框保留最终汇总（下次开始时重置）。

### D7 去重与计数收敛（对应 I8）

- 抽出纯函数 `isDuplicateJob(job, { deliveryQueue, recentDeliveries, jobLibrary })`（jobId 优先，title+company 兜底；URL 归一化去 query/尾斜杠）。
- 筛选循环内维护计数 `{ scanned, added, lowScore, duplicate, failed }`，结束输出汇总文案与 toast。

### D8 队列容量对齐（对应 I4）

- 启动时 `avail = 20 - queue.length`；`targetCount = Math.min(input, avail)`；`avail <= 0` 直接拦截并提示清理清单。

### D9 熔断与中止（对应 I6/I7）

- 连续 SELECT_LIST_JOB 失败 ≥3 → 自动停止并提示（对齐 runQueue 熔断模式）。
- 停止仅在两岗位边界生效（非流式请求无法中断），记为已知限制；不引入流式改造（超范围）。

### D10 队列卡片展示（对应 P3）

- `renderQueueItem`：存在 matchScore/matchReasoning 时展示「匹配分 X/100 · 理由」区块。

### D11 门禁与测试（对应 C7）

- `package.json` check 追加 `src/batch-match.js`。
- 新增 `tests/batch-match.test.js`：sanitizeMatch、isDuplicateJob、汇总计数纯逻辑。
- 更新 `tests/prompts.test.js`：buildBatchMatchPrompt 结构断言；删除旧 buildBatchMatchAndGreetingPrompt 测试。
- 新增/更新 content 集成测试：scanListJobs 逐卡片读取、selectListJob 点击后等待匹配（jsdom）。
- 更新 `test/panel-smoke.test.js` 按钮清单（断言 startBatchMatch/stopBatchMatch 已绑定）。

## 5. 文件变更清单

| 文件 | 变更 |
|---|---|
| `src/batch-match.js` | 重构：抽出纯函数 + 轻量筛选调用 + 前置校验 + 容量对齐 + 熔断 + 汇总 + 自动投递编排 |
| `src/prompts.js` | 新增 `buildBatchMatchPrompt`；删除 `buildBatchMatchAndGreetingPrompt` |
| `content.js` | `scanListJobs`/`selectListJob` 修复；onMessage async 化 |
| `src/render.js` | `renderQueueItem` 展示分数与理由 |
| `panel.html` | 自动发送默认关；文案更新 |
| `src/app.js` | 不变（按钮已绑定） |
| `package.json` | check 追加 `src/batch-match.js` |
| `tests/batch-match.test.js` | 新增 |
| `tests/prompts.test.js` | 更新 |
| `test/content-integration.test.js` | 更新/新增扫描与选中用例 |
| `test/panel-smoke.test.js` | 按钮清单补 startBatchMatch/stopBatchMatch |

## 6. 错误处理

| 场景 | 行为 |
|---|---|
| 未配置 API Key / 简历 | 启动前 toast 拦截，不进入循环 |
| tab 非 BOSS 列表页 | toast 提示跳转（保留现有校验） |
| SCAN_LIST_JOBS 失败/空 | toast + 恢复按钮态 |
| SELECT_LIST_JOB 失败 | 计失败；连续 3 次熔断停止；单次失败继续下一岗位 |
| AI 调用失败 | 重试 1 次；仍失败计「失败 F」，文案区分错误与低分 |
| QUEUE_ADD 失败 | 计失败并显示原因（队列满已在启动前拦截） |
| 用户停止 | 停止按钮/进度即时反馈；当前岗位完成后停止 |
| 自动投递被拒（confirm 取消） | 仅保留筛选结果，不投递 |

## 7. 测试策略

- 纯逻辑（无 chrome/DOM）：sanitizeMatch（clamp/缺省/异常）、isDuplicateJob（jobId/兜底/跨来源）、汇总计数。
- prompt：buildBatchMatchPrompt 含 score/reasoning 结构、含 `<job_data>`、不含 greetings 字段。
- content（jsdom）：scanListJobs 正确读取每张卡片独立数据；selectListJob 点击后轮询到匹配岗位才返回；超时返回失败。
- 面板冒烟：startBatchMatch/stopBatchMatch 绑定。

## 8. 已知限制与开放问题

- BOSS 真实 DOM 选择器（`.job-card-wrap` 等）需真站验证；若失配需按真实页面适配（局部调整，不影响其余设计）。
- 停止无法中断进行中的 AI 请求（非流式），仅边界生效。
- `selectListJob` 等待策略假设列表页右侧浮层更新；若 BOSS 改为新 tab 打开详情，需调整（真站验证项）。