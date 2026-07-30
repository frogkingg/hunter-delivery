// 队列 UI 逻辑：addCurrentToQueue / removeSelectedQueue / toggleSelectAll /
// generateQueue / startQueue / startQueuePolling。
import { state } from "./state.js";
import { $, send, toast } from "./chrome-helpers.js";
import { handleError } from "./error-handler.js";
import { ai, parseAiJson } from "./ai-client.js";
import { renderJob, loadQueue } from "./render.js";
import { extractJob } from "./current-job.js";
import { DEFAULT_GREETING_PROMPT, buildBatchGreetingPrompt } from "./prompts.js";

export async function addCurrentToQueue() {
  try {
    const job = await extractJob();
    state.currentJob = job;
    renderJob(job);
    const response = await send({ type: "QUEUE_ADD", job });
    if (!response?.ok) throw new Error(response?.error || "加入清单失败");
    toast("已加入投递清单，当前岗位信息已刷新");
    loadQueue();
  } catch (error) {
    handleError("加入投递清单", error, toast);
  }
}

export async function removeSelectedQueue() {
  const button = $("removeSelected");
  try {
    const keys = [...state.selectedQueueKeys];
    if (!keys.length) throw new Error("请先勾选要移出的岗位。");
    button.disabled = true; button.textContent = "正在移除…";
    const result = await send({ type: "QUEUE_REMOVE_MANY", keys });
    const removedCount = Number(result?.removedCount || 0);
    if (!result?.ok || removedCount !== keys.length) throw new Error(`实际移出 ${removedCount}/${keys.length} 个岗位，请刷新后重试。`);
    state.selectedQueueKeys.clear();
    toast(`已移出 ${removedCount} 个岗位`);
    await loadQueue();
  } catch (error) {
    handleError("移除所选岗位", error, (msg) => toast(`移除失败：${msg}`));
    await loadQueue().catch(() => {});
  }
}

export async function toggleSelectAll() {
  try {
    const response = await send({ type: "QUEUE_GET" });
    const queue = response?.queue || [];
    if (!queue.length) return;
    if (state.selectedQueueKeys.size === queue.length) {
      state.selectedQueueKeys.clear();
      toast("已取消全选");
    } else {
      state.selectedQueueKeys = new Set(queue.map(item => item.key));
      toast(`已全选 ${queue.length} 个岗位`);
    }
    await loadQueue();
  } catch (error) {
    handleError("全选岗位", error, (msg) => toast(`全选失败：${msg}`));
  }
}

export function startQueuePolling() {
  const poll = async () => {
    try {
      const response = await loadQueue();
      if (state.queueWasRunning && !response?.running) {
        state.queuePollTimer = null;
        toast("本轮投递已结束，请查看每个岗位的成功或失败状态。");
        return;
      }
      state.queueWasRunning = !!response?.running;
      state.queuePollTimer = setTimeout(poll, 1000);
    } catch (error) {
      state.queuePollTimer = null;
      handleError("刷新投递状态", error, (msg) => toast(`无法刷新投递状态：${msg}`));
    }
  };
  clearTimeout(state.queuePollTimer);
  state.queuePollTimer = setTimeout(poll, 1000);
}

export async function generateQueue() {
  const button = $("generateQueue");
  const originalText = button.textContent;
  try {
    if (!state.config.candidateProfile) throw new Error("请先在设置中粘贴或解析简历内容。");
    const response = await send({ type: "QUEUE_GET" });
    const items = (response?.queue || []).filter(item => !["投递中", "已成功"].includes(item.status));
    if (!items.length) throw new Error("清单中没有可生成的岗位。");
    button.disabled = true;
    let success = 0;
    const failures = [];
    for (let index = 0; index < items.length; index++) {
      const item = items[index];
      button.textContent = `正在生成 ${index + 1}/${items.length}`;
      await send({ type: "QUEUE_UPDATE", key: item.key, patch: { status: "生成中", progress: `正在生成第 ${index + 1}/${items.length} 条`, error: "", rawAiResponse: "" } });
      await loadQueue();
      try {
        const prompt = buildBatchGreetingPrompt(state.config.greetingPrompt || DEFAULT_GREETING_PROMPT, state.config.candidateProfile, item);
        const aiResponse = await ai([{ role: "user", content: prompt }], 1600, true);
        const data = await parseAiJson(aiResponse.text);
        const greeting = data.greetings?.[0]?.text || data.greeting || "";
        if (!greeting) throw new Error("AI 没有返回招呼语");
        const saved = await send({ type: "QUEUE_UPDATE", key: item.key, patch: { greeting, status: "待投递", progress: "已生成，等待开始批量投递", error: "", rawAiResponse: "" } });
        if (!saved?.ok) throw new Error(saved?.error || "保存生成结果失败");
        success++;
      } catch (error) {
        failures.push(item.title);
        await send({ type: "QUEUE_UPDATE", key: item.key, patch: { status: "生成失败", progress: "", error: error.message || String(error), rawAiResponse: error.rawResponse || "" } });
      }
      await loadQueue();
    }
    toast(failures.length ? `已生成 ${success} 条；${failures.length} 条失败，可展开岗位查看 AI 原始返回后重试。` : `已生成 ${success} 条招呼语，现在可直接点击“开始投递”。`);
  } catch (error) {
    handleError("批量生成招呼语", error, (msg) => toast(`批量生成未开始：${msg}`));
  } finally {
    button.disabled = false;
    button.textContent = originalText;
    await loadQueue().catch(() => {});
  }
}

export async function startQueue() {
  const button = $("startQueue");
  const originalText = button.textContent;
  try {
    const before = await send({ type: "QUEUE_GET" });
    if (before?.running) {
      state.queueWasRunning = true;
      button.disabled = true;
      button.textContent = "正在投递，请查看岗位状态…";
      await loadQueue();
      startQueuePolling();
      toast("投递正在进行中，已开始刷新每个岗位的实时进度。");
      return;
    }
    const count = (before?.queue || []).filter(item => ["待投递", "待确认"].includes(item.status)).length;
    if (!count) throw new Error("还没有生成成功的岗位。请先点击“批量生成招呼语”。");
    button.disabled = true;
    button.textContent = `正在启动 ${count} 个岗位…`;
    toast(`正在启动 ${count} 个岗位的投递，请留在此页面查看状态。`);
    const response = await send({ type: "QUEUE_START" });
    if (!response?.ok) throw new Error(response?.error || "无法开始投递");
    state.queueWasRunning = true;
    await loadQueue();
    startQueuePolling();
    toast(response.alreadyRunning ? "投递正在进行中，已开始刷新实时进度。" : `投递已开始：共 ${response.count || count} 个岗位，状态会自动刷新。`);
  } catch (error) {
    handleError("开始投递", error, (msg) => toast(`未开始投递：${msg}`));
    button.disabled = false;
    button.textContent = originalText;
    await loadQueue().catch(() => {});
  }
}
