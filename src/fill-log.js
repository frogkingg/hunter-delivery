// 智能填充：填充日志（上限 LOG_MAX 条，新条目在前）。
// 纯函数模块，Node 可测。

export const LOG_MAX = 200;

export function appendFillLog(logs, entry) {
  const list = Array.isArray(logs) ? [...logs] : [];
  if (!entry) return list;
  list.unshift({
    time: new Date().toISOString(),
    durationMs: 0,
    ...entry,
  });
  return list.slice(0, LOG_MAX);
}

export function summarizeResults(results) {
  const list = Array.isArray(results) ? results : [];
  const ok = list.filter(r => r && r.ok).length;
  return { total: list.length, ok, failed: list.length - ok };
}
