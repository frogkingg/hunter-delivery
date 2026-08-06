// 批量 AI 匹配与投递控制模块
import { state } from "./state.js";
import { $, toast, activeTab, send } from "./chrome-helpers.js";
import { ai } from "./ai-client.js";
import { buildBatchMatchPrompt } from "./prompts.js";
import { startQueue } from "./queue.js";
import { loadQueue } from "./render.js";

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

let isBatchRunning = false;

export function isBatchMatching() {
  return isBatchRunning;
}

export function setBatchMatchingState(running) {
  isBatchRunning = running;
  const startBtn = $("startBatchMatch");
  const stopBtn = $("stopBatchMatch");
  if (startBtn) startBtn.disabled = running;
  if (stopBtn) stopBtn.disabled = !running;
}

function updateProgressUI(current, total, statusText) {
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

export async function stopBatchMatch() {
  if (!isBatchRunning) return;
  isBatchRunning = false;
  setBatchMatchingState(false);
  updateProgressUI(0, 0, "用户手动中途停止了批量匹配。");
  toast("已请求停止批量 AI 匹配");
}

export async function startBatchMatch() {
  if (isBatchRunning) {
    toast("批量匹配任务正在运行中...");
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

  const targetCount = parseInt(targetCountInput?.value || "10", 10);
  const threshold = parseInt(thresholdInput?.value || "75", 10);
  const autoSend = autoSendCheck ? autoSendCheck.checked : true;

  if (isNaN(targetCount) || targetCount <= 0) {
    toast("请输入有效的扫描数量");
    return;
  }
  if (isNaN(threshold) || threshold < 0 || threshold > 100) {
    toast("请输入 0-100 之间的匹配阈值");
    return;
  }

  // 获取去重校验数据：已投递岗位库 (jobLibrary) 与 当前投递清单 (deliveryQueue)
  const queueRes = await send({ type: "QUEUE_GET" });
  const deliveryQueue = queueRes?.queue || [];
  const recentDeliveries = queueRes?.recentDeliveries || [];
  const storedLib = await chrome.storage.local.get("jobLibrary");
  const jobLibrary = storedLib.jobLibrary || [];

  const isDuplicateJob = (job) => {
    const normalizeUrl = (url) => (url || "").split("?")[0].replace(/\/+$/, "");
    const jobKey = job.jobId || normalizeUrl(job.detailUrl);
    
    // 校验队列
    const inQueue = deliveryQueue.some(item => {
      const itemKey = item.jobId || normalizeUrl(item.detailUrl);
      return (jobKey && itemKey && jobKey === itemKey) || (job.title === item.title && job.company === item.company);
    });
    if (inQueue) return true;

    // 校验已沟通/已投递历史
    const inRecent = recentDeliveries.some(item => {
      const itemKey = item.jobId || normalizeUrl(item.detailUrl);
      return (jobKey && itemKey && jobKey === itemKey) || (job.title === item.title && job.company === item.company);
    });
    if (inRecent) return true;

    const inLibrary = jobLibrary.some(item => {
      const itemKey = item.jobId || normalizeUrl(item.detailUrl);
      return (jobKey && itemKey && jobKey === itemKey) || (job.title === item.title && job.company === item.company);
    });
    return inLibrary;
  };

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
  let addedCount = 0;
  let scannedIndex = 0;

  while (isBatchRunning && scannedIndex < listJobs.length && scannedIndex < targetCount) {
    const currentIndex = scannedIndex;
    const currentListJob = listJobs[currentIndex];
    const jobDisplayName = `岗位「${currentListJob.title || "未知"}@${currentListJob.company || "未知"}」`;

    updateProgressUI(scannedIndex + 1, targetCount, `[${scannedIndex + 1}/${targetCount}] 正在切换至${jobDisplayName}...`);

    // 2. 选中列表中第 N 项并提取完整 JD
    let selectRes;
    try {
      selectRes = await chrome.tabs.sendMessage(tab.id, { type: "SELECT_LIST_JOB", index: currentIndex });
    } catch (err) {
      console.error(`[猎投] 切换岗位 ${currentIndex} 失败`, err);
    }

    if (!isBatchRunning) break;

    const fullJob = selectRes?.ok ? selectRes.job : null;

    if (!fullJob || (!fullJob.description && !fullJob.title)) {
      updateProgressUI(scannedIndex + 1, targetCount, `[${scannedIndex + 1}/${targetCount}] ${jobDisplayName} 内容获取失败，跳过`);
      scannedIndex++;
      await new Promise(r => setTimeout(r, 600));
      continue;
    }

    // 3. 去重检查
    if (isDuplicateJob(fullJob)) {
      updateProgressUI(scannedIndex + 1, targetCount, `[${scannedIndex + 1}/${targetCount}] ${jobDisplayName} 已投递/在清单中，去重跳过`);
      scannedIndex++;
      await new Promise(r => setTimeout(r, 600));
      continue;
    }

    // 4. 调用 AI 联合评估匹配分与招呼语
    updateProgressUI(scannedIndex + 1, targetCount, `[${scannedIndex + 1}/${targetCount}] AI 正在评估${jobDisplayName}...`);

    let matchResult;
    try {
      const prompt = buildBatchMatchAndGreetingPrompt(state.config.greetingPrompt, state.config.candidateProfile, fullJob);
      const rawRes = await ai([{ role: "user", content: prompt }]);
      const jsonMatch = rawRes.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        matchResult = JSON.parse(jsonMatch[0]);
      }
    } catch (aiErr) {
      console.error(`[猎投] AI 匹配${jobDisplayName}失败:`, aiErr);
    }

    if (!isBatchRunning) break;

    const score = typeof matchResult?.score === "number" ? matchResult.score : 0;
    const reasoning = matchResult?.reasoning || "未返回分析结论";
    const greetings = Array.isArray(matchResult?.greetings) ? matchResult.greetings : [];
    const selectedGreeting = greetings[0]?.text || `您好，我对${fullJob.title}岗位很感兴趣。`;

    // 5. 判断阈值分
    if (score < threshold) {
      updateProgressUI(
        scannedIndex + 1,
        targetCount,
        `[${scannedIndex + 1}/${targetCount}] ${jobDisplayName} 匹配分 ${score}分 < 阈值${threshold}分（${reasoning}），已跳过`
      );
    } else {
      // 6. 达到或超过阈值，加入投递清单
      const queueItem = {
        title: fullJob.title,
        company: fullJob.company,
        salary: fullJob.salary || "",
        location: fullJob.location || "",
        detailUrl: fullJob.detailUrl || fullJob.url,
        jobId: fullJob.jobId,
        description: fullJob.description,
        greeting: selectedGreeting,
        matchScore: score,
        matchReasoning: reasoning,
        profileName: state.currentProfileName || "标准简历",
        greetings: greetings,
      };

      const addRes = await send({ type: "QUEUE_ADD", job: queueItem });
        await loadQueue();
      if (addRes?.ok) {
        addedCount++;
        updateProgressUI(
          scannedIndex + 1,
          targetCount,
          `[${scannedIndex + 1}/${targetCount}] ${jobDisplayName} 匹配分 ${score}分 >= 阈值${threshold}分，已纳入投递清单`
        );
      } else {
        updateProgressUI(
          scannedIndex + 1,
          targetCount,
          `[${scannedIndex + 1}/${targetCount}] ${jobDisplayName} 加入清单失败: ${addRes?.error || "未知原因"}`
        );
      }
    }

    scannedIndex++;
    if (scannedIndex < targetCount && isBatchRunning) {
      await new Promise(r => setTimeout(r, 1200)); // 避免频繁请求 AI
    }
  }

  const wasRunning = isBatchRunning;
  setBatchMatchingState(false);

  if (wasRunning) {
    const summaryMsg = `批量匹配完成！共扫描 ${scannedIndex} 个岗位，符合阈值的 ${addedCount} 个岗已加入清单。`;
    updateProgressUI(scannedIndex, targetCount, summaryMsg);
    toast(summaryMsg);

    // 自动启动批量打招呼
    if (autoSend && addedCount > 0) {
      toast("正在自动启动批量投递...");
      await new Promise(r => setTimeout(r, 1000));
      await startQueue();
    }
  }
}