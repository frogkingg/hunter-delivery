// 面板初始化冒烟测试：加载真实 panel.html + app.js（jsdom），
// 验证初始化不抛错且关键按钮都绑定了事件——防止模块加载错误导致整面板失效。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const html = readFileSync(new URL("../panel.html", import.meta.url), "utf8");

test("面板初始化：所有关键按钮绑定事件且无未捕获异常", async () => {
  const dom = new JSDOM(html, { url: "chrome-extension://hunter/panel.html", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const storageGet = async keys => {
    const result = {};
    if (typeof keys === "string") result[keys] = undefined;
    else for (const key of keys) result[key] = undefined;
    return result;
  };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  window.confirm = () => true;
  window.prompt = () => null;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.chrome = {
    storage: { local: { get: storageGet, set: async () => {} } },
    runtime: {
      sendMessage: (_message, callback) => {
        if (callback) callback({ ok: true, queue: [], jobLibrary: [], recentDeliveries: [], running: false, batch: {} });
      },
      onMessage: { addListener: () => {} },
      connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {} }),
      getURL: path => path,
    },
    tabs: { query: async () => [], create: async () => {} },
    permissions: { contains: async () => true, request: async () => true },
    scripting: { executeScript: async () => [] },
  };
  try {
    await import("../src/app.js");
    window.document.dispatchEvent(new window.Event("DOMContentLoaded"));
    // 等待异步初始化完成（initConfig → loadProfiles → initFillUi）
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const scan = window.document.getElementById("scanFillPage");
      if (scan && typeof scan.onclick === "function") break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const ids = ["analyze", "send", "addQueueTop", "generateQueue", "startQueue", "export", "saveConfig", "testApi", "parseResume", "scanFillPage", "fillSelected", "fillAll", "clearFill", "extractResumeFields", "saveResumeFields", "deleteFillTemplate", "darkToggle"];
    for (const id of ids) {
      const el = window.document.getElementById(id);
      assert.ok(el, `元素 #${id} 应存在`);
      assert.equal(typeof el.onclick, "function", `按钮 #${id} 应绑定 onclick`);
    }
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.chrome;
    dom.window.close();
  }
});
