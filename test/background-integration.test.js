import { test } from "node:test";
import assert from "node:assert/strict";

let moduleSequence = 0;

function createChrome(initialStore = {}, options = {}) {
  const store = structuredClone(initialStore);
  const listeners = [];
  const connectListeners = [];
  const calls = { createdTabs: 0, sentMessages: [], injectedFiles: [] };
  const tab = {
    id: 1,
    status: "complete",
    url: options.initialUrl || "https://www.zhipin.com/job_detail/job-1.html",
  };

  const get = async (keys) => {
    if (typeof keys === "string") return { [keys]: store[keys] };
    if (Array.isArray(keys)) return Object.fromEntries(keys.map(key => [key, store[key]]));
    return Object.fromEntries(Object.entries(keys || {}).map(([key, fallback]) => [key, store[key] ?? fallback]));
  };

  const chrome = {
    runtime: {
      onInstalled: { addListener() {} },
      onMessage: { addListener(listener) { listeners.push(listener); } },
      onConnect: { addListener(listener) { connectListeners.push(listener); } },
      sendMessage: async () => {},
    },
    sidePanel: { setPanelBehavior: async () => {} },
    storage: {
      local: {
        get,
        set: async (value) => {
          if (options.storageSet) await options.storageSet(value, store);
          Object.assign(store, structuredClone(value));
        },
      },
    },
    permissions: { contains: async () => true },
    tabs: {
      create: async ({ url }) => {
        calls.createdTabs++;
        tab.url = url;
        return { ...tab };
      },
      get: async () => ({ ...tab }),
      update: async (_id, { url }) => {
        tab.url = url;
        return { ...tab };
      },
      remove: async () => {},
      sendMessage: async (_id, message) => {
        calls.sentMessages.push(message);
        if (options.sendMessage) return options.sendMessage(message, tab, calls);
        if (message.type === "VERIFY_JOB") return { ok: true };
        if (message.type === "OPEN_COMMUNICATION") {
          tab.url = "https://www.zhipin.com/web/geek/chat";
          return { ok: true };
        }
        if (message.type === "PREPARE_COMMUNICATION") return { ok: true, ready: true, mode: "chat-page" };
        if (message.type === "SEND_MESSAGE") return { ok: true, resume: { sent: true } };
        throw new Error(`Unexpected tab message: ${message.type}`);
      },
    },
    scripting: {
      executeScript: async ({ files }) => {
        calls.injectedFiles.push(files);
      },
    },
    downloads: { download: async () => 1 },
  };

  return { chrome, store, listeners, connectListeners, calls };
}

async function bootBackground(mock, fetchImpl) {
  globalThis.chrome = mock.chrome;
  if (fetchImpl) globalThis.fetch = fetchImpl;
  await import(`../background.js?integration=${Date.now()}-${moduleSequence++}`);
  const listener = mock.listeners.at(-1);
  assert.equal(typeof listener, "function");
  return (message) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Message timed out: ${message.type}`)), 1000);
    listener(message, {}, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

async function waitForQueueToStop(dispatch) {
  const deadline = Date.now() + 1000;
  while (Date.now() < deadline) {
    const response = await dispatch({ type: "QUEUE_GET" });
    if (!response.running) return response;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error("Queue did not stop");
}

function sseResponse(parts) {
  const chunks = parts.map(part => new TextEncoder().encode(part));
  let index = 0;
  return {
    ok: true,
    headers: { get: name => name.toLowerCase() === "content-type" ? "text/event-stream" : null },
    body: {
      getReader: () => ({
        read: async () => index < chunks.length
          ? { done: false, value: chunks[index++] }
          : { done: true, value: undefined },
        cancel: async () => {},
      }),
    },
  };
}

async function runStream(mock, payload) {
  const events = [];
  let receive;
  const port = {
    name: "AI_CALL_STREAM",
    onMessage: { addListener(listener) { receive = listener; } },
    postMessage(message) { events.push(message); },
  };
  mock.connectListeners.at(-1)(port);
  assert.equal(typeof receive, "function");
  await receive({ type: "AI_CALL_STREAM", payload });
  return events;
}

function queuedJob(overrides = {}) {
  return {
    key: "job-1",
    jobId: "job-1",
    title: "AI 产品经理",
    company: "目标公司",
    detailUrl: "https://www.zhipin.com/job_detail/job-1.html",
    greeting: "您好，我对这个岗位很感兴趣。",
    profileName: "AI 方向",
    status: "待投递",
    ...overrides,
  };
}

test("QUEUE_START 真正执行队列、保留最终状态并仅回退注入 content.js", async () => {
  let firstSend = true;
  const mock = createChrome({
    deliveryQueue: [queuedJob()],
    profiles: [{ name: "AI 方向", resumeImages: [{ name: "resume.png", dataUrl: "data:image/png;base64,AA==" }] }],
  }, {
    sendMessage: async (message, tab) => {
      if (firstSend) {
        firstSend = false;
        throw new Error("Receiving end does not exist");
      }
      if (message.type === "VERIFY_JOB") return { ok: true };
      if (message.type === "OPEN_COMMUNICATION") return { ok: true };
      if (message.type === "PREPARE_COMMUNICATION") return { ok: true, ready: true, mode: "inline-chat" };
      if (message.type === "SEND_MESSAGE") return { ok: true, resume: { sent: true } };
      throw new Error(`Unexpected tab message: ${message.type}`);
    },
  });
  const dispatch = await bootBackground(mock);

  const started = await dispatch({ type: "QUEUE_START" });
  assert.deepEqual(started, { ok: true, count: 1 });
  const stopped = await waitForQueueToStop(dispatch);

  assert.equal(stopped.queue.length, 0);
  assert.equal(mock.store.jobLibrary.length, 1);
  assert.equal(mock.store.jobLibrary[0].status, "已沟通");
  assert.deepEqual(mock.calls.injectedFiles, [["content.js"]]);
  assert.equal(mock.calls.sentMessages.filter(message => message.type === "SEND_MESSAGE").length, 1);
});

test("批量投递在打开岗位前拒绝危险招呼语", async () => {
  const mock = createChrome({
    deliveryQueue: [queuedJob({ greeting: "请访问 https://evil.example" })],
    profiles: [{ name: "AI 方向", resumeImages: [] }],
  });
  const dispatch = await bootBackground(mock);

  await dispatch({ type: "QUEUE_START" });
  const stopped = await waitForQueueToStop(dispatch);

  assert.equal(mock.calls.createdTabs, 0);
  assert.equal(stopped.queue[0].status, "失败");
  assert.match(stopped.queue[0].error, /疑似包含链接/);
});

test("消息送达后归档失败会停在不可重试状态", async () => {
  const mock = createChrome({
    deliveryQueue: [queuedJob()],
    profiles: [{ name: "AI 方向", resumeImages: [] }],
  }, {
    storageSet: async (value) => {
      if (Object.hasOwn(value, "jobLibrary")) throw new Error("disk full");
    },
  });
  const dispatch = await bootBackground(mock);

  await dispatch({ type: "QUEUE_START" });
  const stopped = await waitForQueueToStop(dispatch);

  assert.equal(stopped.queue[0].status, "已发送待归档");
  assert.match(stopped.queue[0].error, /消息已确认送达.*归档失败/);
  assert.equal(mock.calls.sentMessages.filter(message => message.type === "SEND_MESSAGE").length, 1);
  const restarted = await dispatch({ type: "QUEUE_START" });
  assert.equal(restarted.ok, false);
  assert.match(restarted.error, /没有已生成招呼语/);
  const requeued = await dispatch({
    type: "QUEUE_UPDATE",
    key: "job-1",
    patch: { status: "待投递" },
  });
  assert.equal(requeued.ok, false);
  assert.match(requeued.error, /避免重复发送/);
});

test("AI_CALL 透传 token usage", async () => {
  const mock = createChrome();
  const usage = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 };
  const dispatch = await bootBackground(mock, async () => ({
    ok: true,
    json: async () => ({
      choices: [{ message: { content: "连接成功" }, finish_reason: "stop" }],
      usage,
    }),
  }));

  const response = await dispatch({
    type: "AI_CALL",
    payload: {
      config: { endpoint: "https://api.example.com/v1", apiKey: "key", model: "model" },
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 20,
    },
  });

  assert.deepEqual(response, { ok: true, text: "连接成功", usage });
});

test("AI_CALL 空响应时扩大 token 预算并自动重试", async () => {
  const mock = createChrome();
  const requestBodies = [];
  let attempt = 0;
  const dispatch = await bootBackground(mock, async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    attempt++;
    return {
      ok: true,
      json: async () => attempt === 1
        ? {
            choices: [{ message: { content: "", reasoning_content: "思考中" }, finish_reason: "length" }],
            usage: { completion_tokens: 4000 },
          }
        : {
            choices: [{ message: { content: '{"greetings":[{"text":"你好"}]}' }, finish_reason: "stop" }],
            usage: { completion_tokens: 20 },
          },
    };
  });

  const response = await dispatch({
    type: "AI_CALL",
    payload: {
      config: { endpoint: "https://api.deepseek.com/v1", apiKey: "key", model: "deepseek-reasoner" },
      messages: [{ role: "user", content: "生成招呼语" }],
      maxTokens: 4000,
      jsonMode: true,
    },
  });

  assert.equal(response.ok, true);
  assert.equal(response.text, '{"greetings":[{"text":"你好"}]}');
  assert.equal(requestBodies.length, 2);
  assert.equal(requestBodies[0].max_tokens, 4000);
  assert.equal(requestBodies[1].max_tokens, 8000);
  assert.deepEqual(requestBodies[0].thinking, { type: "disabled" });
  assert.deepEqual(requestBodies[1].thinking, { type: "disabled" });
  assert.equal(Object.hasOwn(requestBodies[0], "temperature"), false);
});

test("AI_CALL 连续空响应时返回可诊断原因和原始响应", async () => {
  const mock = createChrome();
  const dispatch = await bootBackground(mock, async () => ({
    ok: true,
    json: async () => ({
      model: "deepseek-reasoner",
      choices: [{ message: { content: null, reasoning_content: "只有推理过程" }, finish_reason: "length" }],
      usage: {
        completion_tokens: 8000,
        completion_tokens_details: { reasoning_tokens: 8000 },
      },
    }),
  }));

  const response = await dispatch({
    type: "AI_CALL",
    payload: {
      config: { endpoint: "https://api.deepseek.com/v1", apiKey: "key", model: "deepseek-reasoner" },
      messages: [{ role: "user", content: "生成招呼语" }],
      maxTokens: 4000,
    },
  });

  assert.equal(response.ok, false);
  assert.match(response.error, /已自动重试 1 次.*耗尽了生成额度/);
  assert.match(response.rawResponse, /reasoning_tokens/);
  assert.match(response.rawResponse, /finish_reason/);
});

test("AI_CALL 为 GPT-5 使用 max_completion_tokens 并读取 output_text", async () => {
  const mock = createChrome();
  let requestBody;
  const dispatch = await bootBackground(mock, async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ output_text: "连接成功", usage: { total_tokens: 10 } }),
    };
  });

  const response = await dispatch({
    type: "AI_CALL",
    payload: {
      config: { endpoint: "https://api.openai.com/v1", apiKey: "key", model: "gpt-5-mini" },
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 200,
    },
  });

  assert.equal(response.ok, true);
  assert.equal(response.text, "连接成功");
  assert.equal(requestBody.max_completion_tokens, 200);
  assert.equal(Object.hasOwn(requestBody, "max_tokens"), false);
  assert.equal(Object.hasOwn(requestBody, "temperature"), false);
  assert.equal(Object.hasOwn(requestBody, "thinking"), false);
});

test("AI_CALL_STREAM 推送推理阶段、累计文本和 usage", async () => {
  const mock = createChrome();
  let requestBody;
  await bootBackground(mock, async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return sseResponse([
      'data: {"choices":[{"delta":{"reasoning_content":"分析岗位"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"{\\"greetings\\":["}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"{\\"text\\":\\"你好\\"}]}"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"total_tokens":42}}\n\n',
      "data: [DONE]",
    ]);
  });

  const events = await runStream(mock, {
    config: { endpoint: "https://api.deepseek.com/v1", apiKey: "key", model: "deepseek-reasoner" },
    messages: [{ role: "user", content: "生成招呼语" }],
    maxTokens: 4000,
    jsonMode: true,
  });

  assert.ok(events.some(event => event.type === "PROGRESS" && event.phase === "reasoning"));
  assert.equal(events.filter(event => event.type === "DELTA").at(-1).text, '{"greetings":[{"text":"你好"}]}');
  assert.deepEqual(events.at(-1), { type: "DONE", text: '{"greetings":[{"text":"你好"}]}', usage: { total_tokens: 42 } });
  assert.equal(requestBody.stream, true);
  assert.deepEqual(requestBody.thinking, { type: "disabled" });
  assert.deepEqual(requestBody.response_format, { type: "json_object" });
});

test("AI_CALL_STREAM 无正文时回退非流式扩容请求", async () => {
  const mock = createChrome();
  const requestBodies = [];
  let requestCount = 0;
  await bootBackground(mock, async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    requestCount++;
    if (requestCount === 1) {
      return sseResponse([
        'data: {"choices":[{"delta":{"reasoning_content":"持续思考"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
        "data: [DONE]\n\n",
      ]);
    }
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '{"greetings":[{"text":"回退成功"}]}' }, finish_reason: "stop" }],
      }),
    };
  });

  const events = await runStream(mock, {
    config: { endpoint: "https://api.deepseek.com/v1", apiKey: "key", model: "deepseek-reasoner" },
    messages: [{ role: "user", content: "生成招呼语" }],
    maxTokens: 4000,
    jsonMode: true,
  });

  assert.ok(events.some(event => event.type === "PROGRESS" && event.phase === "retrying"));
  assert.equal(events.at(-1).type, "DONE");
  assert.equal(events.at(-1).text, '{"greetings":[{"text":"回退成功"}]}');
  assert.equal(requestBodies[0].stream, true);
  assert.deepEqual(requestBodies[0].thinking, { type: "disabled" });
  assert.equal(requestBodies[1].stream, undefined);
  assert.equal(requestBodies[1].max_tokens, 8000);
  assert.deepEqual(requestBodies[1].thinking, { type: "disabled" });
});

test("AI_CALL 允许显式开启 DeepSeek 思考模式", async () => {
  const mock = createChrome();
  let requestBody;
  const dispatch = await bootBackground(mock, async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      }),
    };
  });

  const response = await dispatch({
    type: "AI_CALL",
    payload: {
      config: {
        endpoint: "https://api.deepseek.com/v1",
        apiKey: "key",
        model: "deepseek-v4-pro",
        disableThinking: false,
      },
      messages: [{ role: "user", content: "ping" }],
      maxTokens: 200,
    },
  });

  assert.equal(response.ok, true);
  assert.equal(Object.hasOwn(requestBody, "thinking"), false);
});
