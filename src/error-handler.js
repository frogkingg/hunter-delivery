// 统一错误处理：记录完整堆栈到控制台，toast 简短提示。
// 不改变用户可见的错误消息（toast 内容不变），只是额外加 console.error + context。

export function handleError(context, error, toastFn) {
  const message = error?.message || String(error);
  console.error(`[猎投] ${context}：`, error);
  if (toastFn) toastFn(message);
  return message;
}
