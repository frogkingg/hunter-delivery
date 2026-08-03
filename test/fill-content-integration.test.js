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
  { name: "beisen.html", totalControls: 10, expectFields: 10 },
  { name: "dayi.html", totalControls: 9, expectFields: 9 },
];

// 每个夹具的标签 -> 期望字段 key 映射（含 skipped 与手动项）。
const EXPECTED_MAP = {
  "antd-generic.html": { 姓名: "name", 手机号码: "phone", 邮箱: "email", 性别: "gender", 最高学历: "degree", 毕业院校: "school", 期望薪资: "expectedSalary", 自我评价: "selfEvaluation", 到岗时间: "availableTime", 技能: null },
  "zhilian.html": { 姓名: "name", 手机号: "phone", 邮箱: "email", 性别: "gender", 学历: "degree", 专业: "major", 毕业院校: "school", 期望城市: "expectedCity", 期望职位: "expectedPosition", 到岗时间: "availableTime", 自我评价: "selfEvaluation" },
  "moka.html": { 姓名: "name", 联系电话: "phone", 邮箱: "email", 现居城市: "currentCity", 毕业院校: "school", 学历: "degree", 专业: "major", 工作年限: "workYears", 自我介绍: "selfEvaluation", 出生日期: "birthDate" },
  "beisen.html": { 姓名: "name", 手机号: "phone", 邮箱: "email", 性别: "gender", 生日: "birthDate", 籍贯: "hometown", 政治面貌: "politicalStatus", 婚姻状况: "maritalStatus", 通讯地址: "address", 邮编: "postcode" },
  "dayi.html": { 姓名: "name", 手机号: "phone", 邮箱: "email", 毕业院校: "school", 专业: "major", 期望薪资: "expectedSalary", 到岗时间: "availableTime", 自我评价: "selfEvaluation", 我同意以上信息属实: null },
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
  assert.equal(manualExpected, 2, "应存在 2 个需手动字段（antd 技能勾选、dayi 同意勾选）");
  assert.equal(manualCorrect, 2);
  assert.ok(correct / total >= 0.95, `标签匹配率 ${correct}/${total}`);
});

test("填充执行：5 个夹具原生/下拉/单选/多选/日期全部成功", async () => {
  for (const f of FIXTURES) {
    const dom = loadFixture(f.name);
    const engine = dom.window.__hunterFill;
    const { fields } = engine.scan(dom.window.document);
    const expected = EXPECTED_MAP[f.name];
    const results = matchRules(fields, FULL_RESUME);
    // 排除确定会因选项集不匹配失败的字段（如 moka 工作年限 5年 不在选项内）
    const exclude = new Set(["moka.html:工作年限", "dayi.html:期望薪资"]);
    const fills = results
      .filter(m => m.status === "match" && expected[m.label] && !exclude.has(`${f.name}:${m.label}`))
      .map(m => ({ id: m.fieldId, value: m.value, type: fields.find(x => x.id === m.fieldId).type }));
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
