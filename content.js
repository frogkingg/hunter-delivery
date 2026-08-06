// BOSS 薪资字体字符映射范围：kanzhun-mix 私有字体将 0-9 编码为 U+E031~U+E03A。
const SALARY_FONT_START = 0xE031;
const SALARY_FONT_END = 0xE03A;

const visible = el => el && !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
// 解码 BOSS 私有字体 PUA：已知数字码位映射 0-9，未知私用区字符移除，避免状态文字乱码。
const decodePuaText = value => String(value ?? "").replace(/[\uE000-\uF8FF]/g, char => {
  const code = char.charCodeAt(0);
  return code >= SALARY_FONT_START && code <= SALARY_FONT_END ? String(code - SALARY_FONT_START) : "";
});
const text = el => decodePuaText((el?.innerText || el?.textContent || "").replace(/\s+/g, " ").trim());
const decodeSalary = value => String(value || "").replace(new RegExp(`[\\u${SALARY_FONT_START.toString(16)}-\\u${SALARY_FONT_END.toString(16)}]`, "g"), char => String(char.charCodeAt(0) - SALARY_FONT_START));
const firstText = selectors => {
  for (const selector of selectors) {
    const el = [...document.querySelectorAll(selector)].find(element => visible(element) && text(element));
    if (el) return text(el);
  }
  return "";
};
const cleanCompanyName = value => String(value || "").replace(/^公司名称\s*/i, "").trim();
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
    : cleanCompanyName(
        scopedText(".job-primary.detail-box", [".brand-name", ".company-name"]) ||
        firstText([
          ".company-info a[href*='/gongsi/']",
          ".sider-company a[href*='/gongsi/']",
          ".job-detail-company a[href*='/gongsi/']",
          ".sider-company .company-name",
          ".job-detail-company .company-name",
          ".company-name",
        ])
      );
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
  const bodyText = document.body?.innerText || "";
  const puaMatches = bodyText.match(/[\uE000-\uF8FF]/g) || [];
  return {
    checkedAt: new Date().toISOString(), url: window.location.href, title: document.title,
    readyState: document.readyState, job, selectors: found,
    puaCount: puaMatches.length,
    puaSample: [...new Set(puaMatches)].slice(0, 5).join(""),
    diagnosis: job.description.length > 40 ? "页面已读取到 JD" : "未读取到 JD；请复制这份诊断信息发给开发者"
  };
}

function findCommunicationButton() {
  return document.querySelector(".btn-startchat, .op-btn-chat") ||
    [...document.querySelectorAll("button, a")].find(el => visible(el) && /^(立即沟通|继续沟通)$/.test(text(el)));
}

function verifyJob(expected) {
  const actual = extractJob();
  const normal = value => String(value || "").replace(/\s+/g, "").toLowerCase();
  const jobIdFrom = job => {
    if (job?.jobId) return String(job.jobId).trim();
    const source = String(job?.detailUrl || job?.key || job?.url || "");
    return (source.match(/\/job_detail\/([^./?]+)(?:\.html)?/) || [])[1] || "";
  };
  const expectedJobId = jobIdFrom(expected);
  const actualJobId = jobIdFrom(actual);
  const jobIdOk = !expectedJobId || !!actualJobId && actualJobId === expectedJobId;
  const titleOk = !expected.title || normal(actual.title) === normal(expected.title);
  const actualCompany = normal(actual.company);
  const expectedCompany = normal(expected.company);
  const companyOk = !expectedCompany || !!actualCompany && (actualCompany.includes(expectedCompany) || expectedCompany.includes(actualCompany));
  let ok = false;
  let reason = "";
  if (!jobIdOk) {
    reason = actualJobId ? "岗位唯一标识不一致" : "未读取到岗位唯一标识";
  } else if (!titleOk) {
    reason = "岗位名称不一致";
  } else if (expectedJobId) {
    ok = true;
    if (!companyOk) reason = actualCompany
      ? "岗位 ID 与名称一致；公司展示名称不同，已按岗位 ID 确认"
      : "岗位 ID 与名称一致；公司未读取到，已按岗位 ID 确认";
  } else if (companyOk) {
    ok = true;
  } else {
    reason = "公司不一致或未读取到公司";
  }
  return {
    ok,
    actual,
    reason,
    confidence: expectedJobId ? "high" : "medium",
    checks: { jobIdOk, titleOk, companyOk, expectedJobId, actualJobId },
  };
}

function visibleNow(element) { return !!(element && (element.offsetWidth || element.offsetHeight || element.getClientRects().length)); }

const CHAT_COMPOSER_SELECTORS = [
  "div#chat-input.chat-input",
  ".message-controls .chat-input",
  ".greet-boss-container .chat-input",
  ".chat-input[contenteditable='true']",
  ".dialog-container .chat-input",
  ".chat-dialog .chat-input",
  ".chat-input",
];
const CHAT_DIALOG_SELECTOR = ".greet-boss-container, .dialog-container, [role='dialog'], .boss-dialog";
const CHAT_INPUT_FALLBACK_SELECTOR = ".chat-input, [contenteditable='true'], textarea, .ql-editor";
const handledCommunicationActions = new WeakSet();

function findChatComposer() {
  for (const selector of CHAT_COMPOSER_SELECTORS) {
    const input = [...document.querySelectorAll(selector)].find(visibleNow);
    if (input) return input;
  }
  // 兜底：在可见通信弹层（greet/dialog）内查找可输入控件，适配 BOSS 弹层 DOM 变化。
  for (const box of document.querySelectorAll(CHAT_DIALOG_SELECTOR)) {
    if (!visibleNow(box)) continue;
    const input = [...box.querySelectorAll(CHAT_INPUT_FALLBACK_SELECTOR)].find(el => visibleNow(el) && !el.disabled);
    if (input) return input;
  }
  return null;
}

function findSecurityInterruption() {
  const candidates = document.querySelectorAll(
    "[role='dialog'], .boss-dialog, .dialog-container, [class*='captcha'], [class*='verify']"
  );
  return [...candidates].find(element =>
    visibleNow(element) &&
    /安全验证|滑动验证|拖动滑块|访问异常|账号异常|操作频繁|请完成验证|验证码|行为验证|人机验证|请先完成/.test(text(element))
  );
}

function clickCommunicationAction(container, labels) {
  const clickableSelector = "button, a, [role='button'], .boss-dialog__button, .btn, [class*='btn']";
  let action = [...container.querySelectorAll(clickableSelector)].find(element =>
    visibleNow(element) && labels.includes(text(element))
  );
  if (!action) {
    const labelNode = [...container.querySelectorAll("*")].find(element =>
      visibleNow(element) &&
      labels.includes(text(element)) &&
      ![...element.children].some(child => visibleNow(child) && labels.includes(text(child)))
    );
    const clickableAncestor = labelNode?.closest?.(clickableSelector);
    action = clickableAncestor && container.contains(clickableAncestor) ? clickableAncestor : labelNode;
  }
  if (!action) return "";
  if (handledCommunicationActions.has(action)) return "";
  const label = text(action);
  handledCommunicationActions.add(action);
  action.click();
  return label;
}

function advanceCommunicationFlow({ probe = false } = {}) {
  const securityInterruption = findSecurityInterruption();
  if (securityInterruption) {
    return {
      ready: false,
      blocked: true,
      reason: "检测到 BOSS 安全验证或操作限制，请在页面中手动完成后再重试。",
      ...(probe ? { securityText: text(securityInterruption).slice(0, 120) } : {}),
    };
  }

  const input = findChatComposer();
  if (input) return { ready: true, blocked: false, mode: window.location.pathname.includes("/web/geek/chat") ? "chat-page" : "inline-chat" };

  for (const box of document.querySelectorAll(CHAT_DIALOG_SELECTOR)) {
    if (!visibleNow(box)) continue;
    // 通信弹层可能是 greet-boss、已发送历史对话或旧版「已向BOSS发送消息」弹层，均不应跳过。
    if (!box.classList?.contains("greet-boss-container") && !/已向BOSS发送消息|已发送|继续沟通|打招呼/.test(text(box))) continue;
    const action = clickCommunicationAction(box, ["继续沟通"]);
    if (action) return { ready: false, blocked: false, action };
  }

  for (const dialog of document.querySelectorAll(".change-job-tip-dialog")) {
    if (!visibleNow(dialog)) continue;
    const action = clickCommunicationAction(dialog, ["沟通新职位"]);
    if (action) return { ready: false, blocked: false, action };
  }

  if (probe) {
    const dialogs = [...document.querySelectorAll(`${CHAT_DIALOG_SELECTOR}, .change-job-tip-dialog`)]
      .filter(visibleNow)
      .map(el => ({ className: String(el.className || el.id || "").slice(0, 80), text: text(el).slice(0, 60) }))
      .slice(0, 6);
    return { ready: false, blocked: false, action: "", probe: { url: window.location.href, hasComposer: !!input, dialogs } };
  }

  return { ready: false, blocked: false, action: "" };
}

async function prepareChatForSending() {
  for (let round = 0; round < 20; round++) {
    const state = advanceCommunicationFlow();
    if (state.blocked) throw new Error(state.reason);
    if (state.ready) return findChatComposer();
    await delay(400);
  }
  throw new Error("等待聊天输入框超时。若页面出现安全验证，请先手动完成；否则请刷新 BOSS 页面后重试。");
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
  const input = await prepareChatForSending();
  input.focus();
  const isFormInput = /^(INPUT|TEXTAREA)$/.test(input.tagName || "");
  if (isFormInput) {
    const prototype = input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(input, value);
    else input.value = value;
  } else {
    input.textContent = "";
    input.textContent = value;
  }
  input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
  const currentValue = isFormInput ? input.value : input.textContent;
  if (!String(currentValue || "").trim()) throw new Error("招呼语未能写入 BOSS 聊天输入框。");
  return input;
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function sendButtonCandidates(input) {
  const selector = "button.btn-send, .btn-send";
  const scope = input?.closest?.(".message-controls, .greet-boss-container, .chat-dialog, .chat-container");
  const scoped = scope ? [...scope.querySelectorAll(selector)] : [];
  return [...new Set([...scoped, ...document.querySelectorAll(selector)])].filter(visibleNow);
}

async function waitForEnabledSendButton(input) {
  const findEnabled = () => sendButtonCandidates(input).find(candidate =>
    !candidate.disabled && !candidate.classList.contains("disabled")
  );
  let button = findEnabled();
  if (!button && typeof MutationObserver === "function") {
    button = await new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        observer.disconnect();
        resolve(value);
      };
      const observer = new MutationObserver(() => {
        const enabled = findEnabled();
        if (enabled) finish(enabled);
      });
      const timer = setTimeout(() => finish(null), 5000);
      observer.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["class", "disabled", "aria-disabled"],
      });
      const enabled = findEnabled();
      if (enabled) finish(enabled);
    });
  } else if (!button) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !button) {
      await delay(250);
      button = findEnabled();
    }
  }
  if (button) return button;
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
async function waitForOutgoingMessage(beforeCount, greeting, timeoutMs = 9000, isKnownFailed = () => false) {
  const deadline = Date.now() + timeoutMs;
  const fingerprint = normalize(greeting).slice(0, 16);
  while (Date.now() < deadline) {
    const messages = outgoingMessages();
    for (const message of messages.slice(beforeCount)) {
      if (isKnownFailed(message)) continue;
      if (fingerprint && !normalize(text(message)).includes(fingerprint)) continue;
      const statusEl = message.querySelector(".message-status");
      if (isFailed(statusEl)) throw new Error(`BOSS 显示招呼语发送失败：${text(statusEl) || "状态异常"}`);
      if (isDelivered(statusEl)) return { status: text(statusEl) || "已送达" };
    }
    await delay(180);
  }
  const timeoutError = new Error("招呼语发送状态确认超时：为避免重复发送，已停止本岗位，不会写入岗位库。");
  // 超时是不确定态：消息可能已实际送达，标记后由上层禁止无确认重发。
  timeoutError.uncertain = true;
  throw timeoutError;
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
  const timeoutError = new Error("简历图片上传或送达确认超时；已停止发送招呼语，避免出现只发文字未发简历的情况。");
  timeoutError.uncertain = true;
  throw timeoutError;
}

async function sendGreetingAndConfirm(greeting) {
  if (await waitForDeliveredText(0, greeting)) return { status: "已送达", alreadySent: true };
  const beforeCount = outgoingMessages().length;
  // 重试时跳过已确认失败的气泡：第一次失败的气泡若未从 DOM 消失，会挡住第二次成功结果的判定。
  const failedBubbles = new Set();
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1 && await waitForDeliveredText(beforeCount, greeting)) return { status: "已送达" };
    const input = await setComposer(greeting);
    const button = await waitForEnabledSendButton(input);
    button.click();
    await delay(700);
    const composerValue = () => String(/^(INPUT|TEXTAREA)$/.test(input.tagName || "") ? input.value : input.textContent || "").trim();
    if (composerValue()) {
      ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(type => button.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })));
      await delay(500);
    }
    if (composerValue()) throw new Error("招呼语已填入，但 BOSS 未确认发送；请手动点击右下角“发送”。");
    try { return await waitForOutgoingMessage(beforeCount, greeting, 9000, message => failedBubbles.has(message)); }
    catch (error) {
      // 明确的 status-error 才重试一次；超时是“不确定态”，绝不能自动重发造成双发。
      if (attempt === 1 && /BOSS 显示招呼语发送失败/.test(error.message || "")) {
        for (const message of outgoingMessages().slice(beforeCount)) {
          if (isFailed(message.querySelector(".message-status"))) failedBubbles.add(message);
        }
        await delay(900);
        continue;
      }
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
  (async () => {
    try {
      if (message.type === "EXTRACT_JOB") { sendResponse({ ok: true, job: extractJob() }); return; }
      if (message.type === "SCAN_LIST_JOBS") { sendResponse({ ok: true, jobs: scanListJobs() }); return; }
      if (message.type === "SELECT_LIST_JOB") { sendResponse(await selectListJob(message.index)); return; }
      if (message.type === "DIAGNOSE_PAGE") { sendResponse({ ok: true, data: diagnosePage() }); return; }
      if (message.type === "OPEN_COMMUNICATION") {
        const button = findCommunicationButton();
        if (!button) throw new Error("未找到“立即沟通”或“继续沟通”按钮。");
        const state = text(button); button.click(); sendResponse({ ok: true, state }); return;
      }
      if (message.type === "VERIFY_JOB") { sendResponse(verifyJob(message.job || {})); return; }
      if (message.type === "PREPARE_COMMUNICATION") {
        sendResponse({ ok: true, ...advanceCommunicationFlow() }); return;
      }
      if (message.type === "PREPARE_COMMUNICATION_PROBE") {
        sendResponse({ ok: true, ...advanceCommunicationFlow({ probe: true }) }); return;
      }
      if (message.type === "SELF_CHECK") {
        const input = findChatComposer();
        const missing = [];
        if (!input) missing.push("聊天输入框");
        if (!sendButtonCandidates(input).length) missing.push("发送按钮");
        if (message.requireImages && !findImageUploader()) missing.push("图片上传入口");
        sendResponse({ ok: true, missing }); return;
      }

      if (message.type === "SEND_MESSAGE") {
        await prepareChatForSending();
        if (await waitForDeliveredText(0, message.greeting)) {
          sendResponse({
            ok: true,
            messageSent: true,
            delivery: { status: "已送达", alreadySent: true },
            resume: { sent: false, reason: "检测到相同招呼语已送达，未重复发送简历图片" },
          });
          return;
        }
        // 先逐张确认简历图片已送达，再发送文字；若图片失败，避免出现“只发了招呼语、没发简历”的半成品投递。
        const resume = await sendResume(message.images);
        await delay(500);
        const delivery = await sendGreetingAndConfirm(message.greeting);
        sendResponse({ ok: true, messageSent: true, delivery, resume });
        return;
      }

      sendResponse({ ok: false, error: "未知消息类型" });
    } catch (error) {
      sendResponse({ ok: false, error: error.message, ...(error?.uncertain ? { uncertain: true } : {}) });
    }
  })();
  return true;
});

// —— 批量岗位抓取与切换支持 ——
const BATCH_CARD_SELECTOR = ".job-card-wrap, .job-card-box, li.job-card-wrapper";
const MAX_SELECT_WAIT_MS = 3000;   // 点击卡片后等待右侧详情浮层更新的最长时间
const SELECT_POLL_MS = 200;

function scanListJobs() {
  const cards = [...document.querySelectorAll(BATCH_CARD_SELECTOR)].filter(visible);
  return cards.map((card, index) => {
    const titleEl = card.querySelector(".job-name, .job-title");
    const title = titleEl && visible(titleEl) ? text(titleEl) : "";
    const companyEl = card.querySelector(".boss-name, .company-name");
    const company = companyEl && visible(companyEl) ? text(companyEl) : "";
    const href = card.querySelector("a.job-name[href*='/job_detail/'], a[href*='/job_detail/']")?.href || "";
    const jobId = (href.match(/job_detail\/([^./?]+)\.html/) || [])[1] || "";
    return { index, title, company, detailUrl: href, jobId };
  });
}

// 从卡片提取用于核验的身份信息（jobId 优先，其次 title）。
function cardIdentity(card) {
  const link = card.querySelector("a.job-name[href*='/job_detail/'], a[href*='/job_detail/']");
  const jobId = (link?.href?.match(/job_detail\/([^./?]+)\.html/) || [])[1] || "";
  const titleEl = card.querySelector(".job-name, .job-title");
  const title = titleEl && visible(titleEl) ? text(titleEl) : "";
  return { jobId, title };
}

function jobMatchesTarget(job, target) {
  if (target.jobId && job.jobId) return target.jobId === job.jobId;
  return !!target.title && !!job.title && target.title === job.title;
}

// 点击列表第 index 张卡片，并轮询右侧详情浮层直到读到与卡片匹配的岗位，避免读到上一个岗位。
async function selectListJob(index) {
  const cards = [...document.querySelectorAll(BATCH_CARD_SELECTOR)].filter(visible);
  if (!cards[index]) return { ok: false, reason: `未找到第 ${index + 1} 个岗位卡片` };
  const card = cards[index];
  const target = cardIdentity(card);
  const clickable = card.querySelector("a.job-name, .job-title, .job-info, .job-card-body") || card;
  clickable.click();
  const deadline = Date.now() + MAX_SELECT_WAIT_MS;
  while (Date.now() < deadline) {
    const job = extractJob();
    if (jobMatchesTarget(job, target)) return { ok: true, job };
    await delay(SELECT_POLL_MS);
  }
  return { ok: false, reason: "等待岗位详情加载超时，请确认列表页可正常点击切换岗位" };
}