// 智能填充：规范字段字典、标签归一化、控件类型分类。
// 纯函数模块，不依赖 chrome / DOM，可在 Node 下测试。

// 规范字段字典（约 31 个网申常见字段）。
// keywords 为子串命中词：归一化后的标签只要包含任一关键词即参与打分。
export const CANONICAL_FIELDS = [
  { key: "name", label: "姓名", type: "text", keywords: ["姓名", "名字", "真实姓名", "中文名", "full name", "name"] },
  { key: "phone", label: "手机号", type: "tel", keywords: ["手机号", "手机号码", "联系电话", "联系方式", "电话号码", "手机", "电话", "phone number", "mobile", "mobile phone", "tel", "telephone", "contact number"] },
  { key: "email", label: "邮箱", type: "email", keywords: ["邮箱", "电子邮件", "电子邮箱", "邮箱地址", "联系邮箱", "email", "e-mail", "mail"] },
  { key: "gender", label: "性别", type: "text", keywords: ["性别", "gender", "sex"] },
  { key: "birthDate", label: "出生日期", type: "date", keywords: ["出生日期", "出生年月", "生日", "出生时间", "birthday", "date of birth", "dob"] },
  { key: "idCard", label: "身份证号", type: "text", keywords: ["身份证号", "身份证号码", "证件号码", "证件号", "身份证", "id card", "id number", "idno", "national id"] },
  { key: "hometown", label: "籍贯", type: "text", keywords: ["籍贯", "生源地", "户口所在地", "户籍所在地", "户籍", "hometown", "native place", "hukou"] },
  { key: "currentCity", label: "现居城市", type: "text", keywords: ["现居城市", "现居住地", "所在城市", "居住城市", "当前城市", "常住城市", "current city", "residence city", "current location"] },
  { key: "address", label: "通讯地址", type: "text", keywords: ["通讯地址", "联系地址", "家庭住址", "详细地址", "常住地址", "地址", "address", "postal address"] },
  { key: "postcode", label: "邮编", type: "text", keywords: ["邮编", "邮政编码", "postal code", "zip code", "zip"] },
  { key: "school", label: "毕业院校", type: "text", keywords: ["毕业院校", "毕业学校", "学校", "院校", "大学", "学院", "最高学历院校", "就读学校", "school", "college", "university", "institute", "alma mater"] },
  { key: "degree", label: "学历", type: "select", keywords: ["最高学历", "学历", "学位", "教育程度", "degree", "education level", "education"] },
  { key: "major", label: "专业", type: "text", keywords: ["专业", "所学专业", "主修专业", "毕业专业", "major", "specialty", "discipline"] },
  { key: "graduationYear", label: "毕业时间", type: "text", keywords: ["毕业时间", "毕业年份", "预计毕业", "毕业年", "graduation year", "graduation date", "expected graduation"] },
  { key: "workYears", label: "工作年限", type: "select", keywords: ["工作年限", "工作经验", "工作年数", "从业年限", "年限", "work years", "years of experience", "experience years"] },
  { key: "currentCompany", label: "现公司", type: "text", keywords: ["当前公司", "现公司", "目前公司", "就职公司", "现就职", "当前雇主", "current company", "employer", "company"] },
  { key: "currentTitle", label: "现职位", type: "text", keywords: ["当前职位", "现职位", "目前职位", "现任职位", "当前岗位", "现任岗位", "current position", "current title", "job title", "current job"] },
  { key: "expectedCity", label: "期望城市", type: "text", keywords: ["期望城市", "意向城市", "期望工作城市", "意向工作城市", "目标城市", "expected city", "desired city", "target city"] },
  { key: "expectedSalary", label: "期望薪资", type: "text", keywords: ["期望薪资", "期望薪酬", "期望月薪", "期望年薪", "薪资要求", "薪酬要求", "期望待遇", "expected salary", "salary expectation", "desired salary"] },
  { key: "expectedPosition", label: "期望职位", type: "text", keywords: ["期望职位", "期望岗位", "意向职位", "意向岗位", "应聘职位", "应聘岗位", "求职意向", "目标职位", "expected position", "desired position", "target position", "applied position"] },
  { key: "selfEvaluation", label: "自我评价", type: "textarea", keywords: ["自我评价", "自我介绍", "个人评价", "个人简介", "自我描述", "个人介绍", "self evaluation", "self introduction", "about me", "profile summary"] },
  { key: "skills", label: "专业技能", type: "textarea", keywords: ["专业技能", "技能特长", "个人技能", "技能", "特长", "skills", "expertise", "competencies", "skill set"] },
  { key: "languages", label: "语言能力", type: "text", keywords: ["语言能力", "外语水平", "英语水平", "语言水平", "外语能力", "语言", "language skills", "english level", "english proficiency", "languages"] },
  { key: "hobbies", label: "兴趣爱好", type: "text", keywords: ["兴趣爱好", "爱好", "兴趣", "hobbies", "interests"] },
  { key: "availableTime", label: "到岗时间", type: "text", keywords: ["到岗时间", "入职时间", "最快到岗", "可到岗时间", "可到岗日期", "预计到岗", "start date", "available date", "notice period", "availability"] },
  { key: "referral", label: "推荐人", type: "text", keywords: ["推荐人", "内推人", "推荐人姓名", "referral", "referrer"] },
  { key: "github", label: "Github", type: "text", keywords: ["github", "github 地址", "github账号", "github 账号"] },
  { key: "linkedin", label: "LinkedIn", type: "text", keywords: ["linkedin", "领英", "linkedin 地址", "linkedin地址"] },
  { key: "politicalStatus", label: "政治面貌", type: "select", keywords: ["政治面貌", "党员", "political status", "party membership"] },
  { key: "maritalStatus", label: "婚姻状况", type: "select", keywords: ["婚姻状况", "婚姻状态", "marital status", "marriage"] },
  { key: "portfolio", label: "作品集", type: "text", keywords: ["作品集", "个人主页", "作品链接", "项目作品", "portfolio", "personal website", "personal site"] },
];

export const FIELD_BY_KEY = Object.fromEntries(CANONICAL_FIELDS.map(field => [field.key, field]));

// UI 展示用：key → 中文名。
export const RESUME_FIELD_LABELS = Object.fromEntries(CANONICAL_FIELDS.map(field => [field.key, field.label]));

// 标签归一化：去必填/选填/星号/请填写/请输入、标点与全部空白，转小写。
export function normalizeLabel(value) {
  let text = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  text = text.replace(/[*＊]/g, "");
  text = text.replace(/(?:（|\()必填(?:）|\))/g, "");
  text = text.replace(/(?:（|\()选填(?:）|\))/g, "");
  text = text.replace(/必填|选填/g, "");
  text = text.replace(/请填写|请输入/g, "");
  text = text.replace(/[：:，,。.！!？?；;【】\[\]「」『』"'“”‘’（）()]/g, "");
  return text.replace(/\s+/g, "").toLowerCase();
}

// 控件类型分类（纯函数，输入为 { tag, type, cls } 形状）。
// skipped=true 表示不可自动填充（密码/文件/隐藏等）。
export function classifyControl(desc = {}) {
  const tag = String(desc.tag || "").toLowerCase();
  const type = String(desc.type || "").toLowerCase();
  const cls = String(desc.cls || desc.className || "").toLowerCase();
  if (/ant-picker|el-date-editor/.test(cls)) return { type: "custom-date", skipped: false };
  if (/ant-select|el-select/.test(cls)) return { type: "custom-select", skipped: false };
  if (tag === "select") return { type: "select", skipped: false };
  if (tag === "textarea") return { type: "textarea", skipped: false };
  if (tag === "input") {
    if (type === "radio") return { type: "radio", skipped: false };
    if (type === "checkbox") return { type: "checkbox", skipped: false };
    if (["date", "month", "datetime-local", "time"].includes(type)) return { type: "date", skipped: false };
    if (["password", "file", "hidden", "submit", "button", "image", "reset"].includes(type)) return { type: "text", skipped: true };
    if (["tel", "email", "number", "url", "search"].includes(type)) return { type, skipped: false };
    return { type: "text", skipped: false };
  }
  return { type: "text", skipped: true };
}
