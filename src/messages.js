// 消息协议定义 v1
// panel ↔ background ↔ content 之间的 chrome.runtime.sendMessage / connect 消息类型集中在此。
// 顶层 key 是消息 type，value 描述 payload 和响应格式。

export const MESSAGE_TYPES = {
  // panel → background
  AI_CALL: {
    direction: "panel→background",
    payload: { config: "Object", messages: "Array", maxTokens: "number", jsonMode: "boolean?", timeoutMs: "number?" },
    response: { ok: "boolean", text: "string?", usage: "{ prompt_tokens, completion_tokens, total_tokens }?", error: "string?", rawResponse: "string?" },
  },
  PARSE_JSON: {
    direction: "panel→background",
    payload: { text: "string" },
    response: { ok: "boolean", data: "Object?" },
  },
  SAVE_JOB: {
    direction: "panel→background",
    payload: { job: "Object" },
    response: { ok: "boolean", job: "Object?" },
  },
  LIBRARY_GET: {
    direction: "panel→background",
    payload: {},
    response: { ok: "boolean", jobLibrary: "Array" },
  },
  EXPORT_JOBS: {
    direction: "panel→background",
    payload: {},
    response: { ok: "boolean", csv: "string?", filename: "string?", error: "string?" },
  },
  QUEUE_ADD: {
    direction: "panel→background",
    payload: { job: "Object" },
    response: { ok: "boolean", item: "Object?" },
  },
  QUEUE_GET: {
    direction: "panel→background",
    payload: {},
    response: { ok: "boolean", queue: "Array", recentDeliveries: "Array", running: "boolean", batch: "{ current, total }" },
  },
  QUEUE_UPDATE: {
    direction: "panel→background",
    payload: { key: "string", patch: "Object" },
    response: { ok: "boolean", item: "Object?" },
  },
  QUEUE_REMOVE: {
    direction: "panel→background",
    payload: { key: "string" },
    response: { ok: "boolean" },
  },
  QUEUE_REMOVE_MANY: {
    direction: "panel→background",
    payload: { keys: "string[]" },
    response: { ok: "boolean", removedCount: "number", requestedCount: "number", missingKeys: "string[]" },
  },
  QUEUE_START: {
    direction: "panel→background",
    payload: {},
    response: { ok: "boolean", count: "number?", alreadyRunning: "boolean?" },
  },
  QUEUE_STOP: {
    direction: "panel→background",
    payload: {},
    response: { ok: "boolean", error: "string?" },
  },

  // panel → content（通过 background 中继到 activeTab）
  EXTRACT_JOB: {
    direction: "panel→content",
    payload: {},
    response: { ok: "boolean", job: "Object?" },
  },
  OPEN_COMMUNICATION: {
    direction: "panel→content",
    payload: {},
    response: { ok: "boolean" },
  },
  PREPARE_COMMUNICATION: {
    direction: "panel→content",
    payload: {},
    response: { ok: "boolean", ready: "boolean", blocked: "boolean", mode: "chat-page|inline-chat?", action: "string?", reason: "string?" },
  },
  SEND_MESSAGE: {
    direction: "panel→content",
    payload: { greeting: "string", images: "Array?" },
    response: { ok: "boolean", error: "string?", uncertain: "boolean?", messageSent: "boolean?", delivery: "{ status, alreadySent? }?", resume: "{ sent, count?, reason? }?" },
  },
  SELF_CHECK: {
    direction: "panel→content",
    payload: { requireImages: "boolean?" },
    response: { ok: "boolean", missing: "string[]" },
  },
  VERIFY_JOB: {
    direction: "background→content",
    payload: { job: "Object" },
    response: { ok: "boolean", reason: "string?" },
  },
  DIAGNOSE_PAGE: {
    direction: "panel→content",
    payload: {},
    response: { ok: "boolean", data: "Object?" },
  },

  // 智能填充：panel → content（经 fillMessagePage 直连并按需注入 fill-content.js）
  SMART_FILL_SCAN: {
    direction: "panel→content",
    payload: { onlyNew: "boolean?", region: "string?" },
    response: { ok: "boolean", engineVersion: "number", fields: "FieldDescriptor[]", repeaters: "RepeaterDescriptor[]", page: "{ title, url, host }?", scanId: "string", documentFingerprint: "string", formFingerprint: "string" },
  },
  SMART_FILL_PREPARE: {
    direction: "panel→content",
    payload: { scanId: "string", documentFingerprint: "string", formFingerprint: "string", plans: "[{ id, fingerprint, targetCount }]" },
    response: { ok: "boolean", fields: "FieldDescriptor[]", repeaters: "RepeaterDescriptor[]", results: "[{ id, arrayKey, ok, added, currentCount?, error? }]", scanId: "string", documentFingerprint: "string", formFingerprint: "string", error: "string?" },
  },
  SMART_FILL_APPLY: {
    direction: "panel→content",
    payload: { scanId: "string", documentFingerprint: "string", formFingerprint: "string", fills: "[{ id, value, type, fingerprint }]" },
    response: { ok: "boolean", results: "[{ id, ok, resolvedFingerprint?, verification?, error?, errorCode?, retried: \"boolean?\" }]", error: "string?", errorCode: "string?" },
  },
  SMART_FILL_HIGHLIGHT: {
    direction: "panel→content",
    payload: { ids: "string[]", on: "boolean" },
    response: { ok: "boolean" },
  },
  SMART_FILL_CANCEL: {
    direction: "panel→content",
    payload: {},
    response: { ok: "boolean" },
  },
  SMART_FILL_UNDO: {
    direction: "panel→content",
    payload: { scanId: "string", documentFingerprint: "string", formFingerprint: "string" },
    response: { ok: "boolean", count: "number", error: "string?", errorCode: "string?" },
  },
  SMART_FILL_PICK_REGION: {
    direction: "panel→content",
    payload: { requestId: "string" },
    response: { ok: "boolean" },
  },
  SMART_FILL_PICK_REGION_RESULT: {
    direction: "content→panel（事件，非应答）",
    payload: { requestId: "string", ok: "boolean", cancelled: "boolean?", error: "string?", errorCode: "string?", regionPath: "string?", regionLabel: "string?", engineVersion: "number", fields: "FieldDescriptor[]", repeaters: "RepeaterDescriptor[]", page: "{ title, url, host }?", scanId: "string", documentFingerprint: "string", formFingerprint: "string" },
  },
  SMART_FILL_PROGRESS: {
    direction: "content→panel（事件，非应答）",
    payload: { index: "number", total: "number", id: "string", ok: "boolean", error: "string?" },
  },

  // Stream（port 连接，非 sendMessage）
  AI_CALL_STREAM: {
    direction: "panel→background（port）",
    payload: { config: "Object", messages: "Array", maxTokens: "number", jsonMode: "boolean?" },
    events: {
      DELTA: { text: "string" },
      PROGRESS: { phase: "reasoning|retrying" },
      DONE: { text: "string", usage: "{ prompt_tokens, completion_tokens, total_tokens }?" },
      ERROR: { error: "string", rawResponse: "string?" },
    },
  },
};
