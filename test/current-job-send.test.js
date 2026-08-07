import { after, test } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  state,
  setActiveProfileIndex,
  setConfig,
  setProfiles,
  setUploadedImages,
} from "../src/state.js";

const dom = new JSDOM(`
  <textarea id="greeting"></textarea>
  <button id="send">确认沟通并发送</button>
  <div id="toast"></div>
  <div id="libraryList"></div>
`, {
  url: "chrome-extension://hunter/panel.html",
  pretendToBeVisual: true,
});

globalThis.window = dom.window;
globalThis.document = dom.window.document;

const tab = {
  id: 7,
  status: "complete",
  url: "https://www.zhipin.com/job_detail/job-1.html",
};
let verifyResponse = { ok: true };
let tabMessages = [];
let runtimeMessages = [];

globalThis.chrome = {
  runtime: {
    lastError: null,
    sendMessage(message, callback) {
      runtimeMessages.push(message);
      if (message.type === "SAVE_JOB") callback({ ok: true, job: message.job });
      else if (message.type === "LIBRARY_GET") callback({ ok: true, jobLibrary: [] });
      else callback({ ok: true });
    },
  },
  tabs: {
    query: async () => [{ ...tab }],
    get: async () => ({ ...tab }),
    goBack: async () => {},
    sendMessage: async (_tabId, message) => {
      tabMessages.push(message);
      if (message.type === "VERIFY_JOB") return verifyResponse;
      if (message.type === "OPEN_COMMUNICATION") return { ok: true };
      if (message.type === "PREPARE_COMMUNICATION") return { ok: true, ready: true, mode: "inline-chat" };
      if (message.type === "SELF_CHECK") return { ok: true, missing: [] };
      if (message.type === "SEND_MESSAGE") return { ok: true, resume: { sent: true } };
      throw new Error(`Unexpected tab message: ${message.type}`);
    },
  },
  scripting: {
    executeScript: async () => {},
  },
};

const { sendJob } = await import(`../src/current-job.js?send-test=${Date.now()}`);
const { toast } = await import("../src/chrome-helpers.js");

const profileA = {
  name: "AI 方向",
  candidateProfile: "profile-a",
  resumeImages: [{ name: "a.png", dataUrl: "data:image/png;base64,AA==" }],
};
const profileB = {
  name: "产品方向",
  candidateProfile: "profile-b",
  resumeImages: [{ name: "b.png", dataUrl: "data:image/png;base64,BB==" }],
};

function prepare() {
  setProfiles([profileA, profileB]);
  setActiveProfileIndex(0);
  setConfig({ candidateProfile: profileA.candidateProfile });
  setUploadedImages(profileA.resumeImages);
  state.currentJob = {
    jobId: "job-1",
    title: "AI 产品经理",
    company: "目标公司",
    detailUrl: tab.url,
  };
  state.currentJobProfile = profileA;
  state.currentJobResumeImages = [...profileA.resumeImages];
  document.getElementById("greeting").value = "您好，我对这个岗位很感兴趣。";
  document.getElementById("send").disabled = false;
  document.getElementById("send").textContent = "确认沟通并发送";
  verifyResponse = { ok: true };
  tabMessages = [];
  runtimeMessages = [];
}

test("单岗位发送在打开沟通页前核验岗位并阻断不一致目标", async () => {
  prepare();
  verifyResponse = { ok: false, reason: "岗位名称不一致" };

  await sendJob();

  assert.deepEqual(tabMessages.map(message => message.type), ["VERIFY_JOB"]);
  assert.equal(runtimeMessages.some(message => message.type === "SAVE_JOB"), false);
  assert.match(document.getElementById("toast").textContent, /岗位核验失败/);
});

test("单岗位发送使用同步执行锁阻止快速双击重复发送", async () => {
  prepare();

  const first = sendJob();
  const second = sendJob();
  await Promise.all([first, second]);

  assert.equal(tabMessages.filter(message => message.type === "VERIFY_JOB").length, 1);
  assert.equal(tabMessages.filter(message => message.type === "SEND_MESSAGE").length, 1);
  assert.equal(runtimeMessages.filter(message => message.type === "SAVE_JOB").length, 1);
});

test("分析后切换 profile 会阻断旧招呼语与新简历图片混用", async () => {
  prepare();
  setActiveProfileIndex(1);
  setConfig({ candidateProfile: profileB.candidateProfile });
  setUploadedImages(profileB.resumeImages);

  await sendJob();

  assert.equal(tabMessages.length, 0);
  assert.equal(runtimeMessages.some(message => message.type === "SAVE_JOB"), false);
  assert.match(document.getElementById("toast").textContent, /当前简历已切换/);
});

after(() => {
  clearTimeout(toast.timer);
  delete globalThis.window;
  delete globalThis.document;
  delete globalThis.chrome;
  dom.window.close();
});
