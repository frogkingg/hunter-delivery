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
      const scan = window.document.getElementById("smartFillOnce");
      if (scan && typeof scan.onclick === "function") break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const ids = ["analyze", "send", "addQueueTop", "generateQueue", "startQueue", "export", "saveConfig", "testApi", "parseResume", "clearFill", "extractResumeFields", "saveResumeFields", "manageResumeFields", "closeResumeFieldsEditor", "discardResumeFields", "smartFillOnce", "regionFill", "smartFillUndo", "exportDiagnostics", "fillSelected", "deleteFillTemplate", "darkToggle"];
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

function setupOneClickDom(options = {}) {
  const { repeaters = [], prepareOk = true, applyResults } = options;
  const dom = new JSDOM(html, { url: "chrome-extension://hunter/panel.html", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const appliedFills = [];
  const sentTypes = [];
  const sentMessages = [];
  const preparedPlans = [];
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
        sentMessages.push(message);
        if (message.type === "SMART_FILL_SCAN") {
          return { ok: true, engineVersion: 3, fields: ONECLICK_SCAN_FIELDS, repeaters, page: { title: "apply", url: tab.url, host: "jobs.example.com" }, scanId: "s1", documentFingerprint: "d1", formFingerprint: "f1" };
        }
        if (message.type === "SMART_FILL_PREPARE") {
          preparedPlans.push(...message.plans);
          if (!prepareOk) {
            return { ok: false, error: "模拟展开失败", results: message.plans.map(p => ({ id: p.id, ok: false, error: "模拟展开失败" })) };
          }
          const extra = message.plans.map((plan, i) => ({
            id: `f-edu-${i}`, type: "text", label: "毕业院校", rawLabel: "毕业院校",
            labelSource: "label", skipped: false, options: [], fingerprint: `fp-edu-${i}`, path: `#f-edu-${i}`,
            evidence: [{ source: "label", text: "毕业院校" }],
            context: { repeat: { arrayKey: "education", itemIndex: i } }, attributes: {},
          }));
          return {
            ok: true,
            fields: [...ONECLICK_SCAN_FIELDS, ...extra],
            repeaters: message.plans.map(p => ({ ...p, currentCount: p.targetCount })),
            results: message.plans.map(p => ({ id: p.id, ok: true, added: p.targetCount })),
            scanId: "s1", documentFingerprint: "d1", formFingerprint: "f1",
            page: { title: "apply", url: tab.url, host: "jobs.example.com" },
          };
        }
        if (message.type === "SMART_FILL_APPLY") {
          appliedFills.push(...message.fills);
          if (applyResults) {
            return { ok: true, results: typeof applyResults === "function" ? applyResults(message.fills) : applyResults };
          }
          return { ok: true, results: message.fills.map(f => ({ id: f.id, ok: true, resolvedFingerprint: f.fingerprint })) };
        }
        return { ok: true };
      },
    },
    permissions: { contains: async () => true, request: async () => true },
    scripting: { executeScript: async () => [] },
  };
  return { dom, appliedFills, sentTypes, sentMessages, preparedPlans, close: () => { delete globalThis.window; delete globalThis.document; delete globalThis.chrome; dom.window.close(); } };
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

test("一键智能填充：有经历区块时自动展开后填充", async () => {
  const repeaters = [{ id: "edu", arrayKey: "education", title: "教育经历", currentCount: 0, fingerprint: "fp-edu" }];
  const { appliedFills, sentTypes, preparedPlans, close } = setupOneClickDom({ repeaters });
  const { setProfiles, setActiveProfileIndex, setFillAutoMode } = await import("../src/state.js");
  const { runSmartFillOnce } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三", phone: "13800138000", education: [{ id: "e1", school: "复旦大学" }] } }]);
    setActiveProfileIndex(0);
    setFillAutoMode(true);
    await runSmartFillOnce();
    assert.ok(sentTypes.includes("SMART_FILL_PREPARE"), "应自动发送展开经历请求");
    assert.ok(preparedPlans.length >= 1, "展开计划应包含教育经历");
    assert.ok(preparedPlans.some(p => p.id === "edu"), "展开计划应为教育经历区块");
    assert.ok(appliedFills.some(f => f.id.startsWith("f-edu-")), "展开后的教育经历字段应被填充");
  } finally { close(); }
});

test("一键智能填充：展开经历失败时降级继续填充", async () => {
  const repeaters = [{ id: "edu", arrayKey: "education", title: "教育经历", currentCount: 0, fingerprint: "fp-edu" }];
  const { appliedFills, sentTypes, close } = setupOneClickDom({ repeaters, prepareOk: false });
  const { setProfiles, setActiveProfileIndex, setFillAutoMode } = await import("../src/state.js");
  const { runSmartFillOnce } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三", phone: "13800138000", education: [{ id: "e1", school: "复旦大学" }] } }]);
    setActiveProfileIndex(0);
    setFillAutoMode(true);
    await runSmartFillOnce();
    assert.ok(sentTypes.includes("SMART_FILL_PREPARE"), "应尝试展开经历");
    assert.deepEqual(appliedFills.map(f => f.id).sort(), ["f-name", "f-phone"], "展开失败仍应填充已扫到的字段");
  } finally { close(); }
});

test("一键智能填充：成功后列表折叠为需人工处理+已自动填充", async () => {
  const { close } = setupOneClickDom();
  const { setProfiles, setActiveProfileIndex, setFillAutoMode } = await import("../src/state.js");
  const { runSmartFillOnce } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三", phone: "13800138000" } }]);
    setActiveProfileIndex(0);
    setFillAutoMode(true);
    await runSmartFillOnce();
    const manual = window.document.querySelector(".fill-summary-manual");
    const done = window.document.querySelector(".fill-summary-done");
    assert.ok(manual, "应有「需人工处理」折叠组");
    assert.ok(done, "应有「已自动填充」折叠组");
    assert.equal(manual.querySelectorAll(".fill-row").length, 1, "内推码应为需人工处理项");
    assert.equal(done.querySelectorAll(".fill-row").length, 2, "姓名/手机号应为已自动填充项");
    assert.match(done.textContent, /已自动填充（2）/);
    assert.equal(window.document.getElementById("fillSelected").hidden, true, "自动填充完成后工具条按钮应隐藏");
  } finally { close(); }
});

// —— 匹配列表图例与结果行点击定位（Wave 3 任务3） ——
test("匹配列表图例：有结果时渲染绿/橙图例（已填/待人工）", async () => {
  const { close } = setupOneClickDom();
  const { setProfiles, setActiveProfileIndex, setFillAutoMode } = await import("../src/state.js");
  const { runSmartFillOnce } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三", phone: "13800138000" } }]);
    setActiveProfileIndex(0);
    setFillAutoMode(true);
    await runSmartFillOnce();
    const legend = window.document.querySelector(".fill-legend");
    assert.ok(legend, "渲染结果后应存在 .fill-legend 图例");
    assert.match(legend.textContent, /已填/, "图例应含「已填」项");
    assert.match(legend.textContent, /待人工/, "图例应含「待人工」项");
    assert.equal(legend.querySelectorAll(".dot.done").length, 1, "图例应含绿色「已填」圆点");
    assert.equal(legend.querySelectorAll(".dot.pending").length, 1, "图例应含橙色「待人工」圆点");
  } finally { close(); }
});

test("点击结果行：发送 SMART_FILL_HIGHLIGHT 定位对应字段", async () => {
  const { sentMessages, close } = setupOneClickDom();
  const { setProfiles, setActiveProfileIndex, setFillAutoMode } = await import("../src/state.js");
  const { runSmartFillOnce } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三", phone: "13800138000" } }]);
    setActiveProfileIndex(0);
    setFillAutoMode(true);
    await runSmartFillOnce();
    const rows = window.document.querySelectorAll(".fill-row");
    assert.ok(rows.length >= 1, "应有结果行");
    const nameRow = [...rows].find(row => row.textContent.includes("姓名"));
    assert.ok(nameRow, "应找到姓名结果行");
    nameRow.click();
    await new Promise(resolve => setTimeout(resolve, 0)); // 等待异步 sendMessage 链路
    const hl = sentMessages.find(m => m.type === "SMART_FILL_HIGHLIGHT");
    assert.ok(hl, "点击结果行应发送 SMART_FILL_HIGHLIGHT");
    assert.deepEqual(hl.ids, ["f-name"], "应高亮对应字段 id");
    assert.equal(hl.on, true, "应为开启高亮");
  } finally { close(); }
});

test("填充失败：模拟输入后仍失败显示手动填写引导，其他失败保持原文案", async () => {
  const { close } = setupOneClickDom({
    applyResults: fills => fills.map(f => {
      if (f.id === "f-name") return { id: f.id, ok: false, error: "模拟输入后仍失败", resolvedFingerprint: f.fingerprint };
      if (f.id === "f-phone") return { id: f.id, ok: false, error: "回读校验失败", resolvedFingerprint: f.fingerprint };
      return { id: f.id, ok: true, resolvedFingerprint: f.fingerprint };
    }),
  });
  const { setProfiles, setActiveProfileIndex, setFillAutoMode } = await import("../src/state.js");
  const { runSmartFillOnce } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三", phone: "13800138000" } }]);
    setActiveProfileIndex(0);
    setFillAutoMode(true);
    await runSmartFillOnce();
    const manual = window.document.querySelector(".fill-summary-manual");
    assert.ok(manual, "失败字段应进入「需人工处理」折叠组");
    assert.match(manual.textContent, /已尝试模拟输入仍失败，请手动填写/, "打字重填失败的字段应显示手动填写引导");
    assert.match(manual.textContent, /规则命中「手机号」/, "其他失败应保持匹配阶段原文案");
    assert.doesNotMatch(manual.textContent, /回读校验失败/, "其他失败的引擎原始错误不应直接展示");
  } finally { close(); }
});

test("智能填充：预览模式下工具条按钮显示且清空链接按需出现", async () => {
  const { close } = setupOneClickDom();
  const { setProfiles, setActiveProfileIndex, setFillAutoMode } = await import("../src/state.js");
  const { runSmartFillOnce, clearFill } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三", phone: "13800138000" } }]);
    setActiveProfileIndex(0);
    setFillAutoMode(false);
    await runSmartFillOnce();
    const footer = window.document.getElementById("fillSelected");
    assert.equal(footer.hidden, false, "预览模式应显示填充勾选项按钮");
    assert.match(footer.textContent, /填充勾选项（2）/);
    assert.equal(window.document.getElementById("clearFill").hidden, false, "扫描后清空链接应显示");
    await clearFill();
    await new Promise(resolve => setTimeout(resolve, 0)); // 让 clearFill 内未 await 的 renderFillTemplate 完成，避免 close 后访问已销毁的 document
    assert.equal(window.document.getElementById("clearFill").hidden, true, "清空后清空链接应隐藏");
  } finally { close(); }
});

// —— 点击字段填充（P1 任务5） ——
test("点击字段填充：填入页面按钮发送拾取请求并提示", async () => {
  const { sentTypes, close } = setupOneClickDom();
  const { setProfiles, setActiveProfileIndex, setFillScanSession } = await import("../src/state.js");
  const { startPickFill } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三", phone: "13800138000" } }]);
    setActiveProfileIndex(0);
    setFillScanSession({ tabId: 7, scanId: "s1", documentFingerprint: "d1", formFingerprint: "f1", url: "https://jobs.example.com/apply" });
    await startPickFill("name");
    assert.ok(sentTypes.includes("SMART_FILL_PICK_START"), "应向页面发送拾取请求");
    assert.match(window.document.getElementById("toast").textContent, /点击要填入的位置/);
  } finally { close(); }
});

test("点击字段填充：简历字段为空时不发送拾取请求", async () => {
  const { sentTypes, close } = setupOneClickDom();
  const { setProfiles, setActiveProfileIndex, setFillScanSession } = await import("../src/state.js");
  const { startPickFill } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三" } }]);
    setActiveProfileIndex(0);
    setFillScanSession({ tabId: 7, scanId: "s1", documentFingerprint: "d1", formFingerprint: "f1", url: "https://jobs.example.com/apply" });
    await assert.rejects(() => startPickFill("email"), /暂无内容/);
    assert.ok(!sentTypes.includes("SMART_FILL_PICK_START"), "空字段不得发起拾取");
  } finally { close(); }
});

// —— 选区填充（Wave 2 任务3） ——
test("选区填充：点击「选区填充」按钮后发送 SMART_FILL_PICK_REGION 消息", async () => {
  const { sentTypes, close } = setupOneClickDom();
  const { setFillScanSession } = await import("../src/state.js");
  const { initFillUi } = await import("../src/fill-ui.js");
  try {
    setFillScanSession({ tabId: 7, scanId: "s1", documentFingerprint: "d1", formFingerprint: "f1", url: "https://jobs.example.com/apply" });
    await initFillUi();
    const button = window.document.getElementById("regionFill");
    assert.ok(button, "「选区填充」按钮应动态创建于智能填充工具条");
    assert.equal(typeof button.onclick, "function", "「选区填充」按钮应绑定点击事件");
    button.click();
    await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(sentTypes.includes("SMART_FILL_PICK_REGION"), "点击后应向页面发送选区拾取请求");
    assert.match(window.document.getElementById("toast").textContent, /容器/, "应提示用户点击页面容器");
  } finally { close(); }
});

// —— 选区填充：非空结果重建会话（Wave 2 任务3 质量修复） ——
test("选区填充：非空选区结果经 SMART_FILL_SCAN(region) 重建会话并渲染", async () => {
  const dom = new JSDOM(html, { url: "chrome-extension://hunter/panel.html", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const sentMessages = [];
  window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  window.confirm = () => true;
  window.prompt = () => null;
  globalThis.window = window;
  globalThis.document = window.document;
  const tab = { id: 7, url: "https://jobs.example.com/apply" };
  const REGION_FIELDS = [
    { id: "r-contact-name", type: "text", label: "联系人姓名", rawLabel: "联系人姓名", labelSource: "label", skipped: false, options: [], fingerprint: "fp-cn", path: "#contact-name", evidence: [{ source: "label", text: "联系人姓名" }], context: {}, attributes: {} },
    { id: "r-contact-phone", type: "tel", label: "联系人电话", rawLabel: "联系人电话", labelSource: "label", skipped: false, options: [], fingerprint: "fp-cp", path: "#contact-phone", evidence: [{ source: "label", text: "联系人电话" }], context: {}, attributes: {} },
  ];
  globalThis.chrome = {
    storage: { local: { get: async keys => {
      const list = typeof keys === "string" ? [keys] : keys;
      const out = {};
      for (const k of list) { if (k === "smartFillTemplates") out[k] = {}; else if (k === "smartFillLogs") out[k] = []; else if (k === "smartFillSettings") out[k] = {}; else out[k] = undefined; }
      return out;
    }, set: async () => {} } },
    runtime: { sendMessage: (_m, cb) => cb && cb({ ok: true }), onMessage: { addListener() {} }, connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {} }), getURL: p => p },
    tabs: {
      query: async () => [tab],
      sendMessage: async (_id, message) => {
        sentMessages.push(message);
        if (message.type === "SMART_FILL_SCAN" && message.region === "#emergency") {
          return { ok: true, engineVersion: 3, fields: REGION_FIELDS, repeaters: [], page: { title: "apply", url: tab.url, host: "jobs.example.com" }, scanId: "s-region", documentFingerprint: "d-region", formFingerprint: "f-region" };
        }
        return { ok: true };
      },
    },
  };
  const { state, setProfiles, setActiveProfileIndex, setFillScanSession } = await import("../src/state.js");
  const { handleFillRuntimeMessage, startPickRegion } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三", phone: "13800138000" } }]);
    setActiveProfileIndex(0);
    setFillScanSession({ tabId: 7, scanId: "s1", documentFingerprint: "d1", formFingerprint: "f1", url: "https://jobs.example.com/apply" });
    // 走真实流程：先进入选区拾取态，再回传与请求同 requestId 的结果
    await startPickRegion();
    const pickMsg = sentMessages.find(m => m.type === "SMART_FILL_PICK_REGION");
    assert.ok(pickMsg, "应已发送选区拾取请求");
    handleFillRuntimeMessage({
      type: "SMART_FILL_PICK_REGION_RESULT", requestId: pickMsg.requestId, ok: true,
      regionPath: "#emergency", regionLabel: "emergency", fields: REGION_FIELDS,
    });
    // 等待异步重建：applyRegionFillResult → SMART_FILL_SCAN(region) → buildMatches → renderFillTemplate
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      if (sentMessages.some(m => m.type === "SMART_FILL_SCAN") && window.document.getElementById("fillResultList").textContent.includes("联系人姓名")) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(sentMessages.some(m => m.type === "SMART_FILL_SCAN" && m.region === "#emergency"), "非空选区应发起 region 重扫建立真实会话");
    assert.equal(state.fillScanSession.scanId, "s-region", "选区重扫后会话应指向选区内扫描");
    assert.match(window.document.getElementById("fillCurrentSiteText").textContent, /选区「emergency」：识别到 2 个表单项/);
    assert.ok(window.document.getElementById("fillResultList").textContent.includes("联系人姓名"), "匹配列表应渲染选区内字段");
    assert.match(window.document.getElementById("toast").textContent, /已识别选区内 2 个字段/);
    // 恢复会话，避免影响后续依赖 s1 会话的用例（既有测试间的隐式顺序依赖）
    setFillScanSession({ tabId: 7, scanId: "s1", documentFingerprint: "d1", formFingerprint: "f1", url: "https://jobs.example.com/apply" });
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.chrome;
    dom.window.close();
  }
});

// —— 增量续填（P1 任务6） ——
test("增量续填：收到新字段通知后显示继续填写提示（3 轮内）", async () => {
  const dom = new JSDOM(html, { url: "chrome-extension://hunter/panel.html", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  globalThis.window = window;
  globalThis.document = window.document;
  const { setProfiles, setActiveProfileIndex, setFillContinueRounds } = await import("../src/state.js");
  const { handleFillRuntimeMessage } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三" } }]);
    setActiveProfileIndex(0);
    setFillContinueRounds(0);
    const btn = window.document.getElementById("continueFill");
    assert.ok(btn, "continueFill 按钮应存在");
    assert.equal(btn.hidden, true, "默认隐藏");
    handleFillRuntimeMessage({ type: "SMART_FILL_NEW_FIELDS", count: 5, scanId: "s1" });
    assert.equal(btn.hidden, false, "收到通知后应显示");
    assert.match(btn.textContent, /继续填写/);
    assert.match(btn.textContent, /5/, "应显示新字段数量");
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    dom.window.close();
  }
});

test("增量续填：达到 3 轮后不再提示", async () => {
  const dom = new JSDOM(html, { url: "chrome-extension://hunter/panel.html", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  globalThis.window = window;
  globalThis.document = window.document;
  const { setProfiles, setActiveProfileIndex, setFillContinueRounds } = await import("../src/state.js");
  const { handleFillRuntimeMessage } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三" } }]);
    setActiveProfileIndex(0);
    setFillContinueRounds(3);
    const btn = window.document.getElementById("continueFill");
    handleFillRuntimeMessage({ type: "SMART_FILL_NEW_FIELDS", count: 5, scanId: "s1" });
    assert.equal(btn.hidden, true, "3 轮后不再提示");
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    dom.window.close();
  }
});

// —— 一键智能填充：未授权场景（P1 任务4 回归） ——
test("一键智能填充：未授权时不填充并提示授权", async () => {
  const dom = new JSDOM(html, { url: "chrome-extension://hunter/panel.html", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  globalThis.window = window;
  globalThis.document = window.document;
  const appliedFills = [];
  const tab = { id: 9, url: "https://jobs.example.com/apply" };
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
    runtime: { sendMessage: (_m, cb) => { if (cb) cb({ ok: true }); }, onMessage: { addListener() {} }, connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {} }), getURL: p => p },
    tabs: {
      query: async () => [tab],
      sendMessage: async (_id, message) => {
        if (message.type === "SMART_FILL_APPLY") appliedFills.push(...message.fills);
        return { ok: true };
      },
    },
    permissions: { contains: async () => false, request: async () => false },
    scripting: { executeScript: async () => [] },
  };
  const { setProfiles, setActiveProfileIndex, setFillAutoMode } = await import("../src/state.js");
  const { runSmartFillOnce } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三", phone: "13800138000" } }]);
    setActiveProfileIndex(0);
    setFillAutoMode(true);
    await runSmartFillOnce();
    assert.deepEqual(appliedFills, [], "未授权时不得填充");
    assert.match(window.document.getElementById("toast").textContent, /需要授权/);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.chrome;
    dom.window.close();
  }
});

// —— 撤销本次填充（Wave 3 任务2） ——
test("撤销本次填充：按钮存在、初始禁用、填充后启用且点击发送 SMART_FILL_UNDO", async () => {
  const dom = new JSDOM(html, { url: "chrome-extension://hunter/panel.html", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  const sentTypes = [];
  const tab = { id: 7, url: "https://jobs.example.com/apply" };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  window.confirm = () => true;
  window.prompt = () => null;
  globalThis.window = window;
  globalThis.document = window.document;
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
    runtime: { sendMessage: (_m, cb) => { if (cb) cb({ ok: true }); }, onMessage: { addListener() {} }, connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {} }), getURL: p => p },
    tabs: {
      query: async () => [tab],
      sendMessage: async (_id, message) => {
        sentTypes.push(message.type);
        if (message.type === "SMART_FILL_SCAN") {
          return { ok: true, engineVersion: 3, fields: ONECLICK_SCAN_FIELDS, repeaters: [], page: { title: "apply", url: tab.url, host: "jobs.example.com" }, scanId: "s1", documentFingerprint: "d1", formFingerprint: "f1" };
        }
        if (message.type === "SMART_FILL_APPLY") {
          return { ok: true, results: message.fills.map(f => ({ id: f.id, ok: true, resolvedFingerprint: f.fingerprint })) };
        }
        if (message.type === "SMART_FILL_UNDO") {
          return { ok: true, count: 2 };
        }
        return { ok: true };
      },
    },
    permissions: { contains: async () => true, request: async () => true },
    scripting: { executeScript: async () => [] },
  };
  const { setProfiles, setActiveProfileIndex, setFillAutoMode } = await import("../src/state.js");
  const { runSmartFillOnce, initFillUi } = await import("../src/fill-ui.js");
  try {
    await initFillUi();
    await new Promise(resolve => setTimeout(resolve, 0)); // 等 initFillUi 内未 await 的异步渲染完成
    const btn = window.document.getElementById("smartFillUndo");
    assert.ok(btn, "「撤销本次填充」按钮应动态创建");
    assert.equal(btn.disabled, true, "初始应禁用");
    assert.match(btn.textContent, /撤销本次填充/);
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三", phone: "13800138000" } }]);
    setActiveProfileIndex(0);
    setFillAutoMode(true);
    await runSmartFillOnce();
    assert.equal(btn.disabled, false, "填充成功后应启用");
    btn.click();
    await new Promise(resolve => setTimeout(resolve, 0)); // 等 undoLastFill 的异步链路完成
    assert.ok(sentTypes.includes("SMART_FILL_UNDO"), "点击后应向 content 发送 SMART_FILL_UNDO");
    assert.equal(btn.disabled, true, "撤销成功后应再次禁用");
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.chrome;
    dom.window.close();
  }
});

// —— 诊断导出 + AI 缓存 + playbook 覆盖层（Wave 4 任务4） ——
test("诊断导出：按钮存在且 exportDiagnosticsJson 返回含 scanId、matchedBy 且脱敏的 JSON", async () => {
  const dom = new JSDOM(html, { url: "chrome-extension://hunter/panel.html", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  window.confirm = () => true;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    runtime: { sendMessage: (_m, cb) => cb && cb({ ok: true }), onMessage: { addListener() {} }, connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {} }), getURL: p => p },
    tabs: { query: async () => [] },
  };
  const { state, setFillScanSession, setFillScanFields, setFillMatches } = await import("../src/state.js");
  const { initFillUi, exportDiagnosticsJson } = await import("../src/fill-ui.js");
  try {
    await initFillUi();
    await new Promise(resolve => setTimeout(resolve, 0)); // 等动态按钮创建完成
    const btn = window.document.getElementById("exportDiagnostics");
    assert.ok(btn, "「导出诊断包」按钮应动态创建");
    assert.match(btn.textContent, /导出诊断包/);
    assert.equal(typeof btn.onclick, "function", "导出按钮应绑定 onclick");
    setFillScanSession({ tabId: 7, scanId: "diag-s1", engineVersion: 3, url: "https://jobs.example.com/apply?token=abc", documentFingerprint: "d1", formFingerprint: "f1" });
    setFillScanFields([
      { id: "f-name", type: "text", label: "姓名", skipped: false },
      { id: "f-phone", type: "tel", label: "手机号", skipped: false },
    ]);
    setFillMatches([
      { fieldId: "f-name", fieldKey: "name", value: "张三", status: "match", source: "rule", type: "text", label: "姓名" },
      { fieldId: "f-phone", fieldKey: "phone", value: "13800138000", status: "match", source: "playbook", type: "tel", label: "手机号" },
    ]);
    state.fillMatches[1].fillError = "回读校验失败";
    const json = exportDiagnosticsJson();
    const parsed = JSON.parse(json);
    assert.equal(parsed.scanId, "diag-s1", "诊断 JSON 应包含 scanId");
    assert.equal(parsed.engineVersion, 3, "诊断 JSON 应包含 engineVersion");
    assert.equal(parsed.matchedBy.rule, 1, "matchedBy 应统计 rule 来源");
    assert.equal(parsed.matchedBy.playbook, 1, "matchedBy 应统计 playbook 来源");
    assert.equal(parsed.failures.length, 1, "fillError 非空的 match 应进入失败列表");
    assert.ok(!json.includes("13800138000"), "诊断 JSON 不得包含手机号等敏感值");
    assert.ok(!json.includes("token=abc"), "诊断 JSON 的 URL 应去除 query");
    assert.ok(json.includes("jobs.example.com/apply"), "诊断 JSON 应保留脱敏后的 URL");
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.chrome;
    dom.window.close();
  }
});

test("AI 映射缓存：相同结构第二次 buildMatches 命中缓存不再调用 AI", async () => {
  const dom = new JSDOM(html, { url: "chrome-extension://hunter/panel.html", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  window.confirm = () => true;
  globalThis.window = window;
  globalThis.document = window.document;
  let aiCalls = 0;
  const tab = { id: 7, url: "https://jobs.example.com/apply" };
  const scanFields = [
    { id: "f-unknown", type: "text", label: "神秘字段ZZZ", rawLabel: "神秘字段ZZZ", labelSource: "label", skipped: false, options: [], fingerprint: "fp-zzz", path: "#f-unknown", evidence: [{ source: "label", text: "神秘字段ZZZ" }], context: {}, attributes: {} },
  ];
  globalThis.chrome = {
    storage: { local: {
      get: async keys => {
        const list = typeof keys === "string" ? [keys] : keys;
        const out = {};
        for (const k of list) {
          if (k === "smartFillTemplates") out[k] = {};
          else if (k === "smartFillLogs") out[k] = [];
          else if (k === "smartFillSettings") out[k] = { aiEnabled: true };
          else if (k === "aiConsented") out[k] = true;
          else out[k] = undefined;
        }
        return out;
      },
      set: async () => {},
    } },
    runtime: {
      sendMessage: (message, callback) => {
        if (message.type === "PARSE_JSON") {
          if (callback) callback({ ok: true, data: [{ fieldId: "f-unknown", fieldKey: "name", confidence: "medium", reason: "测试" }] });
          return;
        }
        if (message.type === "AI_CALL") aiCalls++;
        if (callback) callback({ ok: true });
      },
      onMessage: { addListener() {} },
      connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {} }),
      getURL: p => p,
    },
    tabs: {
      query: async () => [tab],
      sendMessage: async (_id, message) => {
        if (message.type === "SMART_FILL_SCAN") {
          return { ok: true, engineVersion: 3, fields: scanFields, repeaters: [], page: { title: "apply", url: tab.url, host: "jobs.example.com" }, scanId: "s1", documentFingerprint: "d1", formFingerprint: "f1" };
        }
        return { ok: true };
      },
    },
    permissions: { contains: async () => true, request: async () => true },
    scripting: { executeScript: async () => [] },
  };
  const { state, setProfiles, setActiveProfileIndex, setFillAutoMode, setConfig } = await import("../src/state.js");
  const { scanFillPage } = await import("../src/fill-ui.js");
  try {
    setConfig({ apiKey: "test-key", model: "test-model" });
    window.document.getElementById("apiKey").value = "test-key";
    window.document.getElementById("model").value = "test-model";
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三" } }]);
    setActiveProfileIndex(0);
    setFillAutoMode(false);
    await scanFillPage();
    assert.equal(state.fillScanSession.engineVersion, 3, "扫描会话应记录 engineVersion");
    assert.equal(aiCalls, 1, "首次匹配应调用 AI");
    await scanFillPage();
    assert.equal(aiCalls, 1, "第二次相同结构匹配应命中 AI 缓存，不再调用 AI");
  } finally {
    setConfig({});
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.chrome;
    dom.window.close();
  }
});

test("playbook 覆盖层：moka 站点规则之上的字段应用站点映射，敏感 manual 字段不被覆盖", async () => {
  const dom = new JSDOM(html, { url: "chrome-extension://hunter/panel.html", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
  window.confirm = () => true;
  globalThis.window = window;
  globalThis.document = window.document;
  const tab = { id: 7, url: "https://app.mokahr.com/campus_apply/123" };
  const scanFields = [
    { id: "m-name", type: "text", label: "姓名", rawLabel: "姓名", labelSource: "label", skipped: false, options: [], fingerprint: "fp-name", path: "#m-name", evidence: [{ source: "label", text: "姓名" }], context: {}, attributes: {} },
    { id: "m-idcard", type: "text", label: "身份证号", rawLabel: "身份证号", labelSource: "label", skipped: false, options: [], fingerprint: "fp-id", path: "#m-id", evidence: [{ source: "label", text: "身份证号" }], context: {}, attributes: {} },
  ];
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
    runtime: { sendMessage: (_m, cb) => { if (cb) cb({ ok: true }); }, onMessage: { addListener() {} }, connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {} }), getURL: p => p },
    tabs: {
      query: async () => [tab],
      sendMessage: async (_id, message) => {
        if (message.type === "SMART_FILL_SCAN") {
          return { ok: true, engineVersion: 3, fields: scanFields, repeaters: [], page: { title: "apply", url: tab.url, host: "app.mokahr.com" }, scanId: "s-moka", documentFingerprint: "dm", formFingerprint: "fm" };
        }
        return { ok: true };
      },
    },
    permissions: { contains: async () => true, request: async () => true },
    scripting: { executeScript: async () => [] },
  };
  const { state, setProfiles, setActiveProfileIndex, setFillAutoMode } = await import("../src/state.js");
  const { scanFillPage } = await import("../src/fill-ui.js");
  try {
    setProfiles([{ name: "测试简历", resumeFields: { name: "张三", idCard: "110101199806010011" } }]);
    setActiveProfileIndex(0);
    setFillAutoMode(false);
    await scanFillPage();
    const nameMatch = state.fillMatches.find(m => m.fieldId === "m-name");
    assert.ok(nameMatch, "应包含姓名匹配");
    assert.equal(nameMatch.source, "playbook", "规则之上的 playbook 覆盖层应应用站点映射");
    assert.equal(nameMatch.fieldKey, "name", "playbook 应映射到 name");
    assert.equal(nameMatch.status, "match");
    const idMatch = state.fillMatches.find(m => m.fieldId === "m-idcard");
    assert.ok(idMatch, "应包含身份证号匹配");
    assert.notEqual(idMatch.source, "playbook", "敏感 manual 字段不应被 playbook 覆盖");
    assert.equal(idMatch.status, "manual", "敏感字段应保持需人工确认");
  } finally {
    delete globalThis.window;
    delete globalThis.document;
    delete globalThis.chrome;
    dom.window.close();
  }
});
