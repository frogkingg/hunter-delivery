import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { matchRules, SENSITIVE_FIELD_KEYS } from "../src/matcher.js";

const engineSource = readFileSync(new URL("../fill-content.js", import.meta.url), "utf8");
const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const FULL_RESUME = {
  name: "张三", phone: "13800138000", email: "zhangsan@example.com", qq: "12345678", gender: "男", birthDate: "1998-06",
  idCard: "110101199806010011", hometown: "北京", currentCity: "上海", address: "上海市浦东新区", postcode: "200120",
  school: "复旦大学", degree: "本科", major: "计算机科学与技术", graduationYear: "2020", workYears: "5年",
  currentCompany: "某科技公司", currentTitle: "产品经理", expectedCity: "上海", expectedSalary: "30-40K",
  expectedPosition: "高级产品经理", selfEvaluation: "5 年产品经验，擅长需求分析", skills: "Axure、SQL、Python",
  languages: "英语 CET-6", hobbies: "阅读", availableTime: "随时到岗", referral: "王五",
  referralCode: "SSG2026",
  github: "https://github.com/zhangsan", linkedin: "https://linkedin.com/in/zhangsan",
  politicalStatus: "群众", maritalStatus: "未婚", portfolio: "https://zhangsan.dev",
  internshipCompany: "字节跳动", internshipTitle: "产品实习生", internshipPeriod: "2021-06 至 2021-09",
  internshipDescription: "用户调研与需求文档撰写", projectName: "智能招聘平台", projectRole: "项目负责人",
  projectDescription: "简历匹配算法，召回率提升 20%",
};

function loadFixture(name) {
  const dom = new JSDOM(fixture(name), { url: `https://apply.example.com/${name}`, runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(engineSource);
  return dom;
}

const FIXTURES = [
  { name: "antd-generic.html", totalControls: 13, expectFields: 12 },
  { name: "zhilian.html", totalControls: 12, expectFields: 11 },
  { name: "moka.html", totalControls: 10, expectFields: 10 },
  { name: "beisen.html", totalControls: 17, expectFields: 17 },
  { name: "dayi.html", totalControls: 9, expectFields: 9 },
  { name: "seasun.html", totalControls: 8, expectFields: 8 },
];

// 每个夹具的标签 -> 期望字段 key 映射（含 skipped 与手动项）。
const EXPECTED_MAP = {
  "antd-generic.html": { 姓名: "name", 手机号码: "phone", 邮箱: "email", 性别: "gender", 最高学历: "degree", 毕业院校: "school", 期望薪资: "expectedSalary", 自我评价: "selfEvaluation", 到岗时间: "availableTime", 技能: null },
  "zhilian.html": { 姓名: "name", 手机号: "phone", 邮箱: "email", 性别: "gender", 学历: "degree", 专业: "major", 毕业院校: "school", 期望城市: "expectedCity", 期望职位: "expectedPosition", 到岗时间: "availableTime", 自我评价: "selfEvaluation" },
  "moka.html": { 姓名: "name", 联系电话: "phone", 邮箱: "email", 现居城市: "currentCity", 毕业院校: "school", 学历: "degree", 专业: "major", 工作年限: "workYears", 自我介绍: "selfEvaluation", 出生日期: "birthDate" },
  "beisen.html": { 姓名: "name", 手机号: "phone", 邮箱: "email", 性别: "gender", 生日: "birthDate", 籍贯: "hometown", 政治面貌: "politicalStatus", 婚姻状况: "maritalStatus", 通讯地址: "address", 邮编: "postcode", 实习公司: "internshipCompany", 实习岗位: "internshipTitle", 实习时间: "internshipPeriod", 实习内容: "internshipDescription", 项目名称: "projectName", 项目角色: "projectRole", 项目内容: "projectDescription" },
  "dayi.html": { 姓名: "name", 手机号: "phone", 邮箱: "email", 毕业院校: "school", 专业: "major", 期望薪资: null, 到岗时间: "availableTime", 自我评价: "selfEvaluation", 我同意以上信息属实: null },
  "seasun.html": { 推荐码: "referralCode", 姓名: "name", 手机区号: "phone", 手机号码: "phone", 邮箱: "email", 性别: "gender", QQ: "qq", 所在地: "currentCity" },
};

for (const f of FIXTURES) {
  test(`识别率 ≥90%：${f.name}`, () => {
    const dom = loadFixture(f.name);
    const { fields, page } = dom.window.__hunterFill.scan(dom.window.document);
    assert.ok(fields.length >= f.totalControls * 0.9, `识别 ${fields.length}/${f.totalControls}`);
    assert.equal(fields.length, f.expectFields, "不应出现重复/漏检");
    assert.equal(page.host, "apply.example.com");
    assert.ok(page.title);
    const ids = new Set(fields.map(field => field.id));
    assert.equal(ids.size, fields.length, "fieldId 必须唯一");
    dom.window.close();
  });
}

test("antd: 类型/选项/skipped 语义正确", () => {
  const dom = loadFixture("antd-generic.html");
  const { fields } = dom.window.__hunterFill.scan(dom.window.document);
  const byLabel = Object.fromEntries(fields.map(field => [field.label, field]));
  assert.equal(byLabel["性别"].type, "radio");
  assert.equal(byLabel["性别"].options.join(","), "男,女");
  assert.equal(byLabel["到岗时间"].type, "custom-select");
  assert.equal(byLabel["技能"].type, "checkbox");
  const skipped = fields.filter(field => field.skipped).map(field => field.label);
  assert.ok(skipped.includes("密码") && skipped.includes("上传简历"), `skipped=${skipped}`);
  assert.equal(byLabel["姓名"].required, true);
  dom.window.close();
});

test("匹配：6 个夹具的常见字段与复杂字段", () => {
  let total = 0, correct = 0, manualExpected = 0, manualCorrect = 0;
  for (const f of FIXTURES) {
    const dom = loadFixture(f.name);
    const { fields } = dom.window.__hunterFill.scan(dom.window.document);
    const expected = EXPECTED_MAP[f.name];
    const results = matchRules(fields, FULL_RESUME);
    for (const result of results) {
      const label = result.label;
      if (!(label in expected)) continue;
      total += 1;
      const want = expected[label];
      if (want === null) {
        manualExpected += 1;
        if (result.status === "manual") manualCorrect += 1;
      } else if (result.fieldKey === want && result.status === "match") {
        correct += 1;
      } else if (result.fieldKey === want && result.status === "manual" && SENSITIVE_FIELD_KEYS.has(want)) {
        // 敏感字段按策略强制人工：识别正确即算正确处理（填充需用户显式确认）。
        correct += 1;
      }
    }
    dom.window.close();
  }
  assert.equal(manualExpected, 3, `应存在 3 个需手动字段（技能勾选/同意勾选/选项不匹配），实际 ${manualExpected}`);
  assert.equal(manualCorrect, 3);
  // 匹配率口径：正确匹配 + 正确判为「需手动」都算正确处理。
  assert.ok((correct + manualCorrect) / total >= 0.95, `标签匹配率 ${correct + manualCorrect}/${total}`);
});

test("填充执行：6 个夹具原生/下拉/单选/多选/日期全部成功", async () => {
  for (const f of FIXTURES) {
    const dom = loadFixture(f.name);
    const engine = dom.window.__hunterFill;
    const { fields } = engine.scan(dom.window.document);
    const expected = EXPECTED_MAP[f.name];
    const results = matchRules(fields, FULL_RESUME);
    const fills = results
      .filter(m => m.status === "match" && expected[m.label])
      .map(m => ({ id: m.fieldId, value: m.value, type: fields.find(x => x.id === m.fieldId).type }));
    if (f.name === "antd-generic.html") {
      // 模拟 antd：点击下拉选项后回填容器展示值
      const arrivalOptions = dom.window.document.querySelectorAll(".ant-select-dropdown .ant-select-item-option");
      const arrivalContainer = dom.window.document.getElementById("arrival");
      for (const option of arrivalOptions) {
        option.addEventListener("click", () => { arrivalContainer.textContent = option.textContent; });
      }
    }
    if (f.name === "seasun.html") {
      const countrySelect = dom.window.document.querySelector(".ant-select");
      countrySelect.addEventListener("click", () => {
        if (dom.window.document.querySelector(".ant-select-dropdown")) return;
        const list = dom.window.document.createElement("div");
        list.className = "ant-select-dropdown";
        list.innerHTML = `<div class="ant-select-dropdown-menu-item">+86 中国大陆</div><div class="ant-select-dropdown-menu-item">+852 中国香港</div>`;
        dom.window.document.body.appendChild(list);
        list.querySelector(".ant-select-dropdown-menu-item").addEventListener("click", () => {
          countrySelect.querySelector("input").value = "+86";
        });
      });
    }
    const applied = await engine.apply(fills, { delayMs: 0 });
    const failed = applied.filter(r => !r.ok);
    assert.equal(failed.length, 0, `${f.name} 填充失败: ${JSON.stringify(failed.map(r => ({ id: r.id, error: r.error })))}`);
    // 回读验证
    const doc = dom.window.document;
    const byLabel = Object.fromEntries(fields.map(field => [field.label, field]));
    if (byLabel["姓名"]) {
      const nameInput = doc.getElementById("name") || doc.querySelector("[name=name]") || doc.querySelector(byLabel["姓名"].path);
      assert.equal(nameInput.value, "张三");
      assert.equal(applied.find(r => r.id === byLabel["姓名"].id).retried, false, "非受控表单应走标准路径 retried:false");
    }
    if (byLabel["手机号码"] || byLabel["手机号"]) {
      const phone = doc.querySelector("[name=phone], #mobile, .index-phoneInput-a1");
      assert.equal(phone.value, "13800138000");
    }
    if (byLabel["性别"]) assert.equal(doc.querySelector("input[type=radio][value=男]").checked, true);
    if (f.name === "beisen.html") {
      const marriage = doc.querySelector("[name=marriage]");
      assert.equal(marriage.value, "1", "value≠label 的 select 应按选项文本选中（未婚→1）");
      assert.equal(doc.querySelector("[name=postcode]").value, "200120");
      assert.equal(doc.querySelector("[name=internCompany]").value, "字节跳动");
      assert.equal(doc.querySelector("[name=internPeriod]").value, "2021-06 至 2021-09");
      assert.ok(doc.querySelector("[name=projectDesc]").value.includes("简历匹配算法"));
    }
    if (f.name === "seasun.html") {
      assert.equal(doc.querySelector(".ant-select-selection-search-input").value, "+86");
      assert.equal(doc.querySelector("#personalInformation .index-itemInput-a1").value, "张三");
      assert.equal(doc.querySelector("input[type=radio][value=男]").checked, true);
    }
    dom.window.close();
  }
});

test("highlight/reset：高亮类名与清理", () => {
  const dom = loadFixture("moka.html");
  const engine = dom.window.__hunterFill;
  const { fields } = engine.scan(dom.window.document);
  engine.highlight([fields[0].id], true, dom.window.document);
  assert.ok(dom.window.document.querySelector(".hunter-fill-highlight"));
  engine.reset(dom.window.document);
  assert.equal(dom.window.document.querySelectorAll(".hunter-fill-highlight").length, 0);
  dom.window.close();
});

test("apply：进度回调与取消信号", async () => {
  const dom = loadFixture("moka.html");
  const engine = dom.window.__hunterFill;
  const { fields } = engine.scan(dom.window.document);
  const fills = [{ id: fields[0].id, value: "李四", type: "text" }];
  const progress = [];
  await engine.apply(fills, { delayMs: 0, onProgress: item => progress.push(item) });
  assert.equal(progress.length, 1);
  assert.equal(progress[0].ok, true);
  const cancelled = await engine.apply(fills, { signal: { cancelled: true } });
  assert.equal(cancelled.length, 0, "取消后不应继续填充");
  dom.window.close();
});

test("hidden 输入不进入扫描结果", () => {
  const dom = loadFixture("dayi.html");
  const { fields } = dom.window.__hunterFill.scan(dom.window.document);
  assert.ok(!fields.some(f => f.label === "" && f.skipped), "hidden 控件不应输出为需手动字段");
  assert.equal(fields.length, 9, "hidden 不增加字段数");
  dom.window.close();
});

test("选区填充：region 限定扫描范围", () => {
  const dom = loadFixture("region-form.html");
  const doc = dom.window.document;
  const region = doc.querySelector("#emergency");
  const { fields } = dom.window.__hunterFill.scan(doc, { region });
  assert.ok(fields.length === 2, `应只识别选区内字段：${fields.length}`);
  assert.ok(fields.every(f => /紧急联系人|联系人/.test(f.label)));
  dom.window.close();
});

test("选区填充：region 选择器未命中时不回退全页扫描", () => {
  const dom = loadFixture("region-form.html");
  const { fields } = dom.window.__hunterFill.scan(dom.window.document, { region: "#not-exists" });
  assert.equal(fields.length, 0, "未命中选择器应返回空结果而非全页 4 个字段");
  dom.window.close();
});

test("选区填充：拾取容器返回选区内字段且不覆盖全页会话（dryRun）", async () => {
  const dom = loadFixture("region-form.html");
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  const full = engine.scan(doc);
  const nameField = full.fields.find(f => f.label === "姓名");
  const picking = engine.pickRegion();
  doc.querySelector("#emergency").dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  const result = await picking;
  assert.equal(result.ok, true);
  assert.equal(result.regionPath, "section#emergency");
  assert.equal((result.fields || []).length, 2);
  assert.ok(result.fields.every(f => /联系人/.test(f.label)));
  // dryRun 选区扫描不得覆盖全局会话：旧 scanId 填充仍成功
  const filled = await engine.fillField({ id: nameField.id, value: "李四" }, {
    scanId: full.scanId, documentFingerprint: full.documentFingerprint, formFingerprint: full.formFingerprint,
  });
  assert.equal(filled.ok, true);
  assert.equal(doc.getElementById("name").value, "李四");
  dom.window.close();
});

test("选区填充：0 字段选区拾取不覆盖全局会话（避免 content/panel 脱同步）", async () => {
  const dom = loadFixture("region-form.html");
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  const full = engine.scan(doc);
  const nameField = full.fields.find(f => f.label === "姓名");
  // 选区容器含控件但全部不可见：scan 输出 0 字段（拾取判定只看控件存在性）
  const basic = doc.querySelector("#basic");
  basic.setAttribute("hidden", "");
  const picking = engine.pickRegion();
  basic.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  const result = await picking;
  assert.equal(result.ok, true);
  assert.equal((result.fields || []).length, 0, "隐藏控件选区内应 0 字段");
  // 全局会话仍是全页会话：旧 scanId 填充成功，不会报「扫描会话已过期」
  const filled = await engine.fillField({ id: nameField.id, value: "李四" }, {
    scanId: full.scanId, documentFingerprint: full.documentFingerprint, formFingerprint: full.formFingerprint,
  });
  assert.equal(filled.ok, true);
  assert.equal(doc.getElementById("name").value, "李四");
  dom.window.close();
});

test("自定义下拉：关闭态展开后选择选项并通过回读校验", async () => {
  const dom = loadFixture("antd-generic.html");
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  doc.querySelector(".ant-select-dropdown").remove(); // 模拟关闭态：选项不在 DOM
  const container = doc.getElementById("arrival");
  container.addEventListener("click", () => { // 模拟 antd 展开时挂载选项并回填展示值
    const dropdown = doc.createElement("div");
    dropdown.className = "ant-select-dropdown";
    dropdown.innerHTML = `<div class="ant-select-item-option">随时到岗</div><div class="ant-select-item-option">一个月内</div>`;
    doc.body.appendChild(dropdown);
    dropdown.querySelector(".ant-select-item-option").addEventListener("click", () => {
      container.textContent = "随时到岗";
    });
  });
  const { fields } = engine.scan(doc);
  const arrival = fields.find(f => f.type === "custom-select");
  const applied = await engine.apply([{ id: arrival.id, value: "随时到岗", type: "custom-select" }], { delayMs: 0 });
  assert.equal(applied[0].ok, true, JSON.stringify(applied[0]));
  dom.window.close();
});

test("自定义下拉：无法回读时如实报错而非假成功", async () => {
  const dom = loadFixture("antd-generic.html");
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  doc.querySelector(".ant-select-dropdown").remove();
  const container = doc.getElementById("arrival");
  container.addEventListener("click", () => {
    const dropdown = doc.createElement("div");
    dropdown.className = "ant-select-dropdown";
    dropdown.innerHTML = `<div class="ant-select-item-option">随时到岗</div>`;
    doc.body.appendChild(dropdown);
    dropdown.querySelector(".ant-select-item-option").addEventListener("click", () => {}); // 点击后不回填（受控组件未提交）
  });
  const { fields } = engine.scan(doc);
  const arrival = fields.find(f => f.type === "custom-select");
  const applied = await engine.apply([{ id: arrival.id, value: "随时到岗", type: "custom-select" }], { delayMs: 0 });
  assert.equal(applied[0].ok, false, "点击未生效且展示值未反映时应如实报错");
  assert.match(applied[0].error || "", /无法确认选择结果|选项未找到/);
  dom.window.close();
});

test("apply：填充中途可取消", async () => {
  const dom = loadFixture("moka.html");
  const engine = dom.window.__hunterFill;
  const { fields } = engine.scan(dom.window.document);
  const signal = { cancelled: false };
  const fills = fields.filter(f => !f.skipped).slice(0, 4).map(f => ({ id: f.id, value: "测试值", type: f.type }));
  const applied = await engine.apply(fills, {
    delayMs: 0,
    signal,
    onProgress: item => { if (item.index >= 2) signal.cancelled = true; },
  });
  assert.equal(applied.length, 2, "第二个字段完成后应停止");
  dom.window.close();
});

test("页面重渲染后填充定位正确（按 path 重新解析，不写旧节点）", async () => {
  const dom = loadFixture("moka.html");
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  const { fields } = engine.scan(doc);
  const nameField = fields.find(f => f.label === "姓名");
  const phoneField = fields.find(f => f.label === "联系电话");
  // 模拟 React 重渲染：用同 id 的新节点替换旧节点（旧节点脱离文档）
  const oldName = doc.getElementById("m-name");
  const newName = doc.createElement("input");
  newName.id = "m-name"; newName.name = "name"; newName.type = "text";
  oldName.replaceWith(newName);
  const oldPhone = doc.getElementById("m-phone");
  const newPhone = doc.createElement("input");
  newPhone.id = "m-phone"; newPhone.name = "phone"; newPhone.type = "tel";
  oldPhone.replaceWith(newPhone);
  const applied = await engine.apply([
    { id: nameField.id, value: "李四", type: "text" },
    { id: phoneField.id, value: "13900000000", type: "tel" },
  ], { delayMs: 0 });
  assert.equal(applied.filter(r => !r.ok).length, 0, JSON.stringify(applied.map(r => ({ id: r.id, ok: r.ok, error: r.error }))));
  assert.equal(newName.value, "李四", "值应写入重渲染后的新节点");
  assert.equal(newPhone.value, "13900000000");
  assert.equal(oldName.value, "", "旧节点不应被写入");
  dom.window.close();
});

test("多控件共用容器时标签不串用（避免多个字段填同一值）", () => {
  // 容器标签在顶部、两个控件并列（常见于 antd .form-item 结构）：容器标签不得被复用到每个控件
  const dom = new JSDOM(
    `<form><div class="form-item"><div class="ant-form-item-label"><label>姓名</label></div><div class="ant-form-item-control"><input id="a" type="text"><input id="b" type="text"></div></div></form>`,
    { url: "https://x.com/two-controls", runScripts: "outside-only", pretendToBeVisual: true }
  );
  dom.window.eval(engineSource);
  const { fields } = dom.window.__hunterFill.scan(dom.window.document);
  assert.equal(fields.length, 2);
  assert.ok(fields.every(f => f.label !== "姓名"), "一个容器内多个控件时容器标签不应被复用到每个控件（避免两字段填同一值）");
  dom.window.close();
});

test("手机号复合字段：区号下拉自动选 +86、号码框填手机号", async () => {
  const dom = new JSDOM(`<form>
    <div class="form-group"><label for="cc">手机号码</label><select id="cc"><option value="">请选择</option><option value="+86">+86</option><option value="+852">+852</option></select></div>
    <div class="form-group"><label for="pn">手机号码</label><input id="pn" type="tel"></div>
  </form>`, { url: "https://x.com/cc-phone", runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(engineSource);
  const engine = dom.window.__hunterFill;
  const { fields } = engine.scan(dom.window.document);
  const cc = fields.find(f => f.type === "select");
  const pn = fields.find(f => f.type === "tel");
  assert.ok(cc && pn, "区号下拉与号码框都应识别");
  assert.equal(cc.label, "手机区号", "区号下拉显示标签应修正，不与号码框同标签");
  const results = matchRules(fields, FULL_RESUME);
  assert.equal(results.find(r => r.fieldId === cc.id).value, "+86", "区号按手机号推导 +86");
  assert.equal(results.find(r => r.fieldId === pn.id).value, "13800138000");
  const applied = await engine.apply([
    { id: cc.id, value: "+86", type: "select" },
    { id: pn.id, value: "13800138000", type: "tel" },
  ], { delayMs: 0 });
  assert.equal(applied.filter(r => !r.ok).length, 0, JSON.stringify(applied));
  assert.equal(dom.window.document.getElementById("cc").value, "+86");
  assert.equal(dom.window.document.getElementById("pn").value, "13800138000");
  dom.window.close();
});

test("手机号复合字段：无对应区号选项时区号留手动，号码框正常填", async () => {
  const dom = new JSDOM(`<form>
    <div class="form-group"><label for="cc">手机号码</label><select id="cc"><option value="">请选择</option><option value="+1">+1</option><option value="+44">+44</option></select></div>
    <div class="form-group"><label for="pn">手机号码</label><input id="pn" type="tel"></div>
  </form>`, { url: "https://x.com/cc-phone2", runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(engineSource);
  const { fields } = dom.window.__hunterFill.scan(dom.window.document);
  const results = matchRules(fields, FULL_RESUME);
  const cc = results.find(r => r.type === "select");
  const pn = results.find(r => r.type === "tel");
  assert.equal(cc.status, "manual", "无 +86 选项时区号应留手动");
  assert.equal(pn.status, "match", "号码框不受影响");
  dom.window.close();
});

test("字段身份不变量：DOM 同级插入后仍写入原字段，不按旧位置错填", async () => {
  const dom = new JSDOM(`<form>
    <div><label>姓名</label><input placeholder="姓名"></div>
    <div><label>手机号</label><input type="tel" placeholder="手机号"></div>
  </form>`, { url: "https://x.com/reorder", runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(engineSource);
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  const scanned = engine.scan(doc);
  assert.ok(scanned.scanId, "扫描应返回 scanId");
  assert.ok(scanned.fields.every(field => field.fingerprint), "每个字段应包含语义指纹");
  const [oldName, oldPhone] = doc.querySelectorAll("input");
  const inserted = doc.createElement("div");
  inserted.innerHTML = `<label>新增字段</label><input placeholder="新增字段">`;
  doc.querySelector("form").prepend(inserted);
  const applied = await engine.apply([
    { id: scanned.fields[0].id, value: "张三", type: "text", fingerprint: scanned.fields[0].fingerprint },
    { id: scanned.fields[1].id, value: "13800138000", type: "tel", fingerprint: scanned.fields[1].fingerprint },
  ], { delayMs: 0, scanId: scanned.scanId, documentFingerprint: scanned.documentFingerprint, formFingerprint: scanned.formFingerprint });
  assert.equal(applied.every(result => result.ok), true, JSON.stringify(applied));
  assert.equal(inserted.querySelector("input").value, "", "新增字段不得接收旧计划的姓名");
  assert.equal(oldName.value, "张三");
  assert.equal(oldPhone.value, "13800138000");
  assert.ok(applied.every(result => result.resolvedFingerprint), "成功结果应回传实际目标指纹");
  dom.window.close();
});

test("受控日期组件无可确认面板时不得直接写内部 input", async () => {
  const dom = new JSDOM(`<form>
    <div class="ant-form-item">
      <div class="ant-form-item-label"><label>项目时间</label></div>
      <div class="ant-picker ant-picker-range">
        <input placeholder="项目开始时间">
        <input placeholder="项目结束时间">
      </div>
    </div>
  </form>`, { url: "https://x.com/date-range", runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(engineSource);
  const engine = dom.window.__hunterFill;
  const scanned = engine.scan(dom.window.document);
  assert.equal(scanned.fields.length, 2);
  assert.notEqual(scanned.fields[0].path, scanned.fields[1].path, "两个 slot 必须有不同 target path");
  assert.notEqual(scanned.fields[0].fingerprint, scanned.fields[1].fingerprint, "两个 slot 必须有不同指纹");
  const applied = await engine.apply([
    { id: scanned.fields[0].id, value: "2024-01", type: "custom-date", fingerprint: scanned.fields[0].fingerprint },
    { id: scanned.fields[1].id, value: "2024-12", type: "custom-date", fingerprint: scanned.fields[1].fingerprint },
  ], { delayMs: 0, scanId: scanned.scanId, documentFingerprint: scanned.documentFingerprint, formFingerprint: scanned.formFingerprint });
  assert.equal(applied.every(result => !result.ok), true, JSON.stringify(applied));
  assert.deepEqual([...dom.window.document.querySelectorAll(".ant-picker input")].map(input => input.value), ["", ""]);
  assert.ok(applied.every(result => /未确认选择结果/.test(result.error)));
  dom.window.close();
});

test("原生日期控件按目标精度写值，不再为 month 补 -01", async () => {
  const dom = new JSDOM(`<form>
    <label>入学月份<input id="month" type="month"></label>
    <label>出生日期<input id="date" type="date"></label>
  </form>`, { url: "https://x.com/native-date-types", runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(engineSource);
  const engine = dom.window.__hunterFill;
  const scanned = engine.scan(dom.window.document);
  const month = scanned.fields.find(field => field.attributes.id === "month");
  const date = scanned.fields.find(field => field.attributes.id === "date");
  assert.equal(month.dateMeta.nativeType, "month");
  assert.equal(date.dateMeta.nativeType, "date");

  const applied = await engine.apply([
    { id: month.id, value: "2024-01", type: month.type, fingerprint: month.fingerprint },
    { id: date.id, value: "1998-06-15", type: date.type, fingerprint: date.fingerprint },
  ], { delayMs: 0, scanId: scanned.scanId, documentFingerprint: scanned.documentFingerprint, formFingerprint: scanned.formFingerprint });
  assert.equal(applied.every(result => result.ok), true, JSON.stringify(applied));
  assert.equal(dom.window.document.getElementById("month").value, "2024-01");
  assert.equal(dom.window.document.getElementById("date").value, "1998-06-15");
  dom.window.close();
});

test("原生 date 缺少日精度时明确失败且不编造日期", async () => {
  const dom = new JSDOM(`<form><label>出生日期<input id="date" type="date"></label></form>`, {
    url: "https://x.com/native-date-precision",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  dom.window.eval(engineSource);
  const engine = dom.window.__hunterFill;
  const scanned = engine.scan(dom.window.document);
  const field = scanned.fields[0];
  const applied = await engine.apply([
    { id: field.id, value: "1998-06", type: field.type, fingerprint: field.fingerprint },
  ], { delayMs: 0, scanId: scanned.scanId, documentFingerprint: scanned.documentFingerprint, formFingerprint: scanned.formFingerprint });
  assert.equal(applied[0].ok, false);
  assert.match(applied[0].error, /日期精度/);
  assert.equal(dom.window.document.getElementById("date").value, "");
  dom.window.close();
});

test("Ant 月份选择需经确认按钮提交并稳定回读", async () => {
  const dom = new JSDOM(`<form>
    <div class="ant-picker ant-picker-month need-confirm"><input id="month" placeholder="选择月份"></div>
  </form>`, { url: "https://x.com/month-confirm", runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(engineSource);
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  const input = doc.getElementById("month");
  let pending = "";
  input.addEventListener("click", () => {
    if (doc.querySelector(".ant-picker-dropdown")) return;
    const dropdown = doc.createElement("div");
    dropdown.className = "ant-picker-dropdown";
    dropdown.innerHTML = `<table><tbody><tr><td title="2026-08"><div class="ant-picker-cell-inner">8月</div></td></tr></tbody></table>
      <div class="ant-picker-ok"><button type="button">确定</button></div>`;
    doc.body.appendChild(dropdown);
    dropdown.querySelector("td").addEventListener("click", () => { pending = "2026-08"; });
    dropdown.querySelector("button").addEventListener("click", () => {
      input.value = pending;
      dropdown.remove();
    });
  });
  const scanned = engine.scan(doc);
  const field = scanned.fields[0];
  const applied = await engine.apply([
    { id: field.id, value: "2026-08", type: field.type, fingerprint: field.fingerprint },
  ], { delayMs: 0, scanId: scanned.scanId, documentFingerprint: scanned.documentFingerprint, formFingerprint: scanned.formFingerprint });
  assert.equal(applied[0].ok, true, JSON.stringify(applied[0]));
  assert.equal(input.value, "2026-08");
  dom.window.close();
});

test("Ant 日期面板支持同一年跨月导航", async () => {
  const dom = new JSDOM(`<form><div class="ant-picker"><input id="date" placeholder="选择日期"></div></form>`, {
    url: "https://x.com/date-navigation",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  dom.window.eval(engineSource);
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  const input = doc.getElementById("date");
  input.addEventListener("click", () => {
    if (doc.querySelector(".ant-picker-dropdown")) return;
    const dropdown = doc.createElement("div");
    dropdown.className = "ant-picker-dropdown";
    dropdown.innerHTML = `<button class="ant-picker-header-next-btn">下月</button>
      <table><tbody><tr><td title="2026-06-15"><div class="ant-picker-cell-inner">15</div></td></tr></tbody></table>`;
    doc.body.appendChild(dropdown);
    dropdown.querySelector("button").addEventListener("click", () => {
      dropdown.querySelector("tbody").innerHTML = `<tr><td title="2026-08-20"><div class="ant-picker-cell-inner">20</div></td></tr>`;
      dropdown.querySelector("td").addEventListener("click", () => {
        input.value = "2026-08-20";
        dropdown.remove();
      });
    });
  });
  const scanned = engine.scan(doc);
  const field = scanned.fields[0];
  const applied = await engine.apply([
    { id: field.id, value: "2026-08-20", type: field.type, fingerprint: field.fingerprint },
  ], { delayMs: 0, scanId: scanned.scanId, documentFingerprint: scanned.documentFingerprint, formFingerprint: scanned.formFingerprint });
  assert.equal(applied[0].ok, true, JSON.stringify(applied[0]));
  assert.equal(input.value, "2026-08-20");
  dom.window.close();
});

test("Element 月份面板可按表头年份与月份文本提交", async () => {
  const dom = new JSDOM(`<form><div class="el-date-editor el-date-editor--month"><input id="month" placeholder="选择月份"></div></form>`, {
    url: "https://x.com/element-month",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  dom.window.eval(engineSource);
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  const input = doc.getElementById("month");
  input.addEventListener("click", () => {
    if (doc.querySelector(".el-picker-panel")) return;
    const panel = doc.createElement("div");
    panel.className = "el-picker-panel";
    panel.innerHTML = `<div class="el-date-picker__header">2026年</div>
      <table class="el-month-table"><tbody><tr><td><span class="cell">8月</span></td></tr></tbody></table>`;
    doc.body.appendChild(panel);
    panel.querySelector("td").addEventListener("click", () => {
      input.value = "2026-08";
      panel.remove();
    });
  });
  const scanned = engine.scan(doc);
  const field = scanned.fields[0];
  assert.equal(field.dateMeta.framework, "element");
  assert.equal(field.dateMeta.mode, "month");
  const applied = await engine.apply([
    { id: field.id, value: "2026-08", type: field.type, fingerprint: field.fingerprint },
  ], { delayMs: 0, scanId: scanned.scanId, documentFingerprint: scanned.documentFingerprint, formFingerprint: scanned.formFingerprint });
  assert.equal(applied[0].ok, true, JSON.stringify(applied[0]));
  assert.equal(input.value, "2026-08");
  dom.window.close();
});

test("Ant Design 月范围：通过 title 月份单元格原子选择 start/end", async () => {
  const dom = new JSDOM(`<form>
    <section id="resume-form-edu">
      <div class="ant-form-item"><label>起止时间</label><div class="ant-picker ant-picker-range">
        <input id="educations_0_startDate|endDate" placeholder="就读时间">
        <input placeholder="毕业时间">
      </div></div>
    </section>
  </form>`, { url: "https://x.com/month-range", runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(engineSource);
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  const inputs = [...doc.querySelectorAll(".ant-picker input")];
  let activeSlot = "start";
  const mount = event => {
    activeSlot = event.target === inputs[1] ? "end" : activeSlot;
    if (doc.querySelector(".ant-picker-dropdown")) return;
    const dropdown = doc.createElement("div");
    dropdown.className = "ant-picker-dropdown";
    dropdown.innerHTML = `<table><tbody><tr>
      <td title="2025-09"><div class="ant-picker-cell-inner">9月</div></td>
      <td title="2026-11"><div class="ant-picker-cell-inner">11月</div></td>
    </tr></tbody></table>`;
    doc.body.appendChild(dropdown);
    for (const cell of dropdown.querySelectorAll("td")) {
      cell.addEventListener("click", () => {
        if (activeSlot === "start") {
          inputs[0].value = cell.title === "2025-09" ? "2025-9" : cell.title;
          activeSlot = "end";
        } else {
          inputs[1].value = cell.title;
          dropdown.remove();
        }
      });
    }
  };
  inputs.forEach(input => input.addEventListener("click", mount));
  const scanned = engine.scan(doc);
  const start = scanned.fields.find(field => field.slot === "start");
  const end = scanned.fields.find(field => field.slot === "end");
  const applied = await engine.apply([
    { id: start.id, value: "2025-09", type: start.type, fingerprint: start.fingerprint },
    { id: end.id, value: "2026-11", type: end.type, fingerprint: end.fingerprint },
  ], {
    delayMs: 0,
    scanId: scanned.scanId,
    documentFingerprint: scanned.documentFingerprint,
    formFingerprint: scanned.formFingerprint,
  });
  assert.equal(applied.every(result => result.ok), true, JSON.stringify(applied));
  assert.deepEqual(inputs.map(input => input.value), ["2025-9", "2026-11"]);
  dom.window.close();
});

test("深层 Ant Form：字段可上溯到 10 层之外的教育区块", () => {
  const wrappers = Array.from({ length: 12 }, (_, index) => `<div class="layer-${index}">`).join("");
  const closes = "</div>".repeat(12);
  const dom = new JSDOM(`<form><section id="resume-form-edu">${wrappers}
    <div class="ant-form-item"><label>起止时间</label><div class="ant-picker ant-picker-range">
      <input id="educations_0_startDate|endDate" placeholder="就读时间">
      <input placeholder="毕业时间">
    </div></div>${closes}</section></form>`, {
    url: "https://x.com/deep-education",
    runScripts: "outside-only",
    pretendToBeVisual: true,
  });
  dom.window.eval(engineSource);
  const scanned = dom.window.__hunterFill.scan(dom.window.document);
  assert.equal(scanned.fields.length, 2);
  assert.ok(scanned.fields.every(field => field.context.sectionKey === "education"));
  assert.ok(scanned.fields.every(field => field.context.repeat?.itemIndex === 0));
  dom.window.close();
});

test("扫描会话不变量：scanId 或字段指纹不一致时整批零写入", async () => {
  const dom = loadFixture("moka.html");
  const engine = dom.window.__hunterFill;
  const scanned = engine.scan(dom.window.document);
  const field = scanned.fields.find(item => item.label === "姓名");
  const input = dom.window.document.getElementById("m-name");
  await assert.rejects(
    engine.apply([{ id: field.id, value: "张三", type: field.type, fingerprint: field.fingerprint }], {
      delayMs: 0,
      scanId: "stale-scan",
      documentFingerprint: scanned.documentFingerprint,
      formFingerprint: scanned.formFingerprint,
    }),
    /扫描|过期|stale/i
  );
  assert.equal(input.value, "", "会话不一致时不得写入");
  await assert.rejects(
    engine.apply([{ id: field.id, value: "张三", type: field.type, fingerprint: "wrong-fingerprint" }], {
      delayMs: 0,
      scanId: scanned.scanId,
      documentFingerprint: scanned.documentFingerprint,
      formFingerprint: scanned.formFingerprint,
    }),
    /指纹|目标|stale/i
  );
  assert.equal(input.value, "", "字段指纹不一致时不得写入");
  dom.window.close();
});

test("米哈游：扫描输出区块、重复项与复合手机号槽位", () => {
  const dom = loadFixture("mihoyo.html");
  const scanned = dom.window.__hunterFill.scan(dom.window.document);
  const byId = Object.fromEntries(scanned.fields.map(field => [field.attributes.id, field]));
  assert.equal(byId.rc_select_1.adapter, "phone-country-code");
  assert.equal(byId.rc_select_1.slot, "prefix");
  assert.equal(byId.rc_select_1.label, "手机区号");
  assert.equal(byId.resumeInfo_phoneList.slot, "main");
  assert.equal(byId.resumeInfo_phoneList.label, "手机号");
  assert.equal(byId.rc_select_3.adapter, "compound-prefix");
  assert.equal(byId.rc_select_3.label, "IM（微信/QQ）类型");
  assert.equal(byId.resumeInfo_imList.adapter, "compound-value");
  assert.equal(byId.resumeInfo_imList.slot, "main");
  assert.equal(byId.educations_0_schoolName.context.sectionKey, "education");
  assert.equal(byId.educations_0_schoolName.context.repeat.arrayKey, "education");
  assert.equal(byId.educations_0_schoolName.context.repeat.itemIndex, 0);
  assert.equal(byId.educations_0_startDate.slot, "start");
  const educationEnd = scanned.fields.find(field => field.slot === "end" && field.context?.sectionKey === "education");
  assert.equal(educationEnd.context.repeat.arrayKey, "education");
  assert.equal(educationEnd.context.repeat.itemIndex, 0);
  const repeaters = Object.fromEntries(scanned.repeaters.map(item => [item.arrayKey, item]));
  assert.equal(repeaters.education.currentCount, 1);
  assert.equal(repeaters.internships.currentCount, 0);
  assert.equal(repeaters.workHistory.currentCount, 0);
  assert.equal(repeaters.projects.currentCount, 0);
  dom.window.close();
});

test("米哈游：标识符语义陷阱不再误填姓名、学校或工作年限", () => {
  const dom = loadFixture("mihoyo.html");
  const scanned = dom.window.__hunterFill.scan(dom.window.document);
  const resume = {
    ...FULL_RESUME,
    qq: "",
    wechat: "",
    nickname: "Yongcan",
    lastNamePinyin: "Cai",
    firstNamePinyin: "Yongcan",
    gameName: "原神",
    gameLevel: "深度玩家",
    schoolLocation: "中国香港",
    college: "工程学院",
    educationStart: "2022-09",
    education: [{
      start: "2022-09",
      end: "2024-11",
      school: "香港大学",
      schoolLocation: "中国香港",
      college: "工程学院",
      degree: "硕士",
      major: "计算机科学",
    }],
  };
  const matches = matchRules(scanned.fields, resume);
  const byDomId = Object.fromEntries(matches.map(match => [match.attributes.id, match]));
  assert.equal(byDomId.resumeInfo_name.fieldKey, "name");
  assert.equal(byDomId.resumeInfo_nicknameList.fieldKey, "nickname");
  assert.equal(byDomId.resumeInfo_nicknameList.value, "Yongcan");
  assert.equal(byDomId.resumeInfo_lastName.fieldKey, "lastNamePinyin");
  assert.equal(byDomId.resumeInfo_firstName.fieldKey, "firstNamePinyin");
  assert.equal(byDomId.resumeInfo_gameExperienceList_0_gameName.fieldKey, "gameName");
  assert.equal(byDomId.resumeInfo_gameExperienceList_0_playContent.fieldKey, "gameLevel");
  assert.equal(byDomId.rc_select_3.fieldKey, "imType");
  assert.equal(byDomId.rc_select_3.status, "manual");
  assert.equal(byDomId.resumeInfo_imList.fieldKey, "");
  assert.equal(byDomId.resumeInfo_imList.status, "manual");
  assert.equal(byDomId.educations_0_schoolAddress.fieldKey, "schoolLocation");
  assert.equal(byDomId.educations_0_college.fieldKey, "college");
  assert.equal(byDomId.educations_0_startDate.valueRef.path, "education[0].start");
  assert.equal(byDomId.educations_0_startDate.value, "2022-09");
  const educationEnd = matches.find(match => match.slot === "end" && match.context?.sectionKey === "education");
  assert.equal(educationEnd.valueRef.path, "education[0].end");
  assert.equal(educationEnd.value, "2024-11");
  dom.window.close();
});

test("米哈游：IM 复合控件仅在简历存在账号时推导类型和值", () => {
  const dom = loadFixture("mihoyo.html");
  const scanned = dom.window.__hunterFill.scan(dom.window.document);
  const matches = matchRules(scanned.fields, { ...FULL_RESUME, qq: "12345678", wechat: "" });
  const byDomId = Object.fromEntries(matches.map(match => [match.attributes.id, match]));
  assert.equal(byDomId.rc_select_3.fieldKey, "imType");
  assert.equal(byDomId.rc_select_3.value, "QQ");
  assert.equal(byDomId.rc_select_3.status, "match");
  assert.equal(byDomId.resumeInfo_imList.fieldKey, "qq");
  assert.equal(byDomId.resumeInfo_imList.value, "12345678");
  assert.equal(byDomId.resumeInfo_imList.status, "match");
  dom.window.close();
});

test("米哈游：延迟挂载的区号下拉选择 +86，并与号码输入分槽填充", async () => {
  const dom = loadFixture("mihoyo.html");
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  const prefixContainer = doc.querySelector(".phone-prefix");
  const openDropdown = () => {
    if (doc.getElementById("rc_select_1_list")) return;
    const list = doc.createElement("div");
    list.id = "rc_select_1_list";
    list.className = "ant-select-dropdown";
    list.setAttribute("role", "listbox");
    list.innerHTML = `<div role="option" class="ant-select-item-option">+86 中国大陆</div>
      <div role="option" class="ant-select-item-option">+852 中国香港</div>`;
    doc.body.appendChild(list);
    list.firstElementChild.addEventListener("click", () => {
      let selected = prefixContainer.querySelector(".ant-select-selection-item");
      if (!selected) {
        selected = doc.createElement("span");
        selected.className = "ant-select-selection-item";
        prefixContainer.prepend(selected);
      }
      selected.textContent = "+86 中国大陆";
      // 模拟 React 提交选择后短暂替换/移除内部搜索 input。
      const previous = prefixContainer.querySelector("input");
      const replacement = previous.cloneNode();
      replacement.removeAttribute("id");
      previous.replaceWith(replacement);
    });
  };
  prefixContainer.addEventListener("mousedown", openDropdown);
  prefixContainer.addEventListener("click", openDropdown);
  const scanned = engine.scan(doc);
  const matches = matchRules(scanned.fields, FULL_RESUME);
  const prefix = matches.find(match => match.adapter === "phone-country-code");
  const phone = matches.find(match => match.attributes.id === "resumeInfo_phoneList");
  assert.equal(prefix.value, "+86");
  assert.equal(phone.value, "13800138000");
  const applied = await engine.apply([
    { id: prefix.fieldId, value: prefix.value, type: prefix.type, fingerprint: prefix.fingerprint },
    { id: phone.fieldId, value: phone.value, type: phone.type, fingerprint: phone.fingerprint },
  ], {
    delayMs: 0,
    scanId: scanned.scanId,
    documentFingerprint: scanned.documentFingerprint,
    formFingerprint: scanned.formFingerprint,
  });
  assert.equal(applied.every(result => result.ok), true, JSON.stringify(applied));
  assert.match(prefixContainer.textContent, /\+86/);
  assert.equal(doc.getElementById("resumeInfo_phoneList").value, "13800138000");
  dom.window.close();
});

test("Ant Design 虚拟下拉：从 aria-controls 辅助节点回溯可见 dropdown 选择", async () => {
  const dom = new JSDOM(`<form>
    <div class="ant-form-item">
      <label>学校名称</label>
      <div class="ant-select">
        <div class="ant-select-selector">
          <input id="school-select" class="ant-select-selection-search-input" role="combobox" aria-controls="school-select_list">
        </div>
      </div>
    </div>
  </form>
  <div class="ant-select-dropdown ant-select-dropdown-hidden">
    <div id="school-select_list" role="listbox" style="width:0;height:0"><div role="option">香港大学</div></div>
  </div>`, { url: "https://x.com/virtual-select", runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(engineSource);
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  const container = doc.querySelector(".ant-select");
  const open = () => {
    const dropdown = doc.querySelector(".ant-select-dropdown");
    dropdown.classList.remove("ant-select-dropdown-hidden");
    if (dropdown.querySelector(".ant-select-item-option")) return;
    dropdown.insertAdjacentHTML("beforeend", `<div class="ant-select-item ant-select-item-option" title="香港大学"><div class="ant-select-item-option-content">香港大学</div></div>`);
    dropdown.querySelector(".ant-select-item-option").addEventListener("click", () => {
      const selected = doc.createElement("span");
      selected.className = "ant-select-selection-item";
      selected.textContent = "香港大学";
      container.prepend(selected);
    });
  };
  container.querySelector(".ant-select-selector").addEventListener("mousedown", open);
  const scanned = engine.scan(doc);
  const school = scanned.fields.find(field => field.attributes.id === "school-select");
  const applied = await engine.apply([
    { id: school.id, value: "香港大学", type: school.type, fingerprint: school.fingerprint },
  ], {
    delayMs: 0,
    scanId: scanned.scanId,
    documentFingerprint: scanned.documentFingerprint,
    formFingerprint: scanned.formFingerprint,
  });
  assert.equal(applied[0].ok, true, JSON.stringify(applied[0]));
  assert.match(container.textContent, /香港大学/);
  dom.window.close();
});

test("重复区块：显式准备按目标数量新增并返回重扫结果", async () => {
  const dom = loadFixture("mihoyo.html");
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  const add = doc.querySelector('[data-add-kind="education"]');
  add.addEventListener("click", () => {
    const index = doc.querySelectorAll(".education-card").length;
    const card = doc.createElement("div");
    card.className = "education-card";
    card.dataset.entryIndex = String(index);
    card.innerHTML = `<div class="ant-form-item"><label for="educations_${index}_schoolName">学校名称</label>
      <input id="educations_${index}_schoolName" type="text"></div>`;
    add.before(card);
  });
  const initial = engine.scan(doc);
  const education = initial.repeaters.find(item => item.arrayKey === "education");
  assert.equal(doc.querySelectorAll(".education-card").length, 1, "扫描不得修改页面");
  const prepared = await engine.prepareRepeaters([
    { id: education.id, fingerprint: education.fingerprint, targetCount: 2 },
  ], { delayMs: 0, timeoutMs: 300 });
  assert.equal(prepared.results[0].added, 1);
  assert.equal(doc.querySelectorAll(".education-card").length, 2);
  assert.equal(prepared.repeaters.find(item => item.arrayKey === "education").currentCount, 2);
  assert.ok(prepared.fields.some(field => field.attributes.id === "educations_1_schoolName"));
  dom.window.close();
});

// —— 点击字段填充（P1 任务5） ——
test("点击填充：单字段按 fieldId 填充成功并回读一致", async () => {
  const dom = loadFixture("antd-generic.html");
  const engine = dom.window.__hunterFill;
  const scan = engine.scan(dom.window.document);
  const nameField = scan.fields.find(field => field.label === "姓名");
  assert.ok(nameField, "夹具应包含姓名字段");
  const result = await engine.fillField({ id: nameField.id, value: "李四" }, {
    scanId: scan.scanId, documentFingerprint: scan.documentFingerprint, formFingerprint: scan.formFingerprint,
  });
  assert.equal(result.ok, true);
  assert.equal(dom.window.document.getElementById("name").value, "李四", "回读值应与填入值一致");
  dom.window.close();
});

test("点击填充：stale fieldId 返回 STALE_FIELD", async () => {
  const dom = loadFixture("antd-generic.html");
  const engine = dom.window.__hunterFill;
  const scan = engine.scan(dom.window.document);
  await assert.rejects(
    () => engine.fillField({ id: "not-exist" }, { scanId: scan.scanId }),
    error => error.code === "STALE_FIELD"
  );
  dom.window.close();
});

test("点击填充：同一 fieldId 批次内重复提交幂等成功且只写入一次", async () => {
  const dom = loadFixture("antd-generic.html");
  const engine = dom.window.__hunterFill;
  const scan = engine.scan(dom.window.document);
  const nameField = scan.fields.find(field => field.label === "姓名");
  const results = await engine.apply([
    { id: nameField.id, value: "李四", type: nameField.type, fingerprint: nameField.fingerprint },
    { id: nameField.id, value: "李四", type: nameField.type, fingerprint: nameField.fingerprint },
  ], { scanId: scan.scanId, documentFingerprint: scan.documentFingerprint, formFingerprint: scan.formFingerprint });
  assert.equal(results.length, 2);
  assert.ok(results.every(result => result.ok), "同目标重复项不得触发错误");
  assert.equal(dom.window.document.getElementById("name").value, "李四");
  dom.window.close();
});

test("点击填充：拾取态点击目标控件后填充并回读", async () => {
  const dom = loadFixture("antd-generic.html");
  const engine = dom.window.__hunterFill;
  engine.scan(dom.window.document);
  const picking = engine.pickFill("李四");
  const input = dom.window.document.getElementById("name");
  input.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  const result = await picking;
  assert.equal(result.ok, true);
  assert.equal(input.value, "李四");
  dom.window.close();
});

test("点击填充：Esc 取消拾取态且不写入", async () => {
  const dom = loadFixture("antd-generic.html");
  const engine = dom.window.__hunterFill;
  engine.scan(dom.window.document);
  const input = dom.window.document.getElementById("name");
  const picking = engine.pickFill("李四");
  dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  const result = await picking;
  assert.equal(result.cancelled, true);
  assert.notEqual(input.value, "李四");
  dom.window.close();
});

test("点击填充：点击非可填区域提示且不填充，拾取态保持", async () => {
  const dom = loadFixture("antd-generic.html");
  const engine = dom.window.__hunterFill;
  engine.scan(dom.window.document);
  const input = dom.window.document.getElementById("name");
  const picking = engine.pickFill("李四");
  const heading = dom.window.document.querySelector("h1") || dom.window.document.body;
  heading.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.notEqual(input.value, "李四", "点击非可填区域不得写入");
  input.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  const result = await picking;
  assert.equal(result.ok, true, "拾取态应保持到点击可填控件");
  assert.equal(input.value, "李四");
  dom.window.close();
});

// —— 增量续填（P1 任务6） ——
test("增量续填：扫描标记已见字段，onlyNew 仅返回新增字段", async () => {
  const dom = loadFixture("antd-generic.html");
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  const initial = engine.scan(doc);
  assert.ok(initial.fields.length >= 5, "初始应有多个字段");
  const card = doc.createElement("div");
  card.className = "ant-form-item";
  card.innerHTML = '<div class="ant-form-item-label"><label for="newSchool">新增学校</label></div><div class="ant-form-item-control"><input id="newSchool" type="text"></div>';
  doc.body.appendChild(card);
  const onlyNew = engine.scan(doc, { onlyUnprocessed: true });
  assert.ok(onlyNew.fields.some(field => field.attributes?.id === "newSchool"), "新增字段应包含在 onlyNew 结果中");
  assert.ok(!onlyNew.fields.some(field => field.attributes?.id === "name"), "已见字段不得出现在 onlyNew 结果中");
  dom.window.close();
});

test("增量续填：无新增字段时 onlyNew 返回空", async () => {
  const dom = loadFixture("antd-generic.html");
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  engine.scan(doc);
  const onlyNew = engine.scan(doc, { onlyUnprocessed: true });
  assert.equal(onlyNew.fields.length, 0, "无新增字段时 onlyNew 应为空");
  dom.window.close();
});

test("增量续填：watch 检测到新增字段并触发回调，停止后不再触发", async () => {
  const dom = loadFixture("antd-generic.html");
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  engine.scan(doc);
  const found = [];
  engine.startWatch({ threshold: 1, onFound: count => found.push(count) });
  const form = doc.getElementById("applyForm");
  const card = doc.createElement("div");
  card.className = "ant-form-item";
  card.innerHTML = '<div class="ant-form-item-label"><label for="newA">新增字段A</label></div><div class="ant-form-item-control"><input id="newA" type="text"></div>';
  form.appendChild(card);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(found.length, 1, "应触发一次回调");
  assert.ok(found[0] >= 1);
  engine.stopWatch();
  const card2 = doc.createElement("div");
  card2.className = "ant-form-item";
  card2.innerHTML = '<div class="ant-form-item-label"><label for="newB">新增字段B</label></div><div class="ant-form-item-control"><input id="newB" type="text"></div>';
  form.appendChild(card2);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(found.length, 1, "停止后不再触发");
  dom.window.close();
});

test("增量续填：onlyNew 新增字段可单独填充", async () => {
  const dom = loadFixture("antd-generic.html");
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  engine.scan(doc);
  const card = doc.createElement("div");
  card.className = "ant-form-item";
  card.innerHTML = '<div class="ant-form-item-label"><label for="newSchool">新增学校</label></div><div class="ant-form-item-control"><input id="newSchool" type="text"></div>';
  doc.body.appendChild(card);
  const onlyNew = engine.scan(doc, { onlyUnprocessed: true });
  const schoolField = onlyNew.fields.find(field => field.attributes?.id === "newSchool");
  assert.ok(schoolField, "应识别新增学校字段");
  const result = await engine.fillField({ id: schoolField.id, value: "香港大学" }, {
    scanId: onlyNew.scanId, documentFingerprint: onlyNew.documentFingerprint, formFingerprint: onlyNew.formFingerprint,
  });
  assert.equal(result.ok, true);
  assert.equal(doc.getElementById("newSchool").value, "香港大学");
  dom.window.close();
});

test("增量续填：watch 触发后 onlyNew 仍能返回新增字段（dryRun 不打标）", async () => {
  const dom = loadFixture("antd-generic.html");
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  const form = doc.getElementById("applyForm");
  engine.scan(doc);
  const found = [];
  engine.startWatch({ threshold: 4, onFound: count => found.push(count) });
  for (let i = 0; i < 4; i++) {
    const card = doc.createElement("div");
    card.className = "ant-form-item";
    card.innerHTML = `<div class="ant-form-item-label"><label for="nb${i}">新字段${i}</label></div><div class="ant-form-item-control"><input id="nb${i}" type="text"></div>`;
    form.appendChild(card);
  }
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(found.length, 1, "应触发一次回调");
  const onlyNew = engine.scan(doc, { onlyUnprocessed: true });
  assert.ok(onlyNew.fields.length >= 4, `dryRun 不得打标新增字段，onlyNew 应为 ${found[0]} 个而非 0，实际 ${onlyNew.fields.length}`);
  dom.window.close();
});

test("点击填充：重复进入拾取态后旧监听器不残留（Esc 后点击不写旧值）", async () => {
  const dom = loadFixture("antd-generic.html");
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  engine.scan(doc);
  const input = doc.getElementById("name");
  const p1 = engine.pickFill("旧值");
  const p2 = engine.pickFill("新值");
  doc.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 30));
  let pageClickFired = false;
  input.addEventListener("click", () => { pageClickFired = true; });
  input.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 50));
  const r1 = await p1;
  const r2 = await p2;
  assert.equal(r1.ok, false);
  assert.equal(r2.cancelled, true);
  assert.notEqual(input.value, "旧值", "旧拾取监听器不得残留并写入旧值");
  assert.equal(pageClickFired, true, "取消后页面点击不应被吞掉");
  dom.window.close();
});

test("受控输入（React 式）：verify 失败后打字重填成功", async () => {
  const dom = loadFixture("controlled-input.html");
  const doc = dom.window.document;
  // loadFixture 使用 runScripts:"outside-only"，夹具内联 <script> 不会自动执行；
  // 这里按夹具语义手动 eval 其受控校验逻辑（否则夹具形同普通输入框，红灯无法复现）。
  const inlineScript = /<script>([\s\S]*?)<\/script>/.exec(fixture("controlled-input.html"));
  assert.ok(inlineScript, "夹具应包含内联受控校验脚本");
  dom.window.eval(inlineScript[1]);
  const { fields, scanId, documentFingerprint, formFingerprint } = dom.window.__hunterFill.scan(doc);
  const name = fields.find(f => f.label.includes("姓名"));
  assert.ok(name, "应识别姓名字段");
  // 说明：apply 实际直接返回结果数组（非 { ok, results }），按真实 API 形状断言。
  const results = await dom.window.__hunterFill.apply([{ id: name.id, value: "张三", type: "text", fingerprint: name.fingerprint }], { scanId, documentFingerprint, formFingerprint });
  const r = results.find(x => x.id === name.id);
  assert.equal(r.ok, true, `姓名应填入：${r.error || ""}`);
  assert.equal(doc.getElementById("name").value, "张三");
  assert.equal(r.retried, true, "应走打字重填路径");
  dom.window.close();
});

test("联想下拉：候选打分并选中匹配项", async () => {
  const dom = loadFixture("suggest-dropdown.html");
  const doc = dom.window.document;
  // 注意：loadFixture 用 runScripts:"outside-only"，夹具内联脚本需手动 eval（参考 W1T1 受控输入用例的 eval 方式）
  const inline = fixture("suggest-dropdown.html").match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (inline) dom.window.eval(inline);
  const { fields, scanId, documentFingerprint, formFingerprint } = dom.window.__hunterFill.scan(doc);
  const school = fields.find(f => f.label.includes("毕业院校"));
  assert.ok(school, "应识别毕业院校字段");
  const results = await dom.window.__hunterFill.apply([{ id: school.id, value: "复旦大学", type: "text", fingerprint: school.fingerprint }], { scanId, documentFingerprint, formFingerprint });
  const r = results.find(x => x.id === school.id);
  assert.equal(r.ok, true, `联想下拉应选中：${r.error || ""}`);
  assert.equal(r.via, "suggest", "应真实走联想选中路径而非回退打字路径");
  assert.equal(doc.getElementById("school").value, "复旦大学");
  dom.window.close();
});

test("联想下拉：无匹配候选时回退打字路径且不误选", async () => {
  const dom = loadFixture("suggest-dropdown.html");
  const doc = dom.window.document;
  const inline = fixture("suggest-dropdown.html").match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (inline) dom.window.eval(inline);
  const { fields, scanId, documentFingerprint, formFingerprint } = dom.window.__hunterFill.scan(doc);
  const school = fields.find(f => f.label.includes("毕业院校"));
  assert.ok(school, "应识别毕业院校字段");
  // 值不在候选列表内：联想无匹配必须回退标准打字路径。
  // 夹具为受控联想（未选中候选的值会被清空），回退写入同样会被夹具拒绝，故如实失败。
  const results = await dom.window.__hunterFill.apply([{ id: school.id, value: "北京大学", type: "text", fingerprint: school.fingerprint }], { scanId, documentFingerprint, formFingerprint });
  const r = results.find(x => x.id === school.id);
  assert.equal(r.ok, false, "联想无匹配且夹具拒绝直接写入时应如实失败");
  assert.match(r.error || "", /模拟输入后仍失败/);
  assert.equal(doc.getElementById("school").value, "", "回退失败后输入框不得残留部分输入");
  dom.window.close();
});

test("联想下拉：多候选时前缀优先于非前缀包含", async () => {
  const dom = loadFixture("suggest-dropdown.html");
  const doc = dom.window.document;
  const inline = fixture("suggest-dropdown.html").match(/<script>([\s\S]*?)<\/script>/)?.[1];
  if (inline) dom.window.eval(inline);
  // 注入「上海复旦大学」作为非前缀包含竞争项：旧打分（前缀 60 < 包含 76）会误选它，用于拦截 I1 回归。
  // 夹具脚本对 li[role='option'] 的 mousedown 委派是通用的，注入项可正常被选中。
  doc.getElementById("suggest").insertAdjacentHTML("beforeend", '<li role="option" data-value="上海复旦大学">上海复旦大学</li>');
  const { fields, scanId, documentFingerprint, formFingerprint } = dom.window.__hunterFill.scan(doc);
  const school = fields.find(f => f.label.includes("毕业院校"));
  assert.ok(school, "应识别毕业院校字段");
  const results = await dom.window.__hunterFill.apply([{ id: school.id, value: "复旦", type: "text", fingerprint: school.fingerprint }], { scanId, documentFingerprint, formFingerprint });
  const r = results.find(x => x.id === school.id);
  assert.equal(r.ok, true, `前缀候选应选中：${r.error || ""}`);
  assert.equal(r.via, "suggest");
  assert.equal(doc.getElementById("school").value, "复旦大学", "前缀匹配应优先于非前缀包含");
  dom.window.close();
});

test("填充后页面着色：成功字段 done、失败字段 pending", async () => {
  const dom = loadFixture("zhilian.html");
  const doc = dom.window.document;
  const { fields, scanId, documentFingerprint, formFingerprint } = dom.window.__hunterFill.scan(doc);
  const name = fields.find(f => f.label.includes("姓名"));
  const degree = fields.find(f => f.label.includes("学历"));
  assert.ok(name && degree, "应识别姓名与学历字段");
  const results = await dom.window.__hunterFill.apply([
    { id: name.id, value: "张三", type: "text", fingerprint: name.fingerprint },
    { id: degree.id, value: "博士", type: "select", fingerprint: degree.fingerprint },
  ], { scanId, documentFingerprint, formFingerprint });
  assert.equal(results.find(r => r.id === name.id).ok, true);
  assert.equal(results.find(r => r.id === degree.id).ok, false, "选项不在列表时应如实失败");
  const el = doc.querySelector("input[name='name']");
  assert.ok(el.classList.contains("hunter-fill-done"), "成功字段应有 done class");
  assert.ok(!el.classList.contains("hunter-fill-pending"));
  const degreeEl = doc.querySelector("select[name='degree']");
  assert.ok(degreeEl.classList.contains("hunter-fill-pending"), "失败字段应有 pending class");
  assert.ok(!degreeEl.classList.contains("hunter-fill-done"));
  dom.window.__hunterFill.reset(doc);
  assert.ok(!el.classList.contains("hunter-fill-done"), "reset 后应清除着色");
  assert.ok(!degreeEl.classList.contains("hunter-fill-pending"), "reset 后应清除失败着色");
  dom.window.close();
});

// —— 撤销本次填充（Wave 3 任务2） ——
test("撤销本次填充：恢复原值并清除着色（引擎 undo 入口）", async () => {
  const dom = loadFixture("zhilian.html");
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  const { fields, scanId, documentFingerprint, formFingerprint } = engine.scan(doc);
  const name = fields.find(f => f.label.includes("姓名"));
  const nameInput = doc.querySelector("input[name='name']");
  assert.equal(nameInput.value, "", "姓名原值应为空");
  const applied = await engine.apply([
    { id: name.id, value: "张三", type: "text", fingerprint: name.fingerprint },
  ], { scanId, documentFingerprint, formFingerprint });
  assert.equal(applied[0].ok, true);
  assert.equal(nameInput.value, "张三");
  assert.ok(nameInput.classList.contains("hunter-fill-done"), "填充成功应有 done 着色");
  const undoResult = await engine.undo({ scanId, documentFingerprint, formFingerprint });
  assert.equal(undoResult.ok, true);
  assert.equal(undoResult.count, 1);
  assert.equal(nameInput.value, "", "撤销后应恢复原值");
  assert.ok(!nameInput.classList.contains("hunter-fill-done"), "撤销后应清除 done 着色");
  assert.ok(!nameInput.classList.contains("hunter-fill-pending"), "撤销后应清除 pending 着色");
  assert.ok(!nameInput.classList.contains("hunter-fill-highlight"), "撤销后应清除高亮");
  dom.window.close();
});

test("撤销本次填充：非空原值、radio 勾选状态与 checkbox 均恢复", async () => {
  const dom = new JSDOM(`<form>
    <label>姓名<input id="name" name="name" type="text" value="旧名字"></label>
    <label>性别<input type="radio" name="gender" value="男"><input type="radio" name="gender" value="女" checked></label>
    <label>同意<input type="checkbox" name="agree" checked></label>
  </form>`, { url: "https://x.com/undo-binary", runScripts: "outside-only", pretendToBeVisual: true });
  dom.window.eval(engineSource);
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  const { fields, scanId, documentFingerprint, formFingerprint } = engine.scan(doc);
  const nameField = fields.find(f => f.type === "text");
  const genderField = fields.find(f => f.type === "radio");
  const agreeField = fields.find(f => f.type === "checkbox");
  assert.ok(nameField && genderField && agreeField, "应识别文本/radio/checkbox 三个字段");
  const male = doc.querySelector("input[type=radio][value=男]");
  const agree = doc.querySelector("input[type=checkbox][name=agree]");
  const applied = await engine.apply([
    { id: nameField.id, value: "张三", type: "text", fingerprint: nameField.fingerprint },
    { id: genderField.id, value: "男", type: "radio", fingerprint: genderField.fingerprint },
    { id: agreeField.id, value: "否", type: "checkbox", fingerprint: agreeField.fingerprint },
  ], { scanId, documentFingerprint, formFingerprint });
  assert.ok(applied.every(r => r.ok), JSON.stringify(applied));
  assert.equal(doc.getElementById("name").value, "张三");
  assert.equal(male.checked, true, "填充后男应选中");
  assert.equal(agree.checked, false, "填充后同意应取消勾选");
  const undoResult = await engine.undo({ scanId, documentFingerprint, formFingerprint });
  assert.equal(undoResult.ok, true);
  assert.equal(undoResult.count, 3);
  assert.equal(doc.getElementById("name").value, "旧名字", "应恢复非空原值");
  assert.equal(male.checked, false, "撤销后男应恢复未选中");
  assert.equal(agree.checked, true, "撤销后同意应恢复勾选");
  dom.window.close();
});

test("着色：批量填充后未填字段着橙、已手填字段不着橙", async () => {
  const dom = loadFixture("zhilian.html");
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  const { fields, scanId, documentFingerprint, formFingerprint } = engine.scan(doc);
  const name = fields.find(f => f.label.includes("姓名"));
  assert.ok(name, "应识别姓名字段");
  // 手动预填三类控件：文本 phone、下拉 degree、radio gender
  const phoneEl = doc.querySelector("input[name='phone']");
  const degreeEl = doc.querySelector("select[name='degree']");
  const maleEl = doc.querySelector("input[name='gender'][value='男']");
  phoneEl.value = "13800138000";
  degreeEl.value = "本科";
  maleEl.checked = true;
  const results = await engine.apply([{ id: name.id, value: "张三", type: "text", fingerprint: name.fingerprint }], { scanId, documentFingerprint, formFingerprint });
  assert.equal(results[0].ok, true);
  const nameEl = doc.querySelector("input[name='name']");
  assert.ok(nameEl.classList.contains("hunter-fill-done"), "成功字段应有 done");
  assert.ok(!phoneEl.classList.contains("hunter-fill-pending"), "已手填文本不应着橙");
  assert.ok(!degreeEl.classList.contains("hunter-fill-pending"), "已手填下拉不应着橙");
  assert.ok(!maleEl.classList.contains("hunter-fill-pending"), "已勾选 radio 不应着橙");
  const emailEl = doc.querySelector("input[name='email']");
  assert.ok(emailEl.classList.contains("hunter-fill-pending"), "未填可见字段应着橙");
  dom.window.close();
});

test("着色：已手填 custom 下拉不着橙", async () => {
  const dom = loadFixture("antd-generic.html");
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  const { fields, scanId, documentFingerprint, formFingerprint } = engine.scan(doc);
  const container = doc.getElementById("arrival");
  const input = container && container.querySelector("input");
  assert.ok(container && input, "应识别到岗时间 custom 控件");
  input.value = "随时到岗"; // 模拟用户已手选（element-ui 风格内部 input 有值）
  const name = fields.find(f => f.label.includes("姓名"));
  assert.ok(name, "应识别姓名字段");
  const applied = await engine.apply([{ id: name.id, value: "张三", type: "text", fingerprint: name.fingerprint }], { scanId, documentFingerprint, formFingerprint });
  assert.equal(applied[0].ok, true);
  assert.ok(!container.classList.contains("hunter-fill-pending"), "已手填 custom 下拉不应着橙");
  dom.window.close();
});

test("着色：单字段填充路径不触发全页染橙", async () => {
  const dom = loadFixture("zhilian.html");
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  const { fields, scanId, documentFingerprint, formFingerprint } = engine.scan(doc);
  const name = fields.find(f => f.label.includes("姓名"));
  assert.ok(name, "应识别姓名字段");
  const filled = await engine.fillField({ id: name.id, value: "张三", type: "text", fingerprint: name.fingerprint }, { scanId, documentFingerprint, formFingerprint });
  assert.equal(filled.ok, true);
  const nameEl = doc.querySelector("input[name='name']");
  assert.ok(nameEl.classList.contains("hunter-fill-done"), "单字段填充成功字段仍应有 done");
  const emailEl = doc.querySelector("input[name='email']");
  assert.ok(!emailEl.classList.contains("hunter-fill-pending"), "单字段路径不应整页染橙");
  assert.equal(doc.querySelectorAll(".hunter-fill-pending").length, 0, "单字段路径不应产生任何 pending 着色");
  dom.window.close();
});

test("着色：未勾选 checkbox 批量填充后着橙、已勾选 checkbox 不着橙", async () => {
  // dayi：未勾选「我同意以上信息属实」，value="同意"（非空）不得被误判为已填
  const dom = loadFixture("dayi.html");
  const engine = dom.window.__hunterFill;
  const doc = dom.window.document;
  const { fields, scanId, documentFingerprint, formFingerprint } = engine.scan(doc);
  const name = fields.find(f => f.label.includes("姓名"));
  const agree = fields.find(f => f.type === "checkbox" && /同意/.test(f.label));
  assert.ok(name && agree, "应识别姓名与同意复选框");
  const agreeEl = doc.querySelector("input[name='agree']");
  assert.equal(agreeEl.checked, false, "初始应未勾选");
  await engine.apply([{ id: name.id, value: "张三", type: "text", fingerprint: name.fingerprint }], { scanId, documentFingerprint, formFingerprint });
  assert.ok(agreeEl.classList.contains("hunter-fill-pending"), "未勾选 checkbox 应着橙");

  // antd：已勾选「技能」复选框不着橙
  const dom2 = loadFixture("antd-generic.html");
  const doc2 = dom2.window.document;
  const eng2 = dom2.window.__hunterFill;
  const { fields: f2, scanId: s2, documentFingerprint: df2, formFingerprint: ff2 } = eng2.scan(doc2);
  const skill = f2.find(f => f.type === "checkbox" && /技能/.test(f.label));
  const name2 = f2.find(f => f.label.includes("姓名"));
  assert.ok(skill && name2, "应识别技能复选框与姓名字段");
  const skillEl = doc2.getElementById("skill");
  skillEl.checked = true;
  await eng2.apply([{ id: name2.id, value: "张三", type: "text", fingerprint: name2.fingerprint }], { scanId: s2, documentFingerprint: df2, formFingerprint: ff2 });
  assert.ok(!skillEl.classList.contains("hunter-fill-pending"), "已勾选 checkbox 不应着橙");
  dom.window.close();
});
