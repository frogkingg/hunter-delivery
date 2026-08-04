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
    const ids = ["analyze", "send", "addQueueTop", "generateQueue", "startQueue", "export", "saveConfig", "testApi", "parseResume", "scanFillPage", "prepareFillSections", "fillSelected", "fillAll", "clearFill", "extractResumeFields", "saveResumeFields", "manageResumeFields", "closeResumeFieldsEditor", "discardResumeFields", "smartFillOnce", "deleteFillTemplate", "darkToggle"];
    for (const id of ids) {
      const el = window.document.getElementById(id);
      assert.ok(el, `元素 #${id} 应存在`);
      assert.equal(typeof el.onclick, "function", `按钮 #${id} 应绑定 onclick`);
    }
    assert.equal(typeof window.document.getElementById("fillAutoToggle").onchange, "function", "开关 #fillAutoToggle 应绑定 onchange");
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
    const { state, setProfiles, setActiveProfileIndex, setFillScanFields, setFillMatches, setFillSelected, setFillValues } = await import("../src/state.js");
    const { renderResumeFields, addResumeEntry, removeResumeEntry, saveResumeFields, collectResumeFields, rebindFillField, confirmManualFillValue, buildRepeaterPlans, changeFillProfile } = await import("../src/fill-ui.js");
  try {
    setProfiles([
      { name: "测试简历", resumeFields: {
        name: "张三",
        education: [{ id: "edu-1", start: "2016-09", end: "2020-06", school: "复旦大学", degree: "本科", major: "计算机" }],
        internships: [{ id: "int-1", start: "2021-06", end: "2021-09", company: "字节跳动", title: "产品实习生", description: "用户调研" }],
        projects: [],
      } },
      { name: "第二份简历", resumeFields: { name: "王五", education: [], workHistory: [], internships: [], projects: [] } },
    ]);
    setActiveProfileIndex(0);
    renderResumeFields();

    // 卡片渲染：4 个条目分组，实习卡片摘要正确
    assert.equal(window.document.querySelectorAll(".resume-entries-group").length, 4);
    const internCard = window.document.querySelector('[data-entry-group="internships"] .resume-entry-card');
    assert.ok(internCard, "实习经历卡片应渲染");
    assert.ok(internCard.textContent.includes("字节跳动"));
    assert.ok(internCard.textContent.includes("产品实习生"));
    assert.equal(window.document.querySelector('[data-entry-group="education"] .resume-entry-card').textContent.includes("复旦大学"), true);

    // 未保存标量修改在添加条目触发重渲染后仍保留
    window.document.querySelector('[data-resume-key="name"]').value = "李四";
    addResumeEntry("internships");
    const cards = window.document.querySelectorAll('[data-entry-group="internships"] .resume-entry-card');
    assert.equal(cards.length, 2, "添加后应为 2 条实习卡片");
    assert.equal(window.document.querySelector('[data-resume-key="name"]').value, "李四");

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
    assert.equal(saved.name, "李四", "添加条目前的未保存修改不得丢失");
    assert.equal(saved.internships.length, 2);
    assert.equal(saved.internshipCompany, "腾讯", "保存后应聚合最新实习公司");
    assert.equal(saved.internshipPeriod, "2022-01 至 2022-06");
    assert.equal(saved.internshipDescription, "需求分析");

    // 删除条目 → 聚合回退到剩余一条
    removeResumeEntry("internships", saved.internships[1].id);
    assert.equal(collectResumeFields().internships.length, 1);
    await saveResumeFields();
    const afterRemove = state.profiles[0].resumeFields;

    // manual 字段可通过搜索 fieldKey 修正语义，并从当前 profile 解析值。
    setFillScanFields([{ id: "manual-name", type: "text", label: "申请人", skipped: false, options: [], fingerprint: "fp-name" }]);
    setFillMatches([{ fieldId: "manual-name", fieldKey: "", value: "", type: "text", label: "申请人", status: "manual", source: "rule" }]);
    setFillSelected(new Set());
    setFillValues({});
    rebindFillField("manual-name", "name");
    assert.equal(state.fillMatches[0].fieldKey, "name");
    assert.equal(state.fillMatches[0].value, "李四");
    assert.equal(state.fillMatches[0].status, "match");
    assert.equal(state.fillMatches[0].source, "manual");
    assert.equal(state.fillSelected.has("manual-name"), true);

    setFillScanFields([{ id: "manual-gender", type: "custom-select", label: "性别", skipped: false, options: ["男", "女"], fingerprint: "fp-gender" }]);
    setFillMatches([{ fieldId: "manual-gender", fieldKey: "gender", value: "", type: "custom-select", label: "性别", status: "manual", source: "rule" }]);
    setFillSelected(new Set());
    setFillValues({});
    confirmManualFillValue("manual-gender", "男");
    assert.equal(state.fillMatches[0].status, "match");
    assert.equal(state.fillMatches[0].value, "男");
    assert.equal(state.fillSelected.has("manual-gender"), true);

    const plans = buildRepeaterPlans([
      { id: "edu", arrayKey: "education", title: "教育经历", currentCount: 0, fingerprint: "fp-edu" },
      { id: "intern", arrayKey: "internships", title: "实习经历", currentCount: 1, fingerprint: "fp-intern" },
    ], afterRemove);
    assert.equal(plans.find(plan => plan.arrayKey === "education").targetCount, 1);
    assert.equal(plans.some(plan => plan.arrayKey === "internships"), false, "已有足够实习区块时不应继续新增");

    // 切换简历前自动保存当前草稿
    window.document.querySelector('[data-resume-key="name"]').value = "切换前修改";
    addResumeEntry("projects");
    const autoSaved = await changeFillProfile(1);
    assert.equal(autoSaved, true);
    assert.equal(state.profiles[0].resumeFields.name, "切换前修改");
    assert.equal(window.document.querySelector('[data-resume-key="name"]').value, "王五");
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.chrome;
    dom.window.close();
  }
});

test("简历资料独立编辑视图：分组折叠、筛选和经历单一入口", async () => {
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
  const { setProfiles, setActiveProfileIndex } = await import("../src/state.js");
  const { renderResumeFields, openResumeFieldsEditor, closeResumeFieldsEditor, setResumeFieldFilter } = await import("../src/fill-ui.js");
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
      education: [{ id: "edu-filter", school: "复旦大学", start: "2019-09", end: "2023-06" }],
      internships: [], projects: [],
    } }]);
    setActiveProfileIndex(0);
    renderResumeFields();

    const groups = window.document.querySelectorAll(".resume-scalar-group");
    assert.equal(groups.length, 5, "标量字段应按五个类别分组");
    assert.equal(groups[0].open, true, "基本信息默认展开");
    assert.equal([...groups].slice(1).every(group => !group.open), true, "其他类别默认折叠");
    const emptyFields = window.document.querySelectorAll(".resume-field.is-empty");
    const filledFields = window.document.querySelectorAll(".resume-field:not(.is-empty)");
    assert.equal(emptyFields.length, 33, `空字段应为 33 个，实际 ${emptyFields.length}`);
    assert.equal(filledFields.length, 15, `有值字段应为 15 个，实际 ${filledFields.length}`);
    // 多行字段整行且为 textarea
    const skills = window.document.querySelector('[data-resume-key="skills"]');
    assert.ok(skills && skills.tagName === "TEXTAREA", "专业技能应为 textarea");
    assert.ok(skills.closest(".resume-field").classList.contains("is-textarea"), "专业技能应整行展示");
    const nameField = window.document.querySelector('[data-resume-key="name"]').closest(".resume-field");
    assert.ok(nameField.querySelector("span").textContent.includes("姓名"));
    assert.equal(window.document.querySelector('[data-resume-key="currentCompany"]'), null, "工作经历聚合标量不得重复编辑");
    assert.equal([...window.document.querySelectorAll(".resume-entries-group")].every(group => !group.open), true, "经历分组默认折叠");
    assert.ok(window.document.getElementById("resumeFieldsStatus").textContent.includes("15/48 项"));

    openResumeFieldsEditor();
    assert.equal(window.document.getElementById("smartFillMain").hidden, true);
    assert.equal(window.document.getElementById("resumeFieldsEditor").hidden, false);
    setResumeFieldFilter("missing");
    assert.equal(window.document.querySelector('[data-resume-key="name"]').closest(".resume-field").hidden, true, "待补充筛选应隐藏已填写字段");
    assert.equal(window.document.querySelector('[data-resume-key="idCard"]').closest(".resume-field").hidden, false);
    setResumeFieldFilter("basic");
    setResumeFieldFilter("education");
    assert.match(window.document.querySelector('[data-entry-group="education"]').textContent, /复旦大学/, "筛选切换不得清空未渲染经历");
    closeResumeFieldsEditor();
    assert.equal(window.document.getElementById("smartFillMain").hidden, false);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.chrome;
    dom.window.close();
  }
});

// —— 一键智能填充（P1 任务4） ——
const ONECLICK_SCAN_FIELDS = [
  { id: "f-name", type: "text", label: "姓名", rawLabel: "姓名", labelSource: "label", skipped: false, options: [], fingerprint: "fp-name", path: "#f-name", evidence: [{ source: "label", text: "姓名" }], context: {}, attributes: {} },
  { id: "f-phone", type: "tel", label: "手机号", rawLabel: "手机号", labelSource: "label", skipped: false, options: [], fingerprint: "fp-phone", path: "#f-phone", evidence: [{ source: "label", text: "手机号" }], context: {}, attributes: {} },
  { id: "f-referral", type: "text", label: "内推码", rawLabel: "内推码", labelSource: "label", skipped: false, options: [], fingerprint: "fp-ref", path: "#f-ref", evidence: [{ source: "label", text: "内推码" }], context: {}, attributes: {} },
];

function setupOneClickDom() {
  const dom = new JSDOM(html, { url: "chrome-extension://hunter/panel.html", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const appliedFills = [];
  const sentTypes = [];
  window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  globalThis.window = window;
  globalThis.document = window.document;
  const tab = { id: 7, url: "https://jobs.example.com/apply" };
  globalThis.chrome = {
    storage: { local: {
      get: async keys => {
        const list = typeof keys === "string" ? [keys] : keys;
        const out = {};
        for (const k of list) {
          if (k === "smartFillTemplates") out[k] = {};
          else if (k === "smartFillLogs") out[k] = [];
          else if (k === "smartFillSettings") out[k] = {};
          else out[k] = undefined;
        }
        return out;
      },
      set: async () => {},
    } },
    runtime: {
      sendMessage: (_message, callback) => { if (callback) callback({ ok: true }); },
      onMessage: { addListener() {} },
      connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {} }),
      getURL: path => path,
    },
    tabs: {
      query: async () => [tab],
      sendMessage: async (_id, message) => {
        sentTypes.push(message.type);
        if (message.type === "SMART_FILL_SCAN") {
          return { ok: true, engineVersion: 3, fields: ONECLICK_SCAN_FIELDS, repeaters: [], page: { title: "apply", url: tab.url, host: "jobs.example.com" }, scanId: "s1", documentFingerprint: "d1", formFingerprint: "f1" };
        }
        if (message.type === "SMART_FILL_APPLY") {
          appliedFills.push(...message.fills);
          return { ok: true, results: message.fills.map(f => ({ id: f.id, ok: true, resolvedFingerprint: f.fingerprint })) };
        }
        return { ok: true };
      },
    },
    permissions: { contains: async () => true, request: async () => true },
    scripting: { executeScript: async () => [] },
  };
  return { dom, appliedFills, sentTypes, close: () => { delete globalThis.window; delete globalThis.document; delete globalThis.chrome; dom.window.close(); } };
}

test("一键智能填充：自动模式下扫描后自动填充高置信项，需手动项不填", async () => {
  const { appliedFills, close } = setupOneClickDom();
  const { setProfiles, setActiveProfileIndex, setFillAutoMode } = await import("../src/state.js");
  const { runSmartFillOnce } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三", phone: "13800138000", email: "a@b.com" } }]);
    setActiveProfileIndex(0);
    setFillAutoMode(true);
    await runSmartFillOnce();
    assert.deepEqual(appliedFills.map(f => f.id).sort(), ["f-name", "f-phone"]);
  } finally { close(); }
});

test("一键智能填充：关闭自动填充时仅扫描不填充", async () => {
  const { appliedFills, close } = setupOneClickDom();
  const { state, setProfiles, setActiveProfileIndex, setFillAutoMode } = await import("../src/state.js");
  const { runSmartFillOnce } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三", phone: "13800138000" } }]);
    setActiveProfileIndex(0);
    setFillAutoMode(false);
    await runSmartFillOnce();
    assert.deepEqual(appliedFills, [], "关闭自动填充时不得发送填充请求");
    assert.ok(state.fillScanFields.length >= 3, "扫描结果应保留供预览");
  } finally { close(); }
});

test("一键智能填充：无自动匹配字段时不发送填充请求", async () => {
  const { appliedFills, close } = setupOneClickDom();
  const { setProfiles, setActiveProfileIndex, setFillAutoMode } = await import("../src/state.js");
  const { runSmartFillOnce } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: {} }]);
    setActiveProfileIndex(0);
    setFillAutoMode(true);
    await runSmartFillOnce();
    assert.deepEqual(appliedFills, [], "没有可自动匹配的字段时不得发送填充请求");
  } finally { close(); }
});
