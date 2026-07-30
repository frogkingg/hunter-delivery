// BOSS 薪资字体字符映射范围：kanzhun-mix 私有字体将 0-9 编码为 U+E031~U+E03A。
const SALARY_FONT_START = 0xE031;
const SALARY_FONT_END = 0xE03A;

const visible = el => el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
const text = el => (el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim();
const decodeSalary = value => String(value || "").replace(new RegExp(`[\\u${SALARY_FONT_START.toString(16)}-\\u${SALARY_FONT_END.toString(16)}]`, "g"), char => String(char.charCodeAt(0) - SALARY_FONT_START));
const firstText = selectors => {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (visible(el) && text(el)) return text(el);
  }
  return "";
};
const longestText = selectors => selectors
  .flatMap(s => [...document.querySelectorAll(s)].filter(visible).map(text))
  .filter(value => value.length > 20)
  .sort((a, b) => b.length - a.length)[0] || "";

function scopedText(scopeSelector, selectors) {
  const scope = document.querySelector(scopeSelector);
  if (!scope) return "";
  for (const selector of selectors) {
    const el = scope.querySelector(selector);
    if (visible(el) && text(el)) return text(el);
  }
  return "";
}

function extractJob() {
  const pageText = text(document.body);
  const isListPage = window.location.pathname.includes("/web/geek/jobs");
  // BOSS 目前有两套 DOM：职位详情页和 /web/geek/jobs 右侧浮层。这里分别精确读取，
  // 避免把整页导航/推荐岗位当成 JD。
  const detailScope = isListPage ? ".job-detail-container" : ".job-primary.detail-box";
  const title = isListPage
    ? scopedText(".job-detail-container", [".job-detail-header .job-name", ".job-name"])
    : scopedText(".job-primary.detail-box", ["h1", ".name h1"]);
  const company = isListPage
    ? (scopedText(".job-card-wrap.active", [".boss-name"]) || scopedText(".job-detail-container", [".boss-info-attr"]))
    : scopedText(".job-primary.detail-box", [".brand-name", ".company-name"]);
  const salary = isListPage
    ? scopedText(".job-detail-container", [".job-detail-header .job-salary", ".job-salary"])
    : scopedText(".job-primary.detail-box", [".salary"]);
  const jobLocation = isListPage
    ? (scopedText(".job-card-wrap.active", [".company-location"]) || scopedText(".job-detail-container", [".tag-list li a"]))
    : scopedText(".job-primary.detail-box", [".text-city", ".job-location"]);
  const description = isListPage
    ? longestText([".job-detail-container .job-detail-body .desc", ".job-detail-container .desc"])
    : longestText([".job-detail .job-sec-text", ".job-sec-text", ".job-description", ".detail-content"]);
  const fallbackTitle = firstText([".job-name", "h1", ".job-title"]);
  const detailUrl = isListPage
    ? document.querySelector(".job-detail-container a[href*='/job_detail/'][href*='securityId='], a[href*='/job_detail/'][href*='securityId=']")?.href || document.querySelector(".job-card-wrap.active a.job-name[href*='/job_detail/']")?.href || ""
    : window.location.href;
  const button = [...document.querySelectorAll("button, a")].find(el => visible(el) && /^(立即沟通|继续沟通)$/.test(text(el)));
  const jobId = (detailUrl.match(/job_detail\/([^./?]+)\.html/) || [])[1] || "";
  return {
    title: title || fallbackTitle || "未识别岗位名称", company, location: jobLocation,
    salary: decodeSalary(salary || pageText.match(/\b\d{1,3}(?:-\d{1,3})?K[·・]?\d{0,2}薪?\b/i)?.[0] || ""),
    description, url: window.location.href, detailUrl, jobId, pageType: isListPage ? "职位列表" : "岗位详情",
    communicationState: button ? text(button) : "未找到沟通按钮", extractedAt: new Date().toISOString()
  };
}

function diagnosePage() {
  const selectors = {
    detailTitle: ".job-primary.detail-box h1", detailCompany: ".job-primary.detail-box .brand-name",
    detailCity: ".job-primary.detail-box .text-city", detailJd: ".job-detail .job-sec-text",
    listTitle: ".job-detail-container .job-detail-header .job-name", listCompany: ".job-card-wrap.active .boss-name",
    listCity: ".job-card-wrap.active .company-location", listJd: ".job-detail-container .job-detail-body .desc",
    detailChat: ".btn-startchat", listChat: ".op-btn-chat"
  };
  const found = Object.fromEntries(Object.entries(selectors).map(([key, selector]) => {
    const elements = [...document.querySelectorAll(selector)];
    const first = elements.find(visible) || elements[0];
    return [key, { count: elements.length, sample: text(first).slice(0, 140) }];
  }));
  const job = extractJob();
  return {
    checkedAt: new Date().toISOString(), url: window.location.href, title: document.title,
    readyState: document.readyState, job, selectors: found,
    diagnosis: job.description.length > 40 ? "页面已读取到 JD" : "未读取到 JD；请复制这份诊断信息发给开发者"
  };
}

function findCommunicationButton() {
  return document.querySelector(".btn-startchat, .op-btn-chat") ||
    [...document.querySelectorAll("button, a")].find(el => visible(el) && /^(立即沟通|继续沟通)$/.test(text(el)));
}

function openCurrentJobDetail(target) {
  if (!window.location.pathname.includes("/web/geek/jobs")) return { navigated: false };
  const cards = [...document.querySelectorAll(".job-card-wrap")];
  const card = cards.find(item => {
    const title = text(item.querySelector("a.job-name"));
    const cardText = text(item);
    return title === target.title && (!target.company || cardText.includes(target.company));
  });
  const link = card?.querySelector("a.job-name[href*='/job_detail/']");
  if (!link?.href) throw new Error(`后台列表中未找到当前岗位：${target.title}`);
  window.location.href = link.href;
  return { navigated: true };
}

function verifyJob(expected) {
  const actual = extractJob();
  const normal = value => String(value || "").replace(/\s+/g, "").toLowerCase();
  const titleOk = !expected.title || normal(actual.title) === normal(expected.title);
  const companyOk = !expected.company || normal(actual.company).includes(normal(expected.company)) || normal(expected.company).includes(normal(actual.company));
  return { ok: titleOk && companyOk, actual, reason: titleOk ? "公司不一致" : "岗位名称不一致" };
}

async function waitForElement(selector, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const element = document.querySelector(selector);
    if (element) return element;
    await delay(300);
  }
  throw new Error(`等待 ${label} 超时，请确认已进入 BOSS 沟通页。`);
}

function visibleNow(element) { return !!(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length)); }

// BOSS 从详情页跳到聊天页后，偶尔会弹出“沟通新职位”或“已向 BOSS 发送消息”。
// 这些弹层会挡住工具栏，让图片 input 看似不存在。这里沿用社区最佳实践：
// 只点明确的“沟通新职位”，以及已发送提示中的“留在此页”，绝不误点“继续沟通”。
async function prepareChatForSending() {
  for (let round = 0; round < 3; round++) {
    for (const box of document.querySelectorAll(".greet-boss-container")) {
      if (visibleNow(box)) box.querySelector("a.cancel-btn")?.click();
    }
    for (const dialog of document.querySelectorAll(".change-job-tip-dialog")) {
      if (!visibleNow(dialog)) continue;
      const confirm = [...dialog.querySelectorAll(".boss-dialog__button:not(.button-outline)")].find(button => text(button) === "沟通新职位");
      confirm?.click();
    }
    const input = document.querySelector("div#chat-input.chat-input");
    if (input?.getAttribute("contenteditable") === "true") return input;
    await delay(450);
  }
  return waitForElement("div#chat-input.chat-input", 9000, "聊天输入框");
}

function findImageUploader() {
  const exact = document.querySelector(".btn-sendimg input[type='file']");
  if (exact) return exact;
  const candidates = [...document.querySelectorAll("input[type='file']")];
  return candidates.find(input => /image|png|jpeg|jpg/i.test(input.accept || "") || input.closest(".btn-sendimg")) || null;
}

async function waitForImageUploader(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const input = findImageUploader();
    if (input) return input;
    await delay(400);
  }
  throw new Error("等待图片上传入口超时（10 秒）；BOSS 聊天工具栏尚未出现");
}

async function setComposer(value) {
  // BOSS 聊天页使用 contenteditable div，并非普通 textarea/input。
  // 必须锁定参考插件实测的 #chat-input，避免误写左侧「搜索联系人」输入框。
  const input = await waitForElement("div#chat-input.chat-input", 8000, "聊天输入框");
  input.focus();
  // 先清空再写入。这里不能借用 textarea/input 的原生 setter：
  // BOSS 的输入框是 contenteditable div，错误调用 setter 会触发
  // “Illegal invocation”。
  input.textContent = "";
  input.textContent = value;
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  if (!input.textContent.trim()) throw new Error("招呼语未能写入 BOSS 聊天输入框。");
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForEnabledSendButton() {
  const deadline = Date.now() + 1800;
  while (Date.now() < deadline) {
    const button = document.querySelector("button.btn-send");
    if (button && !button.disabled && !button.classList.contains("disabled")) return button;
    await delay(80);
  }
  throw new Error("招呼语已写入，但 BOSS 的发送按钮没有激活。请点击输入框后手动发送。");
}

function outgoingMessages() {
  return [...document.querySelectorAll(".chat-record .item-myself, .chat-record .message-self")];
}

const normalize = value => String(value || "").replace(/\s+/g, "");
const isDelivered = statusEl => /status-delivery|status-read/.test(statusEl?.className || "") || /送达|已读/.test(text(statusEl));
const isFailed = statusEl => /status-error/.test(statusEl?.className || "") || /失败|error/i.test(text(statusEl));

// 不能只看“出现了一个我方消息”：BOSS 失败消息也会先显示气泡。必须在新增气泡中，
// 找到含本次招呼语内容指纹的那一条，再看它是否为 status-delivery / status-read。
async function waitForOutgoingMessage(beforeCount, greeting, timeoutMs = 9000) {
  const deadline = Date.now() + timeoutMs;
  const fingerprint = normalize(greeting).slice(0, 16);
  while (Date.now() < deadline) {
    const messages = outgoingMessages();
    for (const message of messages.slice(beforeCount)) {
      if (fingerprint && !normalize(text(message)).includes(fingerprint)) continue;
      const statusEl = message.querySelector(".message-status");
      if (isFailed(statusEl)) throw new Error(`BOSS 显示招呼语发送失败：${text(statusEl) || "状态异常"}`);
      if (isDelivered(statusEl)) return { status: text(statusEl) || "已送达" };
    }
    await delay(180);
  }
  throw new Error("招呼语发送状态确认超时：为避免重复发送，已停止本岗位，不会写入岗位库。");
}

function hasDeliveredImageSince(beforeCount) {
  return outgoingMessages().slice(beforeCount).some(message => {
    const statusEl = message.querySelector(".message-status");
    const image = [...message.querySelectorAll("img")].find(img => /^https:\/\/.+zhipin\.com\//.test(img.src || ""));
    return !!image && isDelivered(statusEl);
  });
}

async function waitForResumeDelivered(beforeCount, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const messages = outgoingMessages().slice(beforeCount);
    for (const message of messages) {
      const statusEl = message.querySelector(".message-status");
      if (isFailed(statusEl)) throw new Error(`BOSS 显示简历图片发送失败：${text(statusEl) || "状态异常"}`);
      const image = [...message.querySelectorAll("img")].find(img => /^https:\/\/.+zhipin\.com\//.test(img.src || ""));
      if (image && isDelivered(statusEl)) return { status: "已送达", src: image.src };
    }
    await delay(220);
  }
  throw new Error("简历图片上传或送达确认超时；已停止发送招呼语，避免出现只发文字未发简历的情况。");
}

async function sendGreetingAndConfirm(greeting) {
  const beforeCount = outgoingMessages().length;
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1 && await waitForDeliveredText(beforeCount, greeting)) return { status: "已送达" };
    await setComposer(greeting);
    const input = await waitForElement("div#chat-input.chat-input", 2000, "聊天输入框");
    const button = await waitForEnabledSendButton();
    button.click();
    await delay(700);
    if (input.textContent.trim()) {
      ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(type => button.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })));
      await delay(500);
    }
    if (input.textContent.trim()) throw new Error("招呼语已填入，但 BOSS 未确认发送；请手动点击右下角“发送”。");
    try { return await waitForOutgoingMessage(beforeCount, greeting); }
    catch (error) {
      // 明确的 status-error 才重试一次；超时是“不确定态”，绝不能自动重发造成双发。
      if (attempt === 1 && /BOSS 显示招呼语发送失败/.test(error.message || "")) { await delay(900); continue; }
      throw error;
    }
  }
}

async function waitForDeliveredText(beforeCount, greeting) {
  const fingerprint = normalize(greeting).slice(0, 16);
  return outgoingMessages().slice(beforeCount).some(message => fingerprint && normalize(text(message)).includes(fingerprint) && isDelivered(message.querySelector(".message-status")));
}

async function sendOneResume(image) {
  // 聊天页 URL 完成加载后，图片入口仍可能延迟挂载，且 BOSS 版本会变更外围 class。
  const input = await waitForImageUploader(10000);
  const blob = await (await fetch(image.dataUrl)).blob();
  const file = new File([blob], image.name || "resume.png", { type: image.type || blob.type });
  const beforeCount = outgoingMessages().length;
  const filesSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "files")?.set;
  if (!filesSetter) throw new Error("当前浏览器不支持自动填入图片");
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1 && hasDeliveredImageSince(beforeCount)) return { status: "已送达" };
    const transfer = new DataTransfer(); transfer.items.add(file);
    filesSetter.call(input, transfer.files);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    try { return await waitForResumeDelivered(beforeCount); }
    catch (error) {
      if (attempt === 1 && /BOSS 显示简历图片发送失败/.test(error.message || "")) { await delay(900); continue; }
      throw error;
    }
  }
}

async function sendResume(images) {
  if (!images?.length) return { sent: false, reason: "未上传简历图片" };
  for (let index = 0; index < images.length; index++) await sendOneResume(images[index]);
  return { sent: true, count: images.length, note: "简历图片已由 BOSS 确认送达" };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  try {
    if (message.type === "EXTRACT_JOB") sendResponse({ ok: true, job: extractJob() });
    if (message.type === "DIAGNOSE_PAGE") sendResponse({ ok: true, data: diagnosePage() });
    if (message.type === "OPEN_COMMUNICATION") {
      const button = findCommunicationButton();
      if (!button) throw new Error("未找到“立即沟通”或“继续沟通”按钮。");
      const state = text(button); button.click(); sendResponse({ ok: true, state });
    }
    if (message.type === "OPEN_CURRENT_JOB_DETAIL") {
      sendResponse({ ok: true, ...openCurrentJobDetail(message.job || {}) });
    }
    if (message.type === "VERIFY_JOB") sendResponse(verifyJob(message.job || {}));
    if (message.type === "SELF_CHECK") {
      const CRITICAL_SELECTORS = [
        { selector: "div#chat-input.chat-input", name: "聊天输入框" },
        { selector: "button.btn-send", name: "发送按钮" },
        { selector: ".btn-sendimg input[type='file']", name: "图片上传入口" },
      ];
      const missing = CRITICAL_SELECTORS
        .filter(item => !document.querySelector(item.selector))
        .map(item => item.name);
      sendResponse({ ok: true, missing });
    }

    if (message.type === "SEND_MESSAGE") {
      (async () => {
        try {
          await prepareChatForSending();
          // 先逐张确认简历图片已送达，再发送文字；若图片失败，避免出现“只发了招呼语、没发简历”的半成品投递。
          const resume = await sendResume(message.images);
          await delay(500);
          await sendGreetingAndConfirm(message.greeting);
          sendResponse({ ok: true, messageSent: true, resume });
        } catch (error) {
          sendResponse({ ok: false, error: error.message });
        }
      })();
      return true;
    }
  } catch (error) { sendResponse({ ok: false, error: error.message }); }
});
