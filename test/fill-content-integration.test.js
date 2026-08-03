import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { matchRules } from "../src/matcher.js";

const engineSource = readFileSync(new URL("../fill-content.js", import.meta.url), "utf8");
const fixture = name => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

const FULL_RESUME = {
  name: "张三", phone: "13800138000", email: "zhangsan@example.com", gender: "男", birthDate: "1998-06",
  idCard: "110101199806010011", hometown: "北京", currentCity: "上海", address: "上海市浦东新区", postcode: "200120",
  school: "复旦大学", degree: "本科", major: "计算机科学与技术", graduationYear: "2020", workYears: "5年",
  currentCompany: "某科技公司", currentTitle: "产品经理", expectedCity: "上海", expectedSalary: "30-40K",
  expectedPosition: "高级产品经理", selfEvaluation: "5 年产品经验，擅长需求分析", skills: "Axure、SQL、Python",
  languages: "英语 CET-6", hobbies: "阅读", availableTime: "随时到岗", referral: "王五",
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
];

// 每个夹具的标签 -> 期望字段 key 映射（含 skipped 与手动项）。
const EXPECTED_MAP = {
  "antd-generic.html": { 姓名: "name", 手机号码: "phone", 邮箱: "email", 性别: "gender", 最高学历: "degree", 毕业院校: "school", 期望薪资: "expectedSalary", 自我评价: "selfEvaluation", 到岗时间: "availableTime", 技能: null },
  "zhilian.html": { 姓名: "name", 手机号: "phone", 邮箱: "email", 性别: "gender", 学历: "degree", 专业: "major", 毕业院校: "school", 期望城市: "expectedCity", 期望职位: "expectedPosition", 到岗时间: "availableTime", 自我评价: "selfEvaluation" },
  "moka.html": { 姓名: "name", 联系电话: "phone", 邮箱: "email", 现居城市: "currentCity", 毕业院校: "school", 学历: "degree", 专业: "major", 工作年限: "workYears", 自我介绍: "selfEvaluation", 出生日期: "birthDate" },
  "beisen.html": { 姓名: "name", 手机号: "phone", 邮箱: "email", 性别: "gender", 生日: "birthDate", 籍贯: "hometown", 政治面貌: "politicalStatus", 婚姻状况: "maritalStatus", 通讯地址: "address", 邮编: "postcode", 实习公司: "internshipCompany", 实习岗位: "internshipTitle", 实习时间: "internshipPeriod", 实习内容: "internshipDescription", 项目名称: "projectName", 项目角色: "projectRole", 项目内容: "projectDescription" },
  "dayi.html": { 姓名: "name", 手机号: "phone", 邮箱: "email", 毕业院校: "school", 专业: "major", 期望薪资: null, 到岗时间: "availableTime", 自我评价: "selfEvaluation", 我同意以上信息属实: null },
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

test("匹配：5 个夹具的常见字段与复杂字段", () => {
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
      }
    }
    dom.window.close();
  }
  assert.equal(manualExpected, 3, `应存在 3 个需手动字段（技能勾选/同意勾选/选项不匹配），实际 ${manualExpected}`);
  assert.equal(manualCorrect, 3);
  // 匹配率口径：正确匹配 + 正确判为「需手动」都算正确处理。
  assert.ok((correct + manualCorrect) / total >= 0.95, `标签匹配率 ${correct + manualCorrect}/${total}`);
});

test("填充执行：5 个夹具原生/下拉/单选/多选/日期全部成功", async () => {
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
    const applied = await engine.apply(fills, { delayMs: 0 });
    const failed = applied.filter(r => !r.ok);
    assert.equal(failed.length, 0, `${f.name} 填充失败: ${JSON.stringify(failed.map(r => ({ id: r.id, error: r.error })))}`);
    // 回读验证
    const doc = dom.window.document;
    const byLabel = Object.fromEntries(fields.map(field => [field.label, field]));
    if (byLabel["姓名"]) assert.equal(doc.getElementById("name")?.value || doc.querySelector("[name=name]").value, "张三");
    if (byLabel["手机号码"] || byLabel["手机号"]) {
      const phone = doc.querySelector("[name=phone], #mobile");
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
