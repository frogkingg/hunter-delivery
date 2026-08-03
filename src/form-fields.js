// 智能填充：规范字段字典、标签归一化、控件类型分类。
// 纯函数模块，不依赖 chrome / DOM，可在 Node 下测试。

// 规范字段字典（约 47 个网申常见字段，按分组组织）。
// keywords 为子串命中词：归一化后的标签只要包含任一关键词即参与打分。
// group 用于面板「简历字段」分区展示：basic/education/work/internship/project/profile/other。
export const CANONICAL_FIELDS = [
  // —— 基本信息 ——
  { key: "name", label: "姓名", type: "text", group: "basic", keywords: ["姓名", "名字", "真实姓名", "中文名", "full name", "name"] },
  { key: "phone", label: "手机号", type: "tel", group: "basic", keywords: ["手机号", "手机号码", "联系电话", "联系方式", "电话号码", "手机", "电话", "phone number", "phone", "mobile", "mobile phone", "tel", "telephone", "contact number"] },
  { key: "email", label: "邮箱", type: "email", group: "basic", keywords: ["邮箱", "电子邮件", "电子邮箱", "邮箱地址", "联系邮箱", "email", "email address", "e-mail", "e-mail address", "mail"] },
  { key: "gender", label: "性别", type: "text", group: "basic", keywords: ["性别", "gender", "sex"] },
  { key: "birthDate", label: "出生日期", type: "date", group: "basic", keywords: ["出生日期", "出生年月", "生日", "出生时间", "birthday", "date of birth", "dob"] },
  { key: "idCard", label: "身份证号", type: "text", group: "basic", keywords: ["身份证号", "身份证号码", "证件号码", "证件号", "身份证", "id card", "id number", "idno", "national id"] },
  { key: "hometown", label: "籍贯", type: "text", group: "basic", keywords: ["籍贯", "生源地", "户口所在地", "户籍所在地", "户籍", "hometown", "native place", "hukou"] },
  { key: "currentCity", label: "现居城市", type: "text", group: "basic", keywords: ["现居城市", "现居住地", "所在城市", "居住城市", "当前城市", "常住城市", "current city", "residence city", "current location"] },
  { key: "address", label: "通讯地址", type: "text", group: "basic", keywords: ["通讯地址", "联系地址", "家庭住址", "详细地址", "常住地址", "地址", "address", "postal address"] },
  { key: "postcode", label: "邮编", type: "text", group: "basic", keywords: ["邮编", "邮政编码", "postal code", "zip code", "zip"] },
  { key: "politicalStatus", label: "政治面貌", type: "select", group: "basic", keywords: ["政治面貌", "党员", "political status", "party membership"] },
  { key: "maritalStatus", label: "婚姻状况", type: "select", group: "basic", keywords: ["婚姻状况", "婚姻状态", "marital status", "marriage"] },

  // —— 求职意向 ——
  { key: "expectedCity", label: "期望城市", type: "text", group: "intention", keywords: ["期望城市", "意向城市", "期望工作城市", "意向工作城市", "目标城市", "expected city", "desired city", "target city"] },
  { key: "expectedSalary", label: "期望薪资", type: "text", group: "intention", keywords: ["期望薪资", "期望薪酬", "期望月薪", "期望年薪", "薪资要求", "薪酬要求", "期望待遇", "expected salary", "salary expectation", "desired salary"] },
  { key: "expectedPosition", label: "期望职位", type: "text", group: "intention", keywords: ["期望职位", "期望岗位", "意向职位", "意向岗位", "应聘职位", "应聘岗位", "求职意向", "目标职位", "expected position", "desired position", "target position", "applied position"] },
  { key: "availableTime", label: "到岗时间", type: "text", group: "intention", keywords: ["到岗时间", "入职时间", "最快到岗", "可到岗时间", "可到岗日期", "预计到岗", "start date", "available date", "notice period", "availability"] },

  // —— 教育经历 ——
  { key: "school", label: "毕业院校", type: "text", group: "education", keywords: ["毕业院校", "毕业学校", "学校", "院校", "大学", "学院", "最高学历院校", "就读学校", "school", "college", "university", "institute", "alma mater"] },
  { key: "degree", label: "学历", type: "select", group: "education", keywords: ["最高学历", "学历", "学位", "教育程度", "degree", "education level", "education"] },
  { key: "major", label: "专业", type: "text", group: "education", keywords: ["专业", "所学专业", "主修专业", "毕业专业", "major", "specialty", "discipline"] },
  { key: "graduationYear", label: "毕业时间", type: "text", group: "education", keywords: ["毕业时间", "毕业年份", "预计毕业", "毕业年", "graduation year", "graduation date", "expected graduation"] },

  // —— 工作经历 ——
  { key: "workYears", label: "工作年限", type: "select", group: "work", keywords: ["工作年限", "工作经验", "工作年数", "从业年限", "年限", "work years", "years of experience", "experience years", "experience"] },
  { key: "currentCompany", label: "现公司", type: "text", group: "work", keywords: ["当前公司", "现公司", "目前公司", "就职公司", "现就职", "现工作单位", "工作单位", "当前雇主", "current company", "employer", "company"] },
  { key: "currentTitle", label: "现职位", type: "text", group: "work", keywords: ["当前职位", "现职位", "目前职位", "现任职位", "当前岗位", "现任岗位", "current position", "current title", "job title", "current job"] },

  // —— 实习经历 ——
  { key: "internshipCompany", label: "实习公司", type: "text", group: "internship", keywords: ["实习公司", "实习单位", "实习企业", "实习机构", "internship company", "internship employer"] },
  { key: "internshipTitle", label: "实习岗位", type: "text", group: "internship", keywords: ["实习岗位", "实习职位", "实习岗位名称", "internship position", "internship role", "internship title"] },
  { key: "internshipStart", label: "实习开始时间", type: "date", group: "internship", keywords: ["实习开始时间", "实习起始时间", "实习开始日期", "internship start"] },
  { key: "internshipEnd", label: "实习结束时间", type: "date", group: "internship", keywords: ["实习结束时间", "实习终止时间", "实习结束日期", "internship end"] },
  { key: "internshipPeriod", label: "实习时间", type: "text", group: "internship", keywords: ["实习时间", "实习期间", "实习起止", "internship period", "internship duration"] },
  { key: "internshipDescription", label: "实习内容", type: "textarea", group: "internship", keywords: ["实习内容", "实习工作内容", "实习经历描述", "实习职责", "internship description", "internship duties", "internship summary"] },

  // —— 项目经历 ——
  { key: "projectName", label: "项目名称", type: "text", group: "project", keywords: ["项目名称", "项目名", "project name", "project title"] },
  { key: "projectRole", label: "项目角色", type: "text", group: "project", keywords: ["项目角色", "项目职责", "担任角色", "项目中的角色", "project role", "project responsibility"] },
  { key: "projectCompany", label: "项目公司", type: "text", group: "project", keywords: ["项目公司", "所属公司", "项目单位", "项目所在公司", "project company", "project organization"] },
  { key: "projectStart", label: "项目开始时间", type: "date", group: "project", keywords: ["项目开始时间", "项目起始时间", "project start"] },
  { key: "projectEnd", label: "项目结束时间", type: "date", group: "project", keywords: ["项目结束时间", "项目终止时间", "project end"] },
  { key: "projectPeriod", label: "项目时间", type: "text", group: "project", keywords: ["项目时间", "项目周期", "项目起止时间", "project period", "project duration"] },
  { key: "projectDescription", label: "项目内容", type: "textarea", group: "project", keywords: ["项目内容", "项目描述", "项目简介", "项目成果", "项目总结", "project description", "project content", "project summary", "project details"] },

  // —— 个人介绍 ——
  { key: "profileSummary", label: "个人简介", type: "textarea", group: "profile", keywords: ["个人简介", "个人概述", "个人介绍", "profile summary", "personal profile", "about me", "personal summary"] },
  { key: "selfEvaluation", label: "自我评价", type: "textarea", group: "profile", keywords: ["自我评价", "自我介绍", "个人评价", "自我描述", "self evaluation", "self introduction"] },
  { key: "skills", label: "专业技能", type: "textarea", group: "profile", keywords: ["专业技能", "技能特长", "个人技能", "技能", "特长", "skills", "expertise", "competencies", "skill set"] },
  { key: "languages", label: "语言能力", type: "text", group: "profile", keywords: ["语言能力", "外语水平", "英语水平", "语言水平", "外语能力", "语言", "language skills", "english level", "english proficiency", "languages"] },
  { key: "hobbies", label: "兴趣爱好", type: "text", group: "profile", keywords: ["兴趣爱好", "爱好", "兴趣", "hobbies", "interests"] },
  { key: "github", label: "Github", type: "text", group: "profile", keywords: ["github", "github 地址", "github账号", "github 账号"] },
  { key: "linkedin", label: "LinkedIn", type: "text", group: "profile", keywords: ["linkedin", "领英", "linkedin 地址", "linkedin地址"] },
  { key: "portfolio", label: "作品集", type: "text", group: "profile", keywords: ["作品集", "个人主页", "作品链接", "项目作品", "portfolio", "personal website", "personal site"] },
  { key: "referral", label: "推荐人", type: "text", group: "profile", keywords: ["推荐人", "内推人", "推荐人姓名", "referral", "referrer"] },

  // —— 其他 / 补充 ——
  { key: "awards", label: "获奖情况", type: "textarea", group: "other", keywords: ["获奖情况", "获奖经历", "所获奖励", "荣誉奖项", "奖项", "awards", "honors", "prizes"] },
  { key: "certificates", label: "证书", type: "textarea", group: "other", keywords: ["资格证书", "证书", "职业证书", "技能证书", "certificates", "certification", "qualifications"] },
  { key: "campusExperience", label: "校园经历", type: "textarea", group: "other", keywords: ["校园经历", "学生工作", "社团经历", "校园活动", "campus experience", "student activities", "extracurricular"] },
  { key: "additionalInfo", label: "补充内容", type: "textarea", group: "other", keywords: ["补充内容", "补充说明", "其他说明", "其他信息", "附加信息", "备注", "additional info", "additional information", "other info", "notes", "remarks"] },
];

export const FIELD_BY_KEY = Object.fromEntries(CANONICAL_FIELDS.map(field => [field.key, field]));

// UI 展示用：key → 中文名。
export const RESUME_FIELD_LABELS = Object.fromEntries(CANONICAL_FIELDS.map(field => [field.key, field.label]));

// UI 分组标题。
export const GROUP_LABELS = {
  basic: "基本信息",
  intention: "求职意向",
  education: "教育经历",
  work: "工作经历",
  internship: "实习经历",
  project: "项目经历",
  profile: "个人介绍",
  other: "其他 / 补充",
};

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
