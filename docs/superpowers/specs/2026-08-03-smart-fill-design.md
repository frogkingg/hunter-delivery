# 智能填充（Smart Fill）设计规格 — v1.3.0

> 状态：已批准（2026-08-03）。依据：需求 + 头脑风暴确认的 4 项决策（混合引擎 / 站点模板+日志 / 夹具+真站手册 / 侧边栏为主）。

## 1. 目标

为「猎投」Chrome 扩展新增智能填充主功能：在第三方公司网申页面自动识别表单项，结合用户简历内容匹配字段值，在侧边栏预览/修改后一键填充，并记忆站点模板、记录填充日志。目标场景是招聘季在海量独立网申平台（如 Moka、北森、大易、智联校招等）减少重复填写。

## 2. 非目标（v1 范围外）

- 不处理 `password`、`file` 上传类控件（安全与浏览器限制），扫描时标记为「需手动」。
- 不做 Firefox / Safari 兼容（沿用现有 Chrome MV3 技术栈）。
- 不做页面指纹细分模板（模板仅按 hostname 记忆）。
- 填充日志不做导出（v1 只读展示）。
- 不绕过验证码 / 滑块 / 登录墙，不做任何反自动化对抗。

## 3. 架构

沿用 MV3 + 无框架 ESM + `node --test`。新增一条「智能填充」链路：

```
侧边栏 panel（src/fill-ui.js + 纯函数模块）
   │ chrome.runtime.sendMessage
   ▼
background.js 中继（按需注入 fill-content.js）
   │ chrome.tabs.sendMessage
   ▼
fill-content.js（自包含 classic 脚本：扫描/高亮/填充执行）
```

### 模块划分

| 模块 | 文件 | 职责 | 依赖 |
|---|---|---|---|
| 字段字典/归一化 | `src/form-fields.js`（ESM 纯函数） | 规范字段字典、标签归一化、控件类型分类 | 无 |
| 匹配引擎 | `src/matcher.js`（ESM 纯函数） | 规则匹配 + AI 兜底编排 | form-fields |
| 简历字段提取 | `src/resume-fields.js`（ESM） | 本地正则提取 + AI 提取 prompt/合并 | form-fields |
| 站点模板 | `src/site-templates.js`（ESM 纯函数） | 模板套用/保存/上限 | 无 |
| 填充日志 | `src/fill-log.js`（ESM 纯函数） | 日志追加/上限/摘要 | 无 |
| 填充引擎 | `fill-content.js`（classic） | DOM 扫描、高亮、批量填充执行 | 无（自包含） |
| 面板 UI | `src/fill-ui.js`（ESM） | 智能填充页交互 | 上述纯函数 + chrome-helpers |

### 数据流

1. 面板「扫描」→ background 中继 → `fill-content.js` 扫描 DOM，返回 `FieldDescriptor[]` 与页面信息。
2. 面板按 模板 > 规则 > AI 顺序计算匹配结果（用户编辑优先级最高，在 UI 层覆盖）。
3. 用户勾选并调整值 → `SMART_FILL_APPLY` → content 逐字段执行（100 ms 间隔）并回报进度 → 回读校验。
4. 填充成功后按 hostname 保存站点模板、追加填充日志。

## 4. 关键接口

### 4.1 FieldDescriptor（扫描输出）

```ts
{
  id: string,            // 本次扫描内稳定唯一："input-3" / "select-1" / "radio-name" / "custom-2"
  type: "text" | "tel" | "email" | "number" | "date" | "textarea"
      | "select" | "radio" | "checkbox" | "custom-select" | "custom-date",
  label: string,         // 归一化后的标签（面板展示与匹配使用）
  rawLabel: string,      // 扫描原始文本
  labelSource: string,   // label | wrap | aria | placeholder | title | neighbor | container
  path: string,          // 唯一 CSS 选择器（高亮/回填定位）
  required: boolean,
  options: string[],     // select/radio/custom-select 的选项文本
  value: string,         // 当前值
  skipped: boolean,      // password/file 等不可自动填充控件
  fingerprint: string,   // 字段语义指纹，填充前后必须一致
  evidence: Array,       // label/name/id/autocomplete/placeholder/上下文等全部证据
  context: Object,       // form/section/group
  adapter: string,       // native/antd/element/date-range 等执行适配器
  slot: string,          // 复合控件逻辑 slot（single/start/end）
  locators: Array,       // 多定位候选；位置型 CSS 仅作低权重召回
}
```

### 4.2 消息协议（src/messages.js 追加）

| type | direction | payload | response |
|---|---|---|---|
| `SMART_FILL_SCAN` | panel→content | `{}` | `{ ok, engineVersion, scanId, documentFingerprint, formFingerprint, fields, repeaters, page }` |
| `SMART_FILL_PREPARE` | panel→content | `{ scanId, documentFingerprint, formFingerprint, plans: [{ id, fingerprint, targetCount }] }` | `{ ok, fields, repeaters, results, scanId, documentFingerprint, formFingerprint }` |
| `SMART_FILL_APPLY` | panel→content | `{ scanId, documentFingerprint, formFingerprint, fills: [{ id, value, type, fingerprint }] }` | `{ ok, results: [{ id, ok, resolvedFingerprint?, error? }] }` |
| `SMART_FILL_HIGHLIGHT` | panel→content | `{ ids, on }` | `{ ok }` |
| `SMART_FILL_CANCEL` | panel→content | `{}` | `{ ok }` |
| `SMART_FILL_PROGRESS` | content→panel（事件） | `{ index, total, id, ok, error? }` | — |

background.js 增加中继分支：SMART_FILL_* 消息在页面无监听者时注入 `fill-content.js`（复用现有 sendToTab 模式，改为可指定注入文件）。

### 4.3 规范字段字典（约 30 个，含中英文关键词）

name/phone/email/gender/birthDate/idCard/hometown/currentCity/address/postcode/school/degree/major/graduationYear/workYears/currentCompany/currentTitle/expectedCity/expectedSalary/expectedPosition/selfEvaluation/skills/languages/hobbies/availableTime/referral/github/linkedin/politicalStatus/maritalStatus/portfolio。

每个字段含中英文关键词。匹配综合 label、aria、name/id、autocomplete、placeholder、section/group、控件类型与选项；使用候选得分和 Top1/Top2 分差判定置信度。紧急联系人等负向上下文、类型冲突、值格式冲突、选项不匹配或证据不足一律置为「需手动」。规则、模板、AI 和人工 fieldKey 选择统一经过本地 `validateBinding`。

### 4.4 匹配结果

```ts
{
  fieldId: string, fieldKey: string, value: string,
  confidence: "high" | "medium" | "low" | null,
  source: "template" | "rule" | "ai" | "manual",
  status: "match" | "skip" | "manual",   // manual = 建议值缺失或类型不兼容
  reason?: string,
}
```

优先级（高→低）：用户确认 > 站点模板语义映射 > 高置信规则 > 有本地/强类型证据佐证的 AI 语义分类。AI 只返回 fieldKey，不接收简历字段值、不返回最终 value；通用 text 控件缺少本地证据时只展示 AI 建议并要求人工确认，最终值始终从当前 profile 的 ValueRef 解析并通过本地中央校验。

### 4.5 简历结构化字段（profile.resumeFields）

78 个规范字段 + 数组字段（education[]、workHistory[]、internships[]、projects[]）。本地正则负责常见字段（手机、邮箱、姓名、出生日期、院校/学历/专业等），AI 负责复杂字段与多条经历；侧边栏可编辑并重新提取。

## 5. 填充执行

- 原生控件：原型 value setter（React 兼容）+ `input`/`change`/`blur` 事件。
- `select`：设值 + change；选项缺失 → 失败「选项未找到」。
- `radio`：按值/文本匹配点击；`checkbox`：仅简历值明确布尔/命中时操作，否则跳过。
- 自定义下拉：点击容器 → 模糊匹配下拉选项文本点击 → 1.5 s 超时回退隐藏 input + 事件。
- Apply 前整批校验 tab/scanId/document/form fingerprint、字段 fingerprint 和重复 target；任何身份冲突时 0 写入并要求重扫。
- 字段间 100 ms 间隔；可取消（SMART_FILL_CANCEL）；逐字段校验“目标指纹 + 业务值”，失败字段高亮。
- 交互前仅对目标字段 `scrollIntoView`，不滚动劫持页面。

## 6. 站点模板与日志

- Template V2 key = `hostname::formFingerprint`；模板只保存 `{ fieldFingerprint, fieldKey, valueRef, pathHint, userConfirmed }` 语义映射，不保存姓名、手机号等具体值；全局上限 50 份（LRU 淘汰最旧）。
- 旧版模板不再自动套用具体值；用户可删除，成功填充后生成 V2 模板。
- 日志：`{ time, host, url, total, matched, filled, success, manual, corrections, durationMs }`，上限 200 条。

## 7. 面板 UI（新增「智能填充」tab）

- 简历选择（复用 profiles）+ 简历字段（可编辑折叠区 + 提取按钮）。
- 扫描区：当前站点判断 → 按站点申请主机权限 → 扫描 → 匹配列表（勾选、标签、类型徽标、可编辑值、置信度、来源、状态）。
- 动态经历：扫描只登记新增按钮；用户显式点击「展开简历经历」后，按简历数组目标数逐次点击并验证字段数量增长，再生成新 scanId 重扫。
- 操作：填充选中项 / 全部填充 / 停止 / 清空重扫；AI 开关（默认开）、模板自动保存开关（默认开）。
- 模板管理：当前站点模板查看/删除；历史：最近填充记录列表。
- 隐私提示：复杂字段 AI 匹配只发送表单字段标签、控件属性、选项和上下文，不发送简历字段值；重新提取简历字段仍会发送简历全文。

## 8. 权限与版本

- `manifest.json`：不新增权限，仅 bump 1.3.0。站点授权沿用 `optional_host_permissions: https://*/*` + `chrome.permissions.request`。
- `package.json`：`npm run check` 纳入 `fill-content.js` 与新增 `src/*.js`；devDependencies 增加 `jsdom`（仅测试夹具用）。

## 9. 测试验收

- 单元（node --test，TDD）：matcher 在 ≥200 条样本集（常见字段 ≥95%，总体 ≥85%）；form-fields 归一化/分类；resume-fields 提取；site-templates 套用/上限；fill-log 上限/摘要；填充计划编排。
- 集成（jsdom）：5 个网申表单夹具（智联校招 / Moka / 北森 / 大易 / Ant Design 通用表单），对真实 `fill-content.js` 脚本 eval 后跑扫描→匹配（规则层）→填充全链路，断言控件识别率 ≥90% 且填充值正确。
- 真站人工验证：`docs/智能填充真站测试手册.md`，由用户 ≥5 站执行反馈，汇总 `docs/智能填充测试报告.md`。
- 流畅度：100 ms 批处理 + 可取消 + 回读校验，无同步长任务（`while` 阻塞）。

## 10. 交付物

- 代码 + 测试 + 5 个 HTML 夹具
- `docs/superpowers/specs/2026-08-03-smart-fill-design.md`（本文件）
- `docs/superpowers/plans/2026-08-03-smart-fill.md`（实现计划）
- `docs/智能填充使用说明.md`、`docs/智能填充真站测试手册.md`、`docs/智能填充测试报告.md`
- README 功能清单更新；版本 1.3.0 + tag
