// 当前岗位：extractJob / analyze / sendJob。
import { state } from "./state.js";
import { $, send, activeTab, toast, messagePage } from "./chrome-helpers.js";
import { handleError } from "./error-handler.js";
import { ai, parseAiJson } from "./ai-client.js";
import { renderJob, renderAnalysis, renderUsage, loadLibrary } from "./render.js";
import { sanitizeGreeting } from "./pure-utils.js";
import { DEFAULT_GREETING_PROMPT, buildGreetingPrompt } from "./prompts.js";

export async function extractJob() {
  const tab = await activeTab();
  const url = new URL(tab?.url || "https://invalid.local");
  if (!/(^|\.)zhipin\.com$/.test(url.hostname)) throw new Error("未找到 BOSS 职位页。请打开职位详情或职位列表后，再点分析。");
  const response = await messagePage(tab, { type: "EXTRACT_JOB" });
  if (!response?.ok) throw new Error(response?.error || "页面读取失败");
  return response.job;
}

export async function analyze() {
  try {
    const promptField = $("jobGreetingPrompt");
    if (promptField?.value.trim()) state.jobPromptOverride = promptField.value.trim();
    $("analyze").disabled = true;
    $("analyze").textContent = "正在读取并分析…";
    state.currentJob = await extractJob();
    renderJob(state.currentJob);
    if (!state.config.candidateProfile) throw new Error("请先在设置中粘贴或解析简历内容。");
    const prompt = buildGreetingPrompt(state.jobPromptOverride || state.config.greetingPrompt || DEFAULT_GREETING_PROMPT, state.config.candidateProfile, state.currentJob);
    const aiResponse = await ai([{ role: "user", content: prompt }], 2600, true);
    const result = await parseAiJson(aiResponse.text);
    renderAnalysis(result);
    if (aiResponse.usage) renderUsage(aiResponse.usage);
    toast("已完成 JD 与简历匹配，生成招呼语");
  } catch (error) {
    handleError("分析岗位", error, toast);
  } finally {
    $("analyze").disabled = false;
    $("analyze").textContent = "分析当前岗位";
  }
}

export async function sendJob() {
  try {
    if (!state.currentJob) throw new Error("请先分析当前岗位。");
    const greeting = sanitizeGreeting($("greeting").value);
    const sourceTab = await activeTab();
    if (!sourceTab?.url) throw new Error("未找到当前岗位页。");
    // 运行时自检：发送前校验关键选择器，缺失则软提示（不阻断，用户可选择继续手动）。
    try {
      const check = await messagePage(sourceTab, { type: "SELF_CHECK" });
      if (check?.missing?.length) {
        toast(`BOSS 页面结构可能已变更（缺失：${check.missing.join("、")}），请留意或更新扩展；将继续尝试发送。`);
      }
    } catch (_) { /* 自检失败不阻断主流程 */ }
    let result = await messagePage(sourceTab, { type: "OPEN_COMMUNICATION" });
    if (!result?.ok) throw new Error(result?.error || "无法打开 BOSS 沟通页");
    toast("正在进入当前岗位沟通页…");
    const sourceTabId = sourceTab.id;
    await new Promise(resolve => setTimeout(resolve, 2200));
    const sourceAfterClick = await chrome.tabs.get(sourceTabId);
    if (!sourceAfterClick?.url?.includes("/web/geek/chat")) throw new Error("未进入 BOSS 沟通页，已停止发送，避免对错误对象发送。");
    result = await messagePage(sourceAfterClick, { type: "SEND_MESSAGE", greeting, images: state.uploadedImages });
    if (!result?.ok) throw new Error(result?.error || "发送失败");
    const record = { ...state.currentJob, greeting, status: "已沟通", sentAt: new Date().toLocaleString("zh-CN"), resumeStatus: result.resume?.sent ? "简历图片已确认送达" : (result.resume?.reason || "未发送") };
    await send({ type: "SAVE_JOB", job: record });
    await chrome.tabs.goBack(sourceTabId);
    toast(result.resume?.sent ? "招呼语和简历图片均已确认送达，已恢复原岗位页" : "招呼语已确认送达并恢复原岗位页");
    loadLibrary();
  } catch (error) {
    handleError("确认沟通并发送", error, toast);
  }
}
