// 智能填充：规范字段字典、标签归一化、控件类型分类。
// 纯函数模块，不依赖 chrome / DOM，可在 Node 下测试。

// 规范字段字典（约 47 个网申常见字段，按分组组织）。
// keywords 为子串命中词：归一化后的标签只要包含任一关键词即参与打分。
// group 用于面板「简历字段」分区展示：basic/education/work/internship/project/profile/other。
export const CANONICAL_FIELDS = [
  // —— 基本信息 ——
  { key: "name", label: "姓名", type: "text", group: "basic", keywords: ["姓名", "名字", "真实姓名", "中文名", "full name", "name"] },
  { key: "nickname", label: "昵称", type: "text", group: "basic", keywords: ["花名/昵称", "花名", "昵称", "nick name", "nickname", "preferred name"] },
  { key: "lastNamePinyin", label: "姓全拼", type: "text", group: "basic", keywords: ["姓全拼", "姓拼音", "英文姓", "last name pinyin", "surname pinyin", "family name"] },
  { key: "firstNamePinyin", label: "名全拼", type: "text", group: "basic", keywords: ["名全拼", "名拼音", "英文名", "first name pinyin", "given name pinyin", "given name"] },
  { key: "phone", label: "手机号", type: "tel", group: "basic", keywords: ["手机号", "手机号码", "联系电话", "联系方式", "电话号码", "手机", "电话", "phone number", "phone", "mobile", "mobile phone", "tel", "telephone", "contact number"] },
  { key: "email", label: "邮箱", type: "email", group: "basic", keywords: ["邮箱", "电子邮件", "电子邮箱", "邮箱地址", "联系邮箱", "email", "email address", "e-mail", "e-mail address", "mail"] },
  { key: "qq", label: "QQ", type: "text", group: "basic", keywords: ["qq号", "qq号码", "腾讯qq", "qq number", "qq"] },
  { key: "wechat", label: "微信", type: "text", group: "basic", keywords: ["微信号", "微信账号", "微信", "wechat id", "wechat account", "wechat"] },
  { key: "imType", label: "IM 类型", type: "select", group: "basic", keywords: ["im类型", "即时通讯类型", "联系方式类型", "im type", "messaging type", "contact type"] },
  { key: "gender", label: "性别", type: "text", group: "basic", keywords: ["性别", "gender", "sex"] },
  { key: "birthDate", label: "出生日期", type: "date", group: "basic", keywords: ["出生日期", "出生年月", "生日", "出生时间", "birthday", "date of birth", "dob"] },
  { key: "nationality", label: "国籍", type: "select", group: "basic", keywords: ["国籍", "国家/地区", "国家地区", "nationality", "citizenship", "country"] },
  { key: "idCard", label: "身份证号", type: "text", group: "basic", keywords: ["身份证号", "身份证号码", "证件号码", "证件号", "身份证", "id card", "id number", "idno", "national id"] },
  { key: "hometown", label: "籍贯", type: "text", group: "basic", keywords: ["籍贯", "生源地", "户口所在地", "户籍所在地", "户籍", "hometown", "native place", "hukou"] },
  { key: "currentCity", label: "现居城市", type: "text", group: "basic", keywords: ["现居城市", "现居住地", "所在地", "所在城市", "居住城市", "当前城市", "常住城市", "current city", "residence city", "current location"] },
  { key: "address", label: "通讯地址", type: "text", group: "basic", keywords: ["通讯地址", "联系地址", "家庭住址", "详细地址", "常住地址", "地址", "address", "postal address"] },
  { key: "postcode", label: "邮编", type: "text", group: "basic", keywords: ["邮编", "邮政编码", "postal code", "zip code", "zip"] },
  { key: "politicalStatus", label: "政治面貌", type: "select", group: "basic", keywords: ["政治面貌", "党员", "political status", "party membership"] },
  { key: "maritalStatus", label: "婚姻状况", type: "select", group: "basic", keywords: ["婚姻状况", "婚姻状态", "marital status", "marriage"] },

  // —— 求职意向 ——
  { key: "expectedCity", label: "期望城市", type: "text", group: "intention", keywords: ["期望城市", "意向城市", "期望工作城市", "意向工作城市", "目标城市", "expected city", "desired city", "target city"] },
  { key: "expectedSalary", label: "期望薪资", type: "text", group: "intention", keywords: ["期望薪资", "期望薪酬", "期望月薪", "期望年薪", "薪资要求", "薪酬要求", "期望待遇", "expected salary", "salary expectation", "desired salary"] },
  { key: "expectedPosition", label: "期望职位", type: "text", group: "intention", keywords: ["期望职位", "期望岗位", "意向职位", "意向岗位", "应聘职位", "应聘岗位", "求职意向", "目标职位", "expected position", "desired position", "target position", "applied position"] },
  { key: "availableTime", label: "到岗时间", type: "text", group: "intention", keywords: ["到岗时间", "入职时间", "最快到岗", "可到岗时间", "可到岗日期", "预计到岗", "start date", "available date", "notice period", "availability"] },
  { key: "acceptAdjustment", label: "接受岗位调剂", type: "select", group: "intention", keywords: ["是否接受岗位调剂", "接受岗位调剂", "岗位调剂", "accept reassignment", "position adjustment", "job reassignment"] },
  { key: "informationSource", label: "招聘信息来源", type: "select", group: "intention", keywords: ["校招信息来源", "招聘信息来源", "信息来源", "recruitment source", "information source", "how did you hear"] },

  // —— 教育经历 ——
  { key: "school", label: "毕业院校", type: "text", group: "education", keywords: ["毕业院校", "毕业学校", "学校", "院校", "大学", "学院", "最高学历院校", "就读学校", "school", "college", "university", "institute", "alma mater"] },
  { key: "schoolLocation", label: "学校所在地", type: "text", group: "education", keywords: ["学校所在地", "院校所在地", "学校地址", "school location", "school address", "campus location"] },
  { key: "college", label: "学院", type: "text", group: "education", keywords: ["学院名称", "所属学院", "学院", "faculty name", "academic college", "department"] },
  { key: "degree", label: "学历", type: "select", group: "education", keywords: ["最高学历", "学历", "学位", "教育程度", "degree", "education level", "education"] },
  { key: "major", label: "专业", type: "text", group: "education", keywords: ["专业", "所学专业", "主修专业", "毕业专业", "major", "specialty", "discipline"] },
  { key: "educationStart", label: "就读时间", type: "date", group: "education", keywords: ["就读时间", "入学时间", "教育开始时间", "education start", "study start", "enrollment date"] },
  { key: "graduationYear", label: "毕业时间", type: "text", group: "education", keywords: ["毕业时间", "毕业年份", "预计毕业", "毕业年", "graduation year", "graduation date", "expected graduation"] },
  { key: "studyMode", label: "学习形式", type: "select", group: "education", keywords: ["学习形式", "培养方式", "就读形式", "study mode", "study type", "attendance type"] },

  // —— 工作经历 ——
  { key: "workYears", label: "工作年限", type: "select", group: "work", keywords: ["工作年限", "工作经验", "工作年数", "从业年限", "年限", "work years", "years of experience", "experience years", "experience"] },
  { key: "currentCompany", label: "现公司", type: "text", group: "work", keywords: ["当前公司", "现公司", "目前公司", "就职公司", "现就职", "现工作单位", "工作单位", "公司名称", "当前雇主", "current company", "employer", "company"] },
  { key: "workIndustry", label: "工作行业", type: "text", group: "work", keywords: ["所在行业", "公司行业", "工作行业", "industry", "company industry", "work industry"] },
  { key: "workLocation", label: "工作地点", type: "text", group: "work", keywords: ["工作地点", "任职地点", "公司地址", "work location", "job location", "company address"] },
  { key: "currentTitle", label: "现职位", type: "text", group: "work", keywords: ["当前职位", "现职位", "目前职位", "现任职位", "当前岗位", "现任岗位", "职位名称", "current position", "current title", "job title", "current job"] },
  { key: "workStart", label: "工作开始时间", type: "date", group: "work", keywords: ["工作开始时间", "任职开始时间", "入职时间", "work start", "employment start", "job start date"] },
  { key: "workEnd", label: "工作结束时间", type: "date", group: "work", keywords: ["工作结束时间", "任职结束时间", "离职时间", "work end", "employment end", "job end date"] },
  { key: "workDescription", label: "工作职责", type: "textarea", group: "work", keywords: ["工作职责", "工作内容", "职责描述", "work responsibility", "work description", "job duties"] },

  // —— 实习经历 ——
  { key: "internshipCompany", label: "实习公司", type: "text", group: "internship", keywords: ["实习公司", "实习单位", "实习企业", "公司名称", "公司", "internship company", "internship employer"] },
  { key: "internshipIndustry", label: "实习行业", type: "text", group: "internship", keywords: ["所在行业", "公司行业", "实习行业", "industry", "company industry", "internship industry"] },
  { key: "internshipLocation", label: "实习地点", type: "text", group: "internship", keywords: ["工作地点", "实习地点", "公司地址", "work location", "internship location", "company address"] },
  { key: "internshipTitle", label: "实习岗位", type: "text", group: "internship", keywords: ["实习岗位", "实习职位", "实习岗位名称", "职位名称", "岗位名称", "internship position", "internship role", "internship title"] },
  { key: "internshipStart", label: "实习开始时间", type: "date", group: "internship", keywords: ["实习开始时间", "实习起始时间", "实习开始日期", "internship start"] },
  { key: "internshipEnd", label: "实习结束时间", type: "date", group: "internship", keywords: ["实习结束时间", "实习终止时间", "实习结束日期", "internship end"] },
  { key: "internshipPeriod", label: "实习时间", type: "text", group: "internship", keywords: ["实习时间", "实习期间", "实习起止", "internship period", "internship duration"] },
  { key: "internshipDescription", label: "实习内容", type: "textarea", group: "internship", keywords: ["实习内容", "实习工作内容", "实习经历描述", "实习职责", "工作职责", "工作内容", "internship description", "internship duties", "internship summary"] },

  // —— 项目经历 ——
  { key: "projectName", label: "项目名称", type: "text", group: "project", keywords: ["项目名称", "项目名", "project name", "project title"] },
  { key: "projectRole", label: "项目角色", type: "text", group: "project", keywords: ["项目角色", "项目职务", "职务", "担任角色", "项目中的角色", "project role", "project duty"] },
  { key: "projectCompany", label: "项目公司", type: "text", group: "project", keywords: ["项目公司", "所属公司", "项目单位", "项目所在公司", "project company", "project organization"] },
  { key: "projectStart", label: "项目开始时间", type: "date", group: "project", keywords: ["项目开始时间", "项目起始时间", "project start"] },
  { key: "projectEnd", label: "项目结束时间", type: "date", group: "project", keywords: ["项目结束时间", "项目终止时间", "project end"] },
  { key: "projectPeriod", label: "项目时间", type: "text", group: "project", keywords: ["项目时间", "项目周期", "项目起止时间", "project period", "project duration"] },
  { key: "projectDescription", label: "项目内容", type: "textarea", group: "project", keywords: ["项目内容", "项目描述", "项目简介", "项目成果", "项目总结", "project description", "project content", "project summary", "project details"] },
  { key: "projectResponsibility", label: "项目职责", type: "textarea", group: "project", keywords: ["项目职责", "职责分工", "负责内容", "project responsibility", "project duties", "responsibilities"] },

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
  { key: "referralCode", label: "推荐码", type: "text", group: "profile", keywords: ["推荐码", "内推码", "推荐代码", "referral code", "referral id"] },

  // —— 其他 / 补充 ——
  { key: "awardDate", label: "获奖时间", type: "date", group: "other", keywords: ["获奖时间", "获奖日期", "奖项时间", "award date", "award time", "honor date"] },
  { key: "awardName", label: "奖项名称", type: "text", group: "other", keywords: ["奖项名称", "获奖名称", "荣誉名称", "award name", "award title", "honor name"] },
  { key: "languageType", label: "语言类型", type: "select", group: "other", keywords: ["语言类型", "语种", "语言种类", "language type", "language name", "language"] },
  { key: "languageScore", label: "语言证书/分数", type: "text", group: "other", keywords: ["相关证书等级/分数", "语言分数", "证书等级", "language score", "certificate score", "test score"] },
  { key: "languageProficiency", label: "语言精通程度", type: "select", group: "other", keywords: ["精通程度", "语言熟练度", "语言水平", "language proficiency", "proficiency level", "fluency"] },
  { key: "gameName", label: "游戏名称", type: "text", group: "other", keywords: ["游戏名称", "游戏名", "常玩游戏", "game name", "game title", "played game"] },
  { key: "gameLevel", label: "游玩程度", type: "text", group: "other", keywords: ["游玩程度", "游戏水平", "熟悉程度", "play level", "game proficiency", "familiarity"] },
  { key: "gameDuration", label: "游戏时长", type: "select", group: "other", keywords: ["游戏时长", "游玩时长", "游戏时间", "play duration", "game duration", "play time"] },
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

// 不同 DOM 证据的默认可信权重。扫描层可携带自定义 weight，匹配层仍会以此表兜底。
export const EVIDENCE_SOURCE_WEIGHTS = {
  autocomplete: 100,
  label: 90,
  wrap: 85,
  aria: 85,
  container: 75,
  name: 75,
  id: 70,
  inputmode: 60,
  placeholder: 55,
  group: 45,
  section: 35,
  neighbor: 30,
  title: 25,
  none: 0,
};

// 字段级硬约束。denyContext 用于阻止把候选人本人信息填入第三方联系人字段。
export const FIELD_CONSTRAINTS = {
  name: {
    format: "name",
    denyContext: ["紧急联系人", "联系人姓名", "监护人", "父亲", "母亲", "家长", "证明人", "emergency contact", "guardian", "father", "mother", "parent name", "contact person"],
    denyIdentifier: ["nickname", "lastname", "firstname", "gamename", "companyname", "schoolname", "projectname"],
  },
  school: { denyIdentifier: ["schooladdress", "schoollocation", "college", "faculty"] },
  workYears: { denyIdentifier: ["gameduration", "gametime", "playcontent", "playduration"] },
  phone: { format: "phone", denyContext: ["紧急联系人", "联系人电话", "监护人", "父亲", "母亲", "家长", "证明人", "emergency contact", "guardian", "father", "mother", "parent phone", "contact phone"] },
  email: { format: "email", denyContext: ["紧急联系人", "联系人邮箱", "监护人", "父亲", "母亲", "家长", "证明人", "emergency contact", "guardian", "father", "mother", "parent email", "contact email"] },
  birthDate: { format: "date" },
  internshipStart: { format: "date" },
  internshipEnd: { format: "date" },
  workStart: { format: "date" },
  workEnd: { format: "date" },
  projectStart: { format: "date" },
  projectEnd: { format: "date" },
  awardDate: { format: "date" },
  idCard: { format: "idCard" },
  postcode: { format: "postcode" },
  github: { format: "url" },
  linkedin: { format: "url" },
  portfolio: { format: "url" },
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
