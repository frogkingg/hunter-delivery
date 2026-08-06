// 当前岗位：extractJob / analyze / sendJob。
import { state } from "./state.js";
import { $, send, activeTab, toast, messagePage } from "./chrome-helpers.js";
import { handleError } from "./error-handler.js";
import { aiStreamResponse, parseAiJson } from "./ai-client.js";
import { renderJob, renderAnalysis, renderUsage, loadLibrary } from "./render.js";
import { sanitizeGreeting } from "./pure-utils.js";
import { DEFAULT_GREETING_PROMPT, buildGreetingPrompt } from "./prompts.js";

function jobKey(job) {
  return job?.jobId || job?.detailUrl || [job?.company, job?.title, job?.location].filter(Boolean).join("|");
}

export function resolveJobPromptOverride(previousJob, nextJob, requestedOverride) {
  const previousJobKey = jobKey(previousJob);
  return previousJobKey && previousJobKey === jobKey(nextJob) ? String(requestedOverride || "").trim() : "";
}

export async function extractJob() {
  const tab = await activeTab();
  const url = new URL(tab?.url || "https://invalid.local");
  if (!/(^|\.)zhipin\.com$/.test(url.hostname)) throw new Error("未找到 BOSS 职位页。请打开职位详情或职位列表后，再点分析。");
  const response = await messagePage(tab, { type: "EXTRACT_JOB" });
  if (!response?.ok) throw new Error(response?.error || "页面读取失败");
  return response.job;
}

async function waitForCommunicationReady(tabId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const tab = await chrome.tabs.get(tabId);
      const response = await messagePage(tab, { type: "PREPARE_COMMUNICATION" });
      if (response?.blocked) throw new Error(response.reason || "检测到 BOSS 安全验证，请手动处理后重试。");
      if (response?.ready) return { tab, mode: response.mode || "unknown" };
      if (!response?.ok) lastError = response?.error || "页面尚未准备好";
    } catch (error) {
      if (/安全验证|操作限制/.test(error.message || "")) throw error;
      lastError = error.message || String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 400));
  }
  throw new Error(`未能进入可发送状态。${lastError ? `最后状态：${lastError}。` : ""}请检查 BOSS 页面是否出现验证或沟通弹层。`);
}

// 分析完成后高亮「确认沟通并发送」，引导用户完成投递（不自动发送）。
function highlightSendButton() {
  const sendBtn = $("send");
  if (!sendBtn) return;
  sendBtn.classList.add("highlight-send");
  sendBtn.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => sendBtn.classList.remove("highlight-send"), 3000);
}

export async function analyze() {
  let progressTimer = null;
  let completed = false;
  try {
    const promptField = $("jobGreetingPrompt");
    const requestedOverride = promptField?.value.trim() || "";
    const button = $("analyze");
    const progressEl = $("analyzeProgress");
    button.disabled = true;
    button.textContent = "正在生成…";
    if (progressEl) progressEl.textContent = "正在读取岗位…";
    const nextJob = await extractJob();
    state.jobPromptOverride = resolveJobPromptOverride(state.currentJob, nextJob, requestedOverride);
    state.currentJob = nextJob;
    renderJob(state.currentJob);
    if (!state.config.candidateProfile) throw new Error("请先在设置中粘贴或解析简历内容。");
    const prompt = buildGreetingPrompt(state.jobPromptOverride || state.config.greetingPrompt || DEFAULT_GREETING_PROMPT, state.config.candidateProfile, state.currentJob);
    const startedAt = Date.now();
    let receivedChars = 0;
    let phase = "正在分析岗位与简历";
    // 字数/耗时/阶段写入按钮下方进度行，避免长文本把按钮撑成两行。
    const renderProgress = () => {
      const seconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
      if (progressEl) progressEl.textContent = receivedChars
        ? `正在生成 · 已接收 ${receivedChars} 字 · ${seconds} 秒`
        : `${phase} · ${seconds} 秒`;
    };
    progressTimer = setInterval(renderProgress, 500);
    renderProgress();
    const aiResponse = await aiStreamResponse(
      [{ role: "user", content: prompt }],
      4000,
      (text) => {
        receivedChars = text.length;
        phase = "正在生成招呼语";
      },
      {
        jsonMode: true,
        onProgress: ({ phase: nextPhase }) => {
          if (nextPhase === "reasoning") phase = "正在分析岗位与简历";
          if (nextPhase === "retrying") phase = "首次响应为空，正在重试";
        },
      }
    );
    const result = await parseAiJson(aiResponse.text);
    renderAnalysis(result);
    if (aiResponse.usage) renderUsage(aiResponse.usage);
    completed = true;
    if (progressEl) progressEl.textContent = "分析完成，请确认招呼语后点击“确认沟通并发送”。";
    toast("已完成 JD 与简历匹配，生成招呼语");
    highlightSendButton();
  } catch (error) {
    handleError("分析岗位", error, toast);
  } finally {
    clearInterval(progressTimer);
    $("analyze").disabled = false;
    $("analyze").textContent = "分析当前岗位并投递";
    if (!completed) {
      const progressEl = $("analyzeProgress");
      if (progressEl) progressEl.textContent = "";
    }
  }
}

export async function sendJob() {
  const button = $("send");
  if (state.sendJobInFlight) { toast("正在发送中，请勿重复点击。"); return; }
  state.sendJobInFlight = true;
  if (button) button.disabled = true;
  let lockSend = false; // 消息已送达但本地归档失败时保持禁用，防止重复发送
  try {
    if (!state.currentJob) throw new Error("请先分析当前岗位。");
    const greeting = sanitizeGreeting($("greeting").value);
    const sourceTab = await activeTab();
    if (!sourceTab?.url) throw new Error("未找到当前岗位页。");
    const sourceUrl = sourceTab.url;
    // 发送前硬核验目标岗位与当前分析一致（与批量链路 VERIFY_JOB 对齐），
    // 避免用户分析完岗位 A、切到岗位 B 后把 A 的招呼语发进 B 的会话。
    const verify = await messagePage(sourceTab, { type: "VERIFY_JOB", job: state.currentJob });
    if (!verify?.ok) throw new Error(`岗位核验失败：${verify?.reason || "页面岗位与当前分析不一致，请重新分析后再发送。"}`);
    let result = await messagePage(sourceTab, { type: "OPEN_COMMUNICATION" });
    if (!result?.ok) throw new Error(result?.error || "无法打开 BOSS 沟通页");
    toast("正在处理 BOSS 沟通弹层并等待聊天输入框…");
    const sourceTabId = sourceTab.id;
    const communication = await waitForCommunicationReady(sourceTabId);
    try {
      const check = await messagePage(communication.tab, { type: "SELF_CHECK", requireImages: !!state.uploadedImages.length });
      if (check?.missing?.length) {
        toast(`BOSS 页面结构可能已变更（缺失：${check.missing.join("、")}），将继续尝试发送。`);
      }
    } catch (_) { /* 自检失败不阻断主流程 */ }
    result = await messagePage(communication.tab, { type: "SEND_MESSAGE", greeting, images: state.uploadedImages });
    if (!result?.ok) throw new Error(result?.error || "发送失败");
    const record = { ...state.currentJob, greeting, status: "已沟通", sentAt: new Date().toLocaleString("zh-CN"), resumeStatus: result.resume?.sent ? "简历图片已确认送达" : (result.resume?.reason || "未发送") };
    const saved = await send({ type: "SAVE_JOB", job: record });
    if (!saved?.ok) {
      lockSend = true;
      $("send").disabled = true;
      throw new Error(`消息已确认送达，但本地投递记录保存失败：${saved?.error || "未知错误"}。为避免重复发送，本页面已禁用再次发送。`);
    }
    const sourceAfterSend = await chrome.tabs.get(sourceTabId);
    const shouldRestore = sourceAfterSend?.url?.includes("/web/geek/chat") && sourceAfterSend.url !== sourceUrl;
    if (shouldRestore) await chrome.tabs.goBack(sourceTabId);
    const restoreText = shouldRestore ? "，已恢复原岗位页" : "";
    toast(result.resume?.sent ? `招呼语和简历图片均已确认送达${restoreText}` : `招呼语已确认送达${restoreText}`);
    loadLibrary();
  } catch (error) {
    handleError("确认沟通并发送", error, toast);
  } finally {
    state.sendJobInFlight = false;
    if (button && !lockSend) button.disabled = false;
  }
}