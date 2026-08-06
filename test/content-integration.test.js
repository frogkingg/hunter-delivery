import { test } from "node:test";
import assert from "node:assert/strict";

const listeners = [];
let outgoing = [];
let composer;
let greetBoxes = [];
let securityDialogs = [];
let detailCompanyLinks = [];
let sendButtons = [];

const visibleElement = (values = {}) => ({
  innerText: "",
  textContent: "",
  children: [],
  classList: { contains: () => false },
  offsetWidth: 1,
  offsetHeight: 1,
  getClientRects: () => [1],
  ...values,
});

const titleElement = visibleElement({ innerText: "AI 产品经理", textContent: "AI 产品经理" });
const detailScope = {
  querySelector: selector => ["h1", ".name h1"].includes(selector) ? titleElement : null,
};
const chatInput = visibleElement({
  textContent: "",
  getAttribute: name => name === "contenteditable" ? "true" : null,
  focus: () => {},
  dispatchEvent: () => {},
});
composer = chatInput;

// —— 批量扫描/选中测试的列表页模拟状态 ——
let listCards = [];
let activeCard = null;
let listDetailContainer = null;

globalThis.window = {
  location: {
    pathname: "/job_detail/job-1.html",
    href: "https://www.zhipin.com/job_detail/job-1.html",
  },
};
globalThis.document = {
  title: "AI 产品经理",
  readyState: "complete",
  activeElement: null,
  hasFocus: () => false,
  body: visibleElement(),
  querySelector: selector => {
    if (selector === ".job-primary.detail-box") return detailScope;
    if (selector === "div#chat-input.chat-input") return chatInput;
    if (selector === "button.btn-send") return sendButtons[0] || null;
    if (selector === ".job-detail-container") return listDetailContainer;
    if (selector === ".job-card-wrap.active") return activeCard;
    if (selector === ".job-card-wrap.active a.job-name[href*='/job_detail/']") return activeCard?.querySelector("a.job-name[href*='/job_detail/']") || null;
    return null;
  },
  querySelectorAll: selector => {
    if (selector === ".chat-record .item-myself, .chat-record .message-self") return outgoing;
    if (selector === ".company-info a[href*='/gongsi/']") return detailCompanyLinks;
    if (selector === "button.btn-send, .btn-send") return sendButtons;
    if (selector === ".job-card-wrap, .job-card-box, li.job-card-wrapper") return listCards;
    if (selector === ".job-detail-container .job-detail-body .desc" || selector === ".job-detail-container .desc") {
      return listDetailContainer ? [listDetailContainer._desc] : [];
    }
    if ([
      "div#chat-input.chat-input",
      ".message-controls .chat-input",
      ".greet-boss-container .chat-input",
      ".chat-input[contenteditable='true']",
    ].includes(selector)) return composer ? [composer] : [];
    if (selector === ".greet-boss-container") return greetBoxes;
    if (selector === ".greet-boss-container, .dialog-container, [role='dialog'], .boss-dialog") return greetBoxes;
    if (selector === "[role='dialog'], .boss-dialog, .dialog-container, [class*='captcha'], [class*='verify']") return securityDialogs;
    return [];
  },
};
globalThis.InputEvent = class InputEvent {
  constructor(type, init) { this.type = type; Object.assign(this, init); }
};
globalThis.MouseEvent = class MouseEvent {
  constructor(type, init) { this.type = type; Object.assign(this, init); }
};
globalThis.chrome = {
  runtime: {
    onMessage: {
      addListener(listener) {
        listeners.push(listener);
      },
    },
  },
};

await import(`../content.js?integration=${Date.now()}`);
const listener = listeners[0];

function dispatch(message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Message timed out: ${message.type}`)), 3000);
    listener(message, {}, response => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

function dispatchNoTimeout(message) {
  return new Promise(resolve => {
    listener(message, {}, resolve);
  });
}

function dispatchSlow(message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Message timed out: ${message.type}`)), 6000);
    listener(message, {}, response => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}

test("VERIFY_JOB 在预期公司非空但页面未读取公司时失败", async () => {
  const response = await dispatch({
    type: "VERIFY_JOB",
    job: { title: "AI 产品经理", company: "目标公司" },
  });

  assert.equal(response.ok, false);
  assert.match(response.reason, /公司不一致或未读取到公司/);
});

test("EXTRACT_JOB 从详情页公司链接读取公司名称", async () => {
  detailCompanyLinks = [
    visibleElement(),
    visibleElement({ innerText: "中燃科技", textContent: "中燃科技" }),
  ];

  const response = await dispatch({ type: "EXTRACT_JOB" });

  assert.equal(response.ok, true);
  assert.equal(response.job.company, "中燃科技");
  detailCompanyLinks = [];
});

test("VERIFY_JOB 在 jobId 与标题一致时允许公司字段缺失", async () => {
  const response = await dispatch({
    type: "VERIFY_JOB",
    job: { jobId: "job-1", title: "AI 产品经理", company: "目标公司" },
  });

  assert.equal(response.ok, true);
  assert.equal(response.confidence, "high");
  assert.equal(response.checks.jobIdOk, true);
  assert.equal(response.checks.titleOk, true);
  assert.equal(response.checks.companyOk, false);
  assert.match(response.reason, /已按岗位 ID 确认/);
});

test("VERIFY_JOB 始终阻断 jobId 不一致", async () => {
  detailCompanyLinks = [visibleElement({ innerText: "目标公司", textContent: "目标公司" })];
  const response = await dispatch({
    type: "VERIFY_JOB",
    job: { jobId: "other-job", title: "AI 产品经理", company: "目标公司" },
  });

  assert.equal(response.ok, false);
  assert.equal(response.checks.jobIdOk, false);
  assert.match(response.reason, /岗位唯一标识不一致/);
  detailCompanyLinks = [];
});

test("PREPARE_COMMUNICATION 点击正常弹层中的继续沟通", async () => {
  composer = null;
  securityDialogs = [];
  let clicked = false;
  const continueButton = visibleElement({
    innerText: "继续沟通",
    textContent: "继续沟通",
    click: () => { clicked = true; },
  });
  greetBoxes = [visibleElement({
    className: "greet-boss-container",
    classList: { contains: name => name === "greet-boss-container" },
    querySelectorAll: selector => selector.includes("button") ? [continueButton] : [],
  })];

  const response = await dispatch({ type: "PREPARE_COMMUNICATION" });

  assert.equal(response.ok, true);
  assert.equal(response.ready, false);
  assert.equal(response.action, "继续沟通");
  assert.equal(clicked, true);
  greetBoxes = [];
  composer = chatInput;
});

test("PREPARE_COMMUNICATION 支持 dialog-container 内非 button/a 的继续沟通控件", async () => {
  composer = null;
  securityDialogs = [];
  let clicked = false;
  const labelNode = visibleElement({
    innerText: "继续沟通",
    textContent: "继续沟通",
  });
  const action = visibleElement({
    className: "boss-dialog__button",
    innerText: "继续沟通",
    textContent: "继续沟通",
    children: [labelNode],
    click: () => { clicked = true; },
  });
  labelNode.closest = () => action;
  const dialog = visibleElement({
    className: "dialog-container",
    innerText: "已向BOSS发送消息 留在此页 继续沟通",
    textContent: "已向BOSS发送消息 留在此页 继续沟通",
    contains: element => element === action || element === labelNode,
    querySelectorAll: selector => {
      if (selector === "button, a") return [];
      if (selector.includes(".boss-dialog__button")) return [action];
      if (selector === "*") return [action, labelNode];
      return [];
    },
  });
  greetBoxes = [dialog];

  const response = await dispatch({ type: "PREPARE_COMMUNICATION" });

  assert.equal(response.ok, true);
  assert.equal(response.action, "继续沟通");
  assert.equal(clicked, true);
  greetBoxes = [];
  composer = chatInput;
});

test("PREPARE_COMMUNICATION 接受原岗位页内嵌聊天输入框", async () => {
  composer = chatInput;
  const response = await dispatch({ type: "PREPARE_COMMUNICATION" });

  assert.equal(response.ok, true);
  assert.equal(response.ready, true);
  assert.equal(response.mode, "inline-chat");
});

test("PREPARE_COMMUNICATION 遇到安全验证时停止自动处理", async () => {
  composer = null;
  securityDialogs = [visibleElement({
    innerText: "访问异常，请完成滑动验证",
    textContent: "访问异常，请完成滑动验证",
  })];

  const response = await dispatch({ type: "PREPARE_COMMUNICATION" });

  assert.equal(response.ok, true);
  assert.equal(response.blocked, true);
  assert.match(response.reason, /手动完成/);
  securityDialogs = [];
  composer = chatInput;
});

test("SEND_MESSAGE 检测到相同招呼语已送达时不重复发送图片", async () => {
  const greeting = "您好，我对这个岗位很感兴趣。";
  const status = visibleElement({ className: "message-status status-delivery", innerText: "已送达" });
  outgoing = [visibleElement({
    innerText: greeting,
    textContent: greeting,
    querySelector: selector => selector === ".message-status" ? status : null,
    querySelectorAll: () => [],
  })];

  const response = await dispatch({
    type: "SEND_MESSAGE",
    greeting,
    images: [{ name: "resume.png", dataUrl: "data:image/png;base64,AA==" }],
  });

  assert.equal(response.ok, true);
  assert.equal(response.delivery.alreadySent, true);
  assert.equal(response.resume.sent, false);
  assert.match(response.resume.reason, /未重复发送简历图片/);
});

test("SEND_MESSAGE 忽略隐藏禁用按钮并使用可见启用按钮", async () => {
  const greeting = "您好，我对该岗位很感兴趣，希望进一步沟通。";
  outgoing = [];
  let observerCallback = null;
  globalThis.MutationObserver = class MutationObserver {
    constructor(callback) { observerCallback = callback; }
    observe() {}
    disconnect() {}
  };
  const status = visibleElement({
    className: "message-status status-delivery",
    innerText: "已送达",
    textContent: "已送达",
  });
  const hiddenDisabled = visibleElement({
    offsetWidth: 0,
    offsetHeight: 0,
    getClientRects: () => [],
    className: "btn-send disabled",
    classList: { contains: name => name === "disabled" },
    disabled: false,
  });
  let enabledDisabled = true;
  const enabled = visibleElement({
    tagName: "BUTTON",
    className: "btn-send disabled",
    classList: { contains: name => name === "disabled" && enabledDisabled },
    disabled: false,
    click: () => {
      testComposer.textContent = "";
      outgoing.push(visibleElement({
        innerText: greeting,
        textContent: greeting,
        querySelector: selector => selector === ".message-status" ? status : null,
        querySelectorAll: () => [],
      }));
    },
    dispatchEvent: () => {},
  });
  const scope = {
    querySelector: () => hiddenDisabled,
    querySelectorAll: () => [hiddenDisabled, enabled],
  };
  const testComposer = visibleElement({
    tagName: "DIV",
    className: "chat-input",
    dataset: {},
    textContent: "",
    getAttribute: name => name === "contenteditable" ? "true" : null,
    focus: () => { document.activeElement = testComposer; },
    dispatchEvent: () => {},
    closest: () => scope,
  });
  composer = testComposer;
  sendButtons = [hiddenDisabled, enabled];
  setTimeout(() => {
    enabledDisabled = false;
    enabled.className = "btn-send";
    observerCallback?.();
  }, 20);

  const response = await dispatch({ type: "SEND_MESSAGE", greeting, images: [] });

  assert.equal(response.ok, true);
  assert.equal(response.messageSent, true);
  assert.equal(response.delivery.status, "已送达");
  composer = chatInput;
  sendButtons = [];
  outgoing = [];
  delete globalThis.MutationObserver;
});


test("SEND_MESSAGE 送达确认超时返回 uncertain 标志", async () => {
  composer = chatInput;
  chatInput.textContent = "";
  outgoing = [];
  let sent = false;
  sendButtons = [visibleElement({
    disabled: false,
    classList: { contains: () => false },
    click: () => { sent = true; chatInput.textContent = ""; },
  })];
  try {
    const response = await dispatchNoTimeout({
      type: "SEND_MESSAGE",
      greeting: "您好，我对这个岗位很感兴趣，期待进一步沟通。",
      images: [],
    });
    assert.equal(sent, true);
    assert.equal(response.ok, false);
    assert.equal(response.uncertain, true);
    assert.match(response.error, /确认超时/);
  } finally {
    sendButtons = [];
    outgoing = [];
  }
});

test("SEND_MESSAGE 重试时跳过已确认失败的旧气泡", async () => {
  composer = chatInput;
  chatInput.textContent = "";
  outgoing = [];
  const greeting = "您好，我对这个岗位很感兴趣，期待进一步沟通。";
  const statusEl = className => visibleElement({ className, textContent: className.includes("error") ? "发送失败" : "已读" });
  const failedMsg = () => visibleElement({
    textContent: `${greeting}（发送失败）`,
    querySelector: selector => selector === ".message-status" ? statusEl("status-error") : null,
  });
  const deliveredMsg = () => visibleElement({
    textContent: greeting,
    querySelector: selector => selector === ".message-status" ? statusEl("status-read") : null,
  });
  // 真实 DOM 中，第一次失败的气泡节点会一直保留到会话刷新；这里复用同一节点模拟。
  const failedNode = failedMsg();
  let clicks = 0;
  sendButtons = [visibleElement({
    disabled: false,
    classList: { contains: () => false },
    click: () => {
      clicks++;
      outgoing = clicks === 1 ? [failedNode] : [failedNode, deliveredMsg()];
      chatInput.textContent = "";
    },
  })];
  try {
    const response = await dispatchNoTimeout({
      type: "SEND_MESSAGE",
      greeting,
      images: [],
    });
    assert.equal(clicks, 2);
    assert.equal(response.ok, true);
    assert.equal(response.delivery.status, "已读");
  } finally {
    sendButtons = [];
    outgoing = [];
  }
});

// —— 批量扫描与选中（列表页） ——
const makeBatchCard = (title, company, jobId, onClick) => {
  const link = visibleElement({ href: `https://www.zhipin.com/job_detail/${jobId}.html` });
  return visibleElement({
    querySelector: selector => {
      if (selector.includes("a.job-name[href*='/job_detail/']") || selector.includes("a[href*='/job_detail/']")) return link;
      if (selector.includes(".job-name")) return visibleElement({ innerText: title, textContent: title, click: onClick });
      if (selector.includes(".boss-name") || selector.includes(".company-name")) return visibleElement({ innerText: company, textContent: company });
      return null;
    },
    click: onClick,
  });
};

const makeListDetail = (title, company, jobId) => {
  const desc = visibleElement({ innerText: `岗位职责：负责${title}相关工作，需要${company}业务背景与${jobId}项目经验。${"详细 JD 内容".repeat(12)}` });
  return {
    _desc: desc,
    querySelector: selector => {
      if (selector === ".job-detail-header .job-name" || selector === ".job-name") return visibleElement({ innerText: title, textContent: title });
      if (selector === ".boss-info-attr") return visibleElement({ innerText: company, textContent: company });
      if (selector === ".job-detail-header .job-salary" || selector === ".job-salary") return visibleElement({ innerText: "20-30K", textContent: "20-30K" });
      if (selector === ".company-location" || selector === ".tag-list li a") return visibleElement({ innerText: "上海", textContent: "上海" });
      return null;
    },
  };
};

test("SCAN_LIST_JOBS 逐卡片读取独立 title/company/jobId", async () => {
  globalThis.window.location = { pathname: "/web/geek/jobs", href: "https://www.zhipin.com/web/geek/jobs" };
  listCards = [
    makeBatchCard("前端工程师", "甲公司", "job-a", () => {}),
    makeBatchCard("后端工程师", "乙公司", "job-b", () => {}),
  ];
  try {
    const response = await dispatch({ type: "SCAN_LIST_JOBS" });
    assert.equal(response.ok, true);
    assert.equal(response.jobs.length, 2);
    assert.equal(response.jobs[0].title, "前端工程师");
    assert.equal(response.jobs[0].company, "甲公司");
    assert.equal(response.jobs[0].jobId, "job-a");
    assert.equal(response.jobs[1].title, "后端工程师");
    assert.equal(response.jobs[1].company, "乙公司");
    assert.equal(response.jobs[1].jobId, "job-b");
  } finally {
    listCards = [];
  }
});

test("SELECT_LIST_JOB 点击后等待详情加载到匹配岗位才返回", async () => {
  globalThis.window.location = { pathname: "/web/geek/jobs", href: "https://www.zhipin.com/web/geek/jobs" };
  listDetailContainer = null;
  activeCard = null;
  const card = makeBatchCard("AI 产品经理", "目标公司", "job-pm", () => {
    setTimeout(() => {
      listDetailContainer = makeListDetail("AI 产品经理", "目标公司", "job-pm");
      activeCard = card;
    }, 120);
  });
  listCards = [card];
  try {
    const response = await dispatch({ type: "SELECT_LIST_JOB", index: 0 });
    assert.equal(response.ok, true);
    assert.equal(response.job.title, "AI 产品经理");
    assert.equal(response.job.company, "目标公司");
    assert.equal(response.job.jobId, "job-pm");
  } finally {
    listCards = [];
    listDetailContainer = null;
    activeCard = null;
  }
});

test("SELECT_LIST_JOB 详情加载超时返回失败原因", async () => {
  globalThis.window.location = { pathname: "/web/geek/jobs", href: "https://www.zhipin.com/web/geek/jobs" };
  listDetailContainer = null;
  activeCard = null;
  listCards = [makeBatchCard("永不加载岗位", "某公司", "job-void", () => {})];
  try {
    const response = await dispatchSlow({ type: "SELECT_LIST_JOB", index: 0 });
    assert.equal(response.ok, false);
    assert.match(response.reason, /等待岗位详情加载超时/);
  } finally {
    listCards = [];
    listDetailContainer = null;
    activeCard = null;
  }
});

test("SELECT_LIST_JOB 索引越界返回失败", async () => {
  globalThis.window.location = { pathname: "/web/geek/jobs", href: "https://www.zhipin.com/web/geek/jobs" };
  listCards = [makeBatchCard("唯一岗位", "公司", "job-1", () => {})];
  try {
    const response = await dispatch({ type: "SELECT_LIST_JOB", index: 5 });
    assert.equal(response.ok, false);
  } finally {
    listCards = [];
  }
});