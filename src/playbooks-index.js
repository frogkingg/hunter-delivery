// playbook 列表索引：面板侧直接消费的站点内置语义映射。
//
// 为什么不用 import JSON / readFileSync：
//  - Node 26 支持 `import ... with { type: "json" }`，但项目 rollup 4 不带 @rollup/plugin-json，
//    直接 import JSON 会让 `npm run build` 失败（已实测）。
//  - readFileSync/createRequire 会在浏览器 bundle 中外置 node:fs，面板运行时报模块解析错误。
// 因此这里把 moka 数据内联为纯 ESM 常量（与 src/playbooks/moka.json 镜像，
// 校验源以 scripts/validate-playbooks.mjs + moka.json 为准；新增站点需同步维护两处）。

export const PLAYBOOKS = [
  {
    schemaVersion: 2,
    host: "app.mokahr.com",
    scope: { routePattern: "/campus_apply/**" },
    mappings: [
      { siteLabel: "姓名", controlType: "text", slot: "single", fieldKey: "name", valueRef: { source: "resume", path: "basic.name" } },
      { siteLabel: "手机号", controlType: "tel", slot: "single", fieldKey: "phone", valueRef: { source: "resume", path: "basic.phone" } },
      { siteLabel: "毕业院校", controlType: "text", slot: "single", fieldKey: "school", valueRef: { source: "resume", path: "education.school" } },
      { siteLabel: "毕业时间", controlType: "custom-date", slot: "start", fieldKey: "graduationYear", valueRef: { source: "resume", path: "education.0.endDate" } },
    ],
    denyList: ["紧急联系人", "证明人", "亲属", "监护人"],
    requireManual: ["idCard", "expectedSalary"],
    version: "2026-08-05",
  },
];
