// 批量 AI 匹配与投递控制模块（筛选器化）：
// 只做「扫描列表 + 阈值筛选」，入选岗位写入投递清单（status=待生成，绑定 activeProfile）；
// 招呼语生成与投递复用 queue.js 的 generateQueue/startQueue。
import { state, activeProfile } from "./state.js";
import { $, toast, activeTab, send } from "./chrome-helpers.js";
import { ai, parseAiJson } from "./ai-client.js";
import { buildBatchMatchPrompt } from "./prompts.js";
import { generateQueue, startQueue } from "./queue.js";
import { loadQueue } from "./render.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_QUEUE_ITEMS = 20;            // 与 background 的投递清单上限一致
const MAX_SELECT_FAILURES = 3;         // 连续选中失败熔断阈值

// —— 纯函数（无 chrome/DOM 依赖，Node 可测） ——

// AI 返回的匹配结果规范化：score clamp 0-100 取整；reasoning 缺省文案；score 非数字视为失败。
export function sanitizeMatch(raw) {
  const score = Number(raw?.score);
  if (!Number.isFinite(score)) throw new Error("AI 未返回有效匹配分");
  return {
    score: Math.max(0, Math.min(100, Math.round(score))),
    reasoning: String(raw?.reasoning || "").trim() || "未返回分析结论",
  };
}

// 跨投递清单 / 已沟通历史 / 岗位库做语义去重：jobId 优先，title+company 兜底；URL 归一化去 query 与尾斜杠。
export function isDuplicateJob(job, { deliveryQueue = [], recentDeliveries = [], jobLibrary = [] } = {}) {
  const normalizeUrl = (url) => (url || "").split("?")[0].replace(/\/+$/, "");
  const jobKey = job.jobId || normalizeUrl(job.detailUrl);
  const match = (item) => {
    const itemKey = item.jobId || normalizeUrl(item.detailUrl);
    return (jobKey && itemKey && jobKey === itemKey) ||
      (job.title === item.title && job.company === item.company);
  };
  return deliveryQueue.some(match) || recentDeliveries.some(match) || jobLibrary.some(match);
}

// 批量筛选汇总文案。
export function buildBatchSummary({ scanned, added, lowScore, duplicate, failed }) {
  return `批量匹配完成！共扫描 ${scanned} 个岗位：匹配 ${added}、低分跳过 ${lowScore}、去重跳过 ${duplicate}、失败 ${failed}。`;
}

// —— 运行状态与 UI ——

let isBatchRunning = false;
let batchStopped = false; // 用户停止或熔断触发；循环结束后据此输出停止态汇总

export function isBatchMatching() {
  return isBatchRunning;
}

export function setBatchMatchingState(running) {
  isBatchRunning = running;
  const startBtn = $("startBatchMatch");
  const stopBtn = $("stopBatchMatch");
  if (startBtn) startBtn.disabled = running;
  if (stopBtn) {
    stopBtn.disabled = !running;
    stopBtn.hidden = !running; // 运行中显示停止按钮
  }
}

function updateProgressUI(current, total, statusText) {
  const box = $("batchProgressBox");
  if (box) box.classList.remove("hidden"); // 首次更新即显示进度区
  const currentCountEl = $("batchCurrentCount");
  const totalCountEl = $("batchTotalCount");
  const progressFillEl = $("batchProgressFill");
  const statusEl = $("batchStatusText");

  if (currentCountEl) currentCountEl.textContent = current;
  if (totalCountEl) totalCountEl.textContent = total;
  if (progressFillEl) {
    const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;
    progressFillEl.style.width = `${percent}%`;
  }
  if (statusEl) statusEl.textContent = statusText;
}

// 请求停止：置位停止标记并让循环在边界退出（进行中的 AI 请求无法中断）。
export async function stopBatchMatch() {
  if (!isBatchRunning) return;
  batchStopped = true;
  isBatchRunning = false;
  toast("已请求停止批量 AI 匹配，当前岗位完成后停止");
}

// 单岗位 AI 筛选：轻量 prompt 只输出 score+reasoning；失败重试 1 次。
async function matchJob(job) {
  const prompt = buildBatchMatchPrompt(
    state.config.greetingPrompt,
    state.config.candidateProfile,
    job
  );
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const rawRes = await ai([{ role: "user", content: prompt }], 800, true);
      const data = await parseAiJson(rawRes.text);
      return sanitizeMatch(data);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("AI 匹配失败");
}

export async function startBatchMatch() {
  if (isBatchRunning) {
    toast("批量匹配任务正在运行中...");
    return;
  }

  // 前置校验：AI Key / 简历内容 / 当前简历（对齐 generateQueue 的校验）
  if (!state.config.apiKey) {
    toast("请先在设置中填写 AI API Key。");
    return;
  }
  if (!state.config.candidateProfile) {
    toast("请先在设置中粘贴或解析简历内容。");
    return;
  }
  const profile = activeProfile();
  if (!profile) {
    toast("未找到当前简历，请在设置中重新选择。");
    return;
  }

  let tab;
  try {
    tab = await activeTab();
  } catch (e) {
    toast("未找到活动的标签页");
    return;
  }

  if (!tab?.url || !/(^|\.)zhipin\.com$/.test(new URL(tab.url).hostname) || !tab.url.includes("/web/geek/jobs")) {
    toast("请在 BOSS 直聘职位列表页（/web/geek/jobs）使用批量匹配功能。");
    return;
  }

  const targetCountInput = $("batchCountInput");
  const thresholdInput = $("batchThresholdInput");
  const autoSendCheck = $("batchAutoSendCheck");

  const inputCount = parseInt(targetCountInput?.value || "10", 10);
  const threshold = parseInt(thresholdInput?.value || "75", 10);
  const autoSend = autoSendCheck ? autoSendCheck.checked : false;

  if (isNaN(inputCount) || inputCount <= 0) {
    toast("请输入有效的扫描数量");
    return;
  }
  if (isNaN(threshold) || threshold < 0 || threshold > 100) {
    toast("请输入 0-100 之间的匹配阈值");
    return;
  }

  // 队列容量对齐：投递清单最多保留 20 条待处理岗位，避免后半程 QUEUE_ADD 全失败。
  const queueRes = await send({ type: "QUEUE_GET" });
  const deliveryQueue = queueRes?.queue || [];
  const recentDeliveries = queueRes?.recentDeliveries || [];
  const storedLib = await chrome.storage.local.get("jobLibrary");
  const jobLibrary = storedLib.jobLibrary || [];

  const avail = Math.max(0, MAX_QUEUE_ITEMS - deliveryQueue.length);
  if (avail <= 0) {
    toast(`投递清单已满（最多 ${MAX_QUEUE_ITEMS} 条），请先清理后再批量匹配。`);
    return;
  }
  const targetCount = Math.min(inputCount, avail);
  if (targetCount < inputCount) {
    updateProgressUI(0, targetCount, `投递清单剩余容量 ${avail} 条，本次实际扫描 ${targetCount} 个岗位`);
  }

  batchStopped = false;
  setBatchMatchingState(true);
  updateProgressUI(0, targetCount, "正在从页面获取岗位列表...");

  // 1. 获取列表岗位索引
  let scanRes;
  try {
    scanRes = await chrome.tabs.sendMessage(tab.id, { type: "SCAN_LIST_JOBS" });
  } catch (err) {
    setBatchMatchingState(false);
    toast("无法读取页面岗位列表，请刷新 BOSS 列表页后再试。");
    return;
  }

  if (!scanRes?.ok || !scanRes.jobs || scanRes.jobs.length === 0) {
    setBatchMatchingState(false);
    updateProgressUI(0, targetCount, "列表无可用岗位，请确认页面已加载。");
    toast("未找到可扫描的岗位列表项");
    return;
  }

  const listJobs = scanRes.jobs;
  const addedKeys = [];
  let addedCount = 0;
  let lowScoreCount = 0;
  let duplicateCount = 0;
  let failedCount = 0;
  let scannedCount = 0;
  let scannedIndex = 0;
  let consecutiveSelectFailures = 0;

  while (isBatchRunning && scannedIndex < listJobs.length && scannedIndex < targetCount) {
    const currentListJob = listJobs[scannedIndex];
    const jobDisplayName = `岗位「${currentListJob.title || "未知"}@${currentListJob.company || "未知"}」`;

    updateProgressUI(scannedIndex + 1, targetCount, `[${scannedIndex + 1}/${targetCount}] 正在切换至${jobDisplayName}...`);

    // 2. 选中列表中第 N 项并等待完整 JD 加载（content 端轮询核验）
    let selectRes;
    try {
      selectRes = await chrome.tabs.sendMessage(tab.id, { type: "SELECT_LIST_JOB", index: scannedIndex });
    } catch (err) {
      console.error(`[猎投] 切换岗位 ${scannedIndex} 失败`, err);
    }

    if (!isBatchRunning) break;
    scannedCount++;

    if (!selectRes?.ok || !selectRes.job) {
      consecutiveSelectFailures++;
      failedCount++;
      updateProgressUI(
        scannedIndex + 1,
        targetCount,
        `[${scannedIndex + 1}/${targetCount}] ${jobDisplayName} 内容获取失败：${selectRes?.reason || "未知原因"}，跳过`
      );
      scannedIndex++;
      if (consecutiveSelectFailures >= MAX_SELECT_FAILURES) {
        batchStopped = true;
        updateProgressUI(
          scannedIndex,
          targetCount,
          `连续 ${MAX_SELECT_FAILURES} 次获取失败，已自动停止以保护页面状态`
        );
        break;
      }
      await sleep(600);
      continue;
    }
    consecutiveSelectFailures = 0;
    const fullJob = selectRes.job;

    // 3. 去重检查
    if (isDuplicateJob(fullJob, { deliveryQueue, recentDeliveries, jobLibrary })) {
      duplicateCount++;
      updateProgressUI(scannedIndex + 1, targetCount, `[${scannedIndex + 1}/${targetCount}] ${jobDisplayName} 已投递/在清单中，去重跳过`);
      scannedIndex++;
      await sleep(600);
      continue;
    }

    // 4. 调用 AI 评估匹配分（轻量：只出 score+reasoning）
    updateProgressUI(scannedIndex + 1, targetCount, `[${scannedIndex + 1}/${targetCount}] AI 正在评估${jobDisplayName}...`);

    let match;
    try {
      match = await matchJob(fullJob);
    } catch (aiErr) {
      console.error(`[猎投] AI 匹配${jobDisplayName}失败:`, aiErr);
    }

    if (!isBatchRunning) break;

    // 5. 判断阈值分（AI 失败与低分区分展示，避免误导）
    if (!match) {
      failedCount++;
      updateProgressUI(scannedIndex + 1, targetCount, `[${scannedIndex + 1}/${targetCount}] ${jobDisplayName} AI 匹配失败，已跳过`);
    } else if (match.score < threshold) {
      lowScoreCount++;
      updateProgressUI(
        scannedIndex + 1,
        targetCount,
        `[${scannedIndex + 1}/${targetCount}] ${jobDisplayName} 匹配分 ${match.score}分 < 阈值${threshold}分（${match.reasoning}），已跳过`
      );
    } else {
      // 6. 达到或超过阈值，加入投递清单（不携带 greeting → 后台置 status=待生成，绑定当前简历）
      const queueItem = {
        title: fullJob.title,
        company: fullJob.company,
        salary: fullJob.salary || "",
        location: fullJob.location || "",
        detailUrl: fullJob.detailUrl || fullJob.url,
        jobId: fullJob.jobId,
        description: fullJob.description,
        matchScore: match.score,
        matchReasoning: match.reasoning,
        profileName: profile.name,
      };

      const addRes = await send({ type: "QUEUE_ADD", job: queueItem });
      await loadQueue();
      if (addRes?.ok) {
        addedCount++;
        if (addRes.item?.key) addedKeys.push(addRes.item.key);
        updateProgressUI(
          scannedIndex + 1,
          targetCount,
          `[${scannedIndex + 1}/${targetCount}] ${jobDisplayName} 匹配分 ${match.score}分 >= 阈值${threshold}分，已纳入投递清单`
        );
      } else {
        failedCount++;
        updateProgressUI(
          scannedIndex + 1,
          targetCount,
          `[${scannedIndex + 1}/${targetCount}] ${jobDisplayName} 加入清单失败: ${addRes?.error || "未知原因"}`
        );
      }
    }

    scannedIndex++;
    if (scannedIndex < targetCount && isBatchRunning) {
      await sleep(1200); // 避免频繁请求 AI
    }
  }

  setBatchMatchingState(false);

  const summary = batchStopped
    ? `批量匹配已停止（已扫描 ${scannedCount} 个岗位）：匹配 ${addedCount}、低分跳过 ${lowScoreCount}、去重跳过 ${duplicateCount}、失败 ${failedCount}。`
    : buildBatchSummary({ scanned: scannedCount, added: addedCount, lowScore: lowScoreCount, duplicate: duplicateCount, failed: failedCount });
  updateProgressUI(scannedCount, targetCount, summary);
  toast(summary);

  // 7. 自动投递（默认关闭）：确认门 → 选中新增岗位 → 复用 generateQueue/startQueue
  if (!batchStopped && autoSend && addedCount > 0) {
    const confirmed = confirm(`已匹配 ${addedCount} 个岗位，将自动生成招呼语并投递，确认？`);
    if (confirmed) {
      toast("正在自动生成招呼语并投递，请查看投递清单进度...");
      state.selectedQueueKeys = new Set(addedKeys);
      await generateQueue();
      await startQueue();
    } else {
      toast("已保留筛选结果，可在「投递清单」中手动生成招呼语并投递");
    }
  }
}