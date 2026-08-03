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

test("简历字段条目编辑器：多条目卡片渲染、添加/删除、保存聚合", async () => {
  const dom = new JSDOM(html, { url: "chrome-extension://hunter/panel.html", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  window.confirm = () => true;
  window.prompt = () => null;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    runtime: { sendMessage: (_m, cb) => cb && cb({ ok: true }), onMessage: { addListener() {} }, connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {} }), getURL: p => p },
    tabs: { query: async () => [] },
  };
  const { state, setProfiles, setActiveProfileIndex } = await import("../src/state.js");
  const { renderResumeFields, addResumeEntry, removeResumeEntry, saveResumeFields, collectResumeFields } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: {
      name: "张三",
      education: [{ id: "edu-1", start: "2016-09", end: "2020-06", school: "复旦大学", degree: "本科", major: "计算机" }],
      internships: [{ id: "int-1", start: "2021-06", end: "2021-09", company: "字节跳动", title: "产品实习生", description: "用户调研" }],
      projects: [],
    } }]);
    setActiveProfileIndex(0);
    renderResumeFields();

    // 卡片渲染：3 个条目分组，实习卡片摘要正确
    assert.equal(window.document.querySelectorAll(".resume-entries-group").length, 3);
    const internCard = window.document.querySelector('[data-entry-group="internships"] .resume-entry-card');
    assert.ok(internCard, "实习经历卡片应渲染");
    assert.ok(internCard.textContent.includes("字节跳动"));
    assert.ok(internCard.textContent.includes("产品实习生"));
    assert.equal(window.document.querySelector('[data-entry-group="education"] .resume-entry-card').textContent.includes("复旦大学"), true);

    // 添加条目
    addResumeEntry("internships");
    const cards = window.document.querySelectorAll('[data-entry-group="internships"] .resume-entry-card');
    assert.equal(cards.length, 2, "添加后应为 2 条实习卡片");

    // 修改新条目并保存 → 聚合取最新
    const newCard = cards[cards.length - 1];
    const setVal = (key, value) => {
      const input = newCard.querySelector(`[data-entry-input="internships|${newCard.dataset.entryId}|${key}"]`);
      input.value = value;
    };
    setVal("start", "2022-01");
    setVal("end", "2022-06");
    setVal("company", "腾讯");
    setVal("title", "产品策划实习生");
    setVal("description", "需求分析");
    await saveResumeFields();
    const saved = state.profiles[0].resumeFields;
    assert.equal(saved.internships.length, 2);
    assert.equal(saved.internshipCompany, "腾讯", "保存后应聚合最新实习公司");
    assert.equal(saved.internshipPeriod, "2022-01 至 2022-06");
    assert.equal(saved.internshipDescription, "需求分析");

    // 删除条目 → 聚合回退到剩余一条
    removeResumeEntry("internships", saved.internships[1].id);
    assert.equal(collectResumeFields().internships.length, 1);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.chrome;
    dom.window.close();
  }
});
