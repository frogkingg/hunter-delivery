// 依赖 chrome API 与 DOM 的工具函数。

export const $ = (id) => document.getElementById(id);

// 扩展 Service Worker 被系统回收时，chrome.runtime.sendMessage 回调可能永不触发；
// 加超时避免面板侧 Promise 永久 pending（批量轮询会因此停摆且无提示）。
export const send = (message, timeoutMs = 30000) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`扩展后台无响应（${Math.round(timeoutMs / 1000)} 秒），请刷新面板后重试。`)),
      timeoutMs
    );
    chrome.runtime.sendMessage(message, (response) => {
      clearTimeout(timer);
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });

export async function activeTab() {
  // Side Panel 获得焦点时，currentWindow 在少数 Chrome 版本中会返回扩展页而非网页标签。
  // 先取最后活跃窗口的当前标签；若仍不是 BOSS，则在当前浏览器窗口中寻找最近的 BOSS 职位页。
  const [focused] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (focused && /(^|\.)zhipin\.com$/.test(new URL(focused.url || "https://invalid.local").hostname))
    return focused;
  const candidates = await chrome.tabs.query({
    url: ["*://*.zhipin.com/job_detail/*", "*://*.zhipin.com/web/geek/jobs*"],
  });
  return candidates.sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))[0] || focused;
}

export function toast(message) {
  const el = $("toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 4200);
}

export async function messagePage(tab, message) {
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    if (!/Receiving end does not exist/i.test(error.message || "")) throw error;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    return chrome.tabs.sendMessage(tab.id, message);
  }
}

// 智能填充：向应用页直连发送消息，无监听者时按需注入 fill-content.js。
// 与 messagePage 的区别：注入的是智能填充引擎而非 BOSS 内容脚本。
export async function fillMessagePage(tab, message) {
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    if (!/Receiving end does not exist/i.test(error.message || "")) throw error;
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["fill-content.js"] });
    return chrome.tabs.sendMessage(tab.id, message);
  }
}