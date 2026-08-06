// 纯函数：不依赖任何 chrome / DOM API，可在 Node 下测试。

// 将 textContent→innerHTML 的行为改为纯字符串实现，显式处理五个字符。
// 与原 document.createElement 实现等价：原实现 textContent 已编码 & < >，
// 再额外替换 " 和 '；新实现显式处理这五个字符，结果一致。
export function escapeHtml(value) {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// href/src 等属性上下文必须同时校验协议，防止 javascript:/data: 等危险 URI。
export function safeUrl(value) {
  return /^(https?:\/\/|\/)/i.test(String(value || "")) ? value : "#";
}

export function validateEndpoint(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) throw new Error("请先填写 AI API 地址。");
  let url;
  try {
    url = new URL(trimmed);
  } catch (_) {
    throw new Error("AI API 地址格式不正确。");
  }
  if (url.protocol !== "https:")
    throw new Error("出于隐私安全，AI 服务地址必须为 https://。明文 http 会泄露简历内容。");
  const host = url.hostname.toLowerCase();
  if (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(host)
  )
    throw new Error("不允许使用本地或内网地址作为 AI 服务。");
  return trimmed;
}

// BOSS 直聘用私有字体（kanzhun-mix）把薪资等数字渲染为 PUA 码位：U+E031~U+E03A 对应 0-9。
// 解码已知映射；未映射的私用区字符（U+E000~U+F8FF）在正常 UI 文本中不会出现，
// 直接移除，避免字体映射变化/防爬更新导致状态文字部分乱码。
export function decodePuaText(text) {
  const value = String(text ?? "");
  if (!value) return value;
  return value.replace(/[\uE000-\uF8FF]/g, (char) => {
    const code = char.charCodeAt(0);
    if (code >= 0xE031 && code <= 0xE03A) return String(code - 0xE031); // 0-9
    return ""; // 未映射的私用区字符移除
  });
}

// 显示边界净化：对来自页面/AI 的文本去除 PUA，避免渲染为乱码。
export function sanitizeDisplayText(text) {
  return decodePuaText(text);
}

// 原实现为 async 但内部无 await，改为同步纯函数。
export function sanitizeGreeting(text) {
  const value = String(text || "").trim();
  if (!value) throw new Error("请先生成或填写招呼语。");
  if (value.length > 600) throw new Error("招呼语过长，请确认未被异常内容劫持后缩短再发送。");
  // 防止反向提示注入把联系方式/外链塞进招呼语自动发出。
  if (/weixin|微信|qq|v信|wx/i.test(value) && /\d{5,}/.test(value))
    throw new Error("招呼语疑似包含联系方式，已拦截，请检查 AI 返回是否被 JD 指令污染。");
  if (/https?:\/\//i.test(value))
    throw new Error("招呼语疑似包含链接，已拦截，请检查 AI 返回是否被 JD 指令污染。");
  return decodePuaText(value);
}

// 截断投递日志到最大条数，避免无限增长。纯函数，可在 Node 下测试。
export function trimLog(log, max) {
  const entries = Array.isArray(log) ? log : [];
  const limit = Math.max(0, Number(max) || 0);
  return entries.slice(0, limit);
}