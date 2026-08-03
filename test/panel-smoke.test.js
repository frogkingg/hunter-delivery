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

test("基础字段紧凑布局：单行标签、空值折叠、多行字段整行", async () => {
  const dom = new JSDOM(html, { url: "chrome-extension://hunter/panel.html", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    runtime: { sendMessage: (_m, cb) => cb && cb({ ok: true }), onMessage: { addListener() {} }, connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {} }), getURL: p => p },
    tabs: { query: async () => [] },
  };
  const { state, setProfiles, setActiveProfileIndex } = await import("../src/state.js");
  const { renderResumeFields, toggleResumeEmptyFields } = await import("../src/fill-ui.js");
  try {
    // 模拟真实简历：部分字段有值（含长文本），部分为空
    setProfiles([{ name: "测试简历", resumeFields: {
      name: "张三", phone: "13800138000", email: "zhangsan@example.com", gender: "男",
      birthDate: "1998-06", idCard: "", hometown: "北京", currentCity: "上海",
      address: "", postcode: "", politicalStatus: "", maritalStatus: "",
      expectedCity: "上海", expectedSalary: "20-30K", expectedPosition: "数据分析师", availableTime: "随时到岗",
      workYears: "3年", currentCompany: "", currentTitle: "",
      profileSummary: "", selfEvaluation: "",
      skills: "熟练掌握 Python (Pandas, Scikit-learn, Matplotlib, Seaborn), SQL, Stata, VBA, Microsoft Office",
      languages: "雅思 7 分，GRE 322 分，四级 630，六级 580，适应英语工作环境",
      hobbies: "", github: "", linkedin: "", portfolio: "", referral: "",
      awards: "2024 年三好学生、2024及2023年乙等奖学金、第四届大学生金融科技建模大赛一等奖",
      certificates: "", campusExperience: "", additionalInfo: "",
      education: [], internships: [], projects: [],
    } }]);
    setActiveProfileIndex(0);
    renderResumeFields();

    const grid = window.document.querySelector(".resume-fields-grid");
    assert.ok(grid, "标量网格应渲染");
    assert.equal(grid.dataset.hideEmpty, "on", "默认隐藏空字段");
    const emptyFields = window.document.querySelectorAll(".resume-field.is-empty");
    const filledFields = window.document.querySelectorAll(".resume-field:not(.is-empty)");
    assert.equal(emptyFields.length, 17, `空字段应为 17 个，实际 ${emptyFields.length}`);
    assert.equal(filledFields.length, 15, `有值字段应为 15 个，实际 ${filledFields.length}`);
    // 折叠提示按钮
    const toggle = window.document.querySelector("[data-empty-toggle]");
    assert.ok(toggle && toggle.textContent.includes("展开空字段（17）"), "折叠按钮文案应含空字段数");
    // 多行字段整行且为 textarea
    const skills = window.document.querySelector('[data-resume-key="skills"]');
    assert.ok(skills && skills.tagName === "TEXTAREA", "专业技能应为 textarea");
    assert.ok(skills.closest(".resume-field").classList.contains("is-textarea"), "专业技能应整行展示");
    // 单行字段标签与输入同行（flex row）
    const nameField = window.document.querySelector('[data-resume-key="name"]').closest(".resume-field");
    assert.ok(nameField.querySelector("span").textContent.includes("姓名"), "标签在输入左侧");
    // 状态计数
    assert.ok(window.document.getElementById("resumeFieldsStatus").textContent.includes("已填 15 / 共 35"));

    // 切换展开空字段
    toggleResumeEmptyFields();
    assert.equal(grid.dataset.hideEmpty, "off", "切换后显示空字段");
    assert.ok(toggle.textContent.includes("隐藏空字段"));
    toggleResumeEmptyFields();
    assert.equal(grid.dataset.hideEmpty, "on");
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.chrome;
    dom.window.close();
  }
});
