# Code Review 修复实现计划（v1.2.1）

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:executing-plans（内联执行，本会话执行）。步骤使用复选框（`- [ ]`）语法跟踪进度。

**目标：** 按 2026-08-01 代码审查结论修复全部 [必须修复] 与可落地的 [建议修改]/[仅供参考] 项，产出 v1.2.1。

**架构：** 保持 MV3 + 无框架 ESM 结构；统一纯函数单一来源（lib/shared.js）；批量投递改为「发送前落盘发送中 + 孤儿态恢复」，消除 SW 回收导致的卡死/双发窗口；权限与构建产物对齐现实。

**技术栈：** Chrome MV3、Node 内置 test runner、Rollup（本次移除）。

**Git 规划：** 分支 `codex/fix-review-1.2.1`，6 个分组 commit，末尾 bump v1.2.1 并打 tag。

---

### 任务 A：纯函数单一来源 + CSV 注入 + 私网校验增强

**文件：**
- 修改：`lib/shared.js`（escapeCsv 公式注入防护、私网校验增强）
- 修改：`background.js:1,27,32,37,74-82,330-418`（删除内联副本，改 import lib/shared.js）
- 测试：`test/shared.test.js`

- [ ] 步骤 1：先写失败测试（escapeCsv 公式注入、私网变体）
- [ ] 步骤 2：运行确认失败
- [ ] 步骤 3：修复 lib/shared.js + 接线 background.js
- [ ] 步骤 4：npm run check && npm test 全绿
- [ ] 步骤 5：Commit `refactor(核心): 统一纯函数单一来源，修复 CSV 注入与私网校验`

### 任务 B：批量投递中断恢复 + 发送中状态 + 不确定态（C1/I1）

**文件：**
- 修改：`background.js`（recoverInterruptedQueue、发送中持久化、uncertain 分支、QUEUE_GET/QUEUE_START 恢复）
- 修改：`content.js:341-402`（超时错误标记 uncertain，SEND_MESSAGE 响应带 uncertain）
- 修改：`src/render.js:153-162`（已中断/发送结果未知保存前 confirm）
- 测试：`test/background-integration.test.js`、`test/content-integration.test.js`

- [ ] 步骤 1：失败测试（孤儿投递中恢复、uncertain 状态、超时 uncertain 标志）
- [ ] 步骤 2：确认失败
- [ ] 步骤 3：实现
- [ ] 步骤 4：全绿
- [ ] 步骤 5：Commit `fix(投递): 中断恢复与发送中状态持久化，明确发送不确定态`

### 任务 C：发送重试跳过已知失败气泡（I4）

**文件：**
- 修改：`content.js`（waitForOutgoingMessage 支持跳过已失败元素）
- 测试：`test/content-integration.test.js`

- [ ] 步骤 1：失败测试（第一次失败气泡不拦截第二次成功）
- [ ] 步骤 2：确认失败 → 实现 → 全绿
- [ ] 步骤 3：Commit `fix(发送): 重试时跳过已确认失败的旧气泡`

### 任务 D：权限最小化 + 移除死构建 + 死代码 + 协议文档（I2/I3/M4/M5）

**文件：**
- 修改：`manifest.json`（移除 activeTab/tabs/WER）
- 删除：`rollup.config.mjs`、`dist/`、package.json build/dev/clean 脚本与 devDeps
- 修改：`content.js`（删 OPEN_CURRENT_JOB_DETAIL 与 openCurrentJobDetail）、`src/messages.js`（删对应项、补字段）、`src/render.js`（删 dataset.original）
- 修改：`README.md`（开发章节）
- 测试：全量回归

- [ ] 步骤 1：改 manifest + 删构建 + 删死代码
- [ ] 步骤 2：npm test 回归
- [ ] 步骤 3：Commit `chore(权限): 最小化权限并移除未使用的构建管线与死代码`

### 任务 E：面板与队列优化（M2/M3/M6/M7/M8/M9）

**文件：**
- 修改：`background.js`（队列 sameJob 去重、运行中删除防护、blob URL 导出）
- 修改：`src/ai-client.js`、`background.js`（AI payload 只传必要字段）
- 修改：`src/render.js`（轮询不覆盖焦点编辑、费用估算仅 DeepSeek）
- 测试：`test/background-integration.test.js`（去重、运行期防护）

- [ ] 步骤 1：失败测试（sameJob 去重、运行期删除拒绝）
- [ ] 步骤 2：实现 → 全绿
- [ ] 步骤 3：Commit `refactor(队列): 队列去重、运行期防护与 AI 调用瘦身`

### 任务 F：版本与收尾

- [ ] 步骤 1：bump manifest/package.json 到 1.2.1
- [ ] 步骤 2：README 安全边界补充「发送结果未知/已中断」语义
- [ ] 步骤 3：全量验证 npm run check && npm test
- [ ] 步骤 4：Commit `chore: bump version to 1.2.1` + tag v1.2.1
