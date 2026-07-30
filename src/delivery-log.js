// 投递日志查看 UI：loadDeliveryLog / clearDeliveryLog。
import { $, send, toast } from "./chrome-helpers.js";
import { handleError } from "./error-handler.js";
import { escapeHtml } from "./pure-utils.js";

const STATUS_LABEL = { ok: "成功", fail: "失败", stop: "停止" };

export async function loadDeliveryLog() {
  try {
    const response = await send({ type: "LOG_GET" });
    const log = response?.deliveryLog || [];
    const target = $("deliveryLogList");
    if (!target) return;
    target.innerHTML = log.length ? log.map(entry => {
      const time = escapeHtml(entry.time ? new Date(entry.time).toLocaleString("zh-CN") : "—");
      const jobTitle = escapeHtml(entry.jobTitle || "—");
      const step = escapeHtml(entry.step || "—");
      const statusText = STATUS_LABEL[entry.status] || entry.status || "—";
      const status = escapeHtml(statusText);
      const message = escapeHtml(entry.message || "");
      return `<div class="delivery-log-item"><span class="delivery-log-time">${time}</span><span class="delivery-log-job">${jobTitle}</span><span class="delivery-log-step">${step}</span><span class="delivery-log-status delivery-log-status-${escapeHtml(entry.status || "")}">${status}</span><span class="delivery-log-message">${message}</span></div>`;
    }).join("") : `<p class="hint">暂无投递日志。</p>`;
  } catch (error) {
    handleError("加载投递日志", error, (msg) => toast(`加载日志失败：${msg}`));
  }
}

export async function clearDeliveryLog() {
  try {
    const response = await send({ type: "LOG_CLEAR" });
    if (!response?.ok) throw new Error(response?.error || "清空失败");
    await loadDeliveryLog();
    toast("投递日志已清空");
  } catch (error) {
    handleError("清空投递日志", error, (msg) => toast(`清空失败：${msg}`));
  }
}
