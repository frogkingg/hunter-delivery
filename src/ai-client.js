// AI 调用：ai / parseAiJson / aiStream。
import { state } from "./state.js";
import { send } from "./chrome-helpers.js";
import { persistConfig, ensureAiConsent } from "./config.js";

export async function ai(messages, maxTokens, jsonMode = false) {
  await persistConfig(false);
  if (!state.config.apiKey) throw new Error("请先在设置中填写 AI API Key。");
  await ensureAiConsent();
  const response = await send({ type: "AI_CALL", payload: { config: state.config, messages, maxTokens, jsonMode } });
  if (!response?.ok) {
    const error = new Error(response?.error || "AI 请求失败");
    error.rawResponse = String(response?.rawResponse || "").slice(0, 20000);
    throw error;
  }
  return response;
}

// 流式 AI 调用：返回完整文本与 usage；界面可订阅累计文本和阶段进度。
export function aiStreamResponse(messages, maxTokens, onDelta, options = {}) {
  return new Promise((resolve, reject) => {
    (async () => {
      await persistConfig(false);
      if (!state.config.apiKey) throw new Error("请先在设置中填写 AI API Key。");
      await ensureAiConsent();
      const port = chrome.runtime.connect({ name: "AI_CALL_STREAM" });
      let settled = false;
      port.onMessage.addListener((message) => {
        if (message.type === "DELTA") {
          if (!settled && typeof onDelta === "function") onDelta(message.text);
        } else if (message.type === "PROGRESS") {
          if (!settled && typeof options.onProgress === "function") options.onProgress(message);
        } else if (message.type === "DONE") {
          settled = true;
          port.disconnect();
          resolve({ text: message.text, usage: message.usage });
        } else if (message.type === "ERROR") {
          settled = true;
          port.disconnect();
          const error = new Error(message.error || "AI 流式请求失败");
          error.rawResponse = String(message.rawResponse || "").slice(0, 20000);
          reject(error);
        }
      });
      port.onDisconnect.addListener(() => {
        if (!settled) {
          settled = true;
          reject(new Error("AI 流式连接已断开。"));
        }
      });
      port.postMessage({
        type: "AI_CALL_STREAM",
        payload: { config: state.config, messages, maxTokens, jsonMode: !!options.jsonMode },
      });
    })().catch(reject);
  });
}

// 简历解析只需要最终文本，保留原有简洁接口。
export async function aiStream(messages, maxTokens, onDelta) {
  return (await aiStreamResponse(messages, maxTokens, onDelta)).text;
}

export async function parseAiJson(text) {
  const response = await send({ type: "PARSE_JSON", text });
  if (!response?.ok) {
    const rawText = String(text || "");
    const preview = rawText.replace(/\s+/g, " ").slice(0, 120);
    const error = new Error(
      `${response?.error || "AI 返回格式异常，请确认模型支持文本对话后重试。"}${preview ? ` 返回片段：${preview}` : ""}`
    );
    error.rawResponse = rawText.slice(0, 20000);
    throw error;
  }
  return response.data;
}
