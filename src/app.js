// 猎投 — 面板入口，引入并初始化所有 src/ 模块。
import { state, setConfig, setUploadedImages } from "./state.js";
import { $, toast, send } from "./chrome-helpers.js";
import {
  setupConfig,
  persistConfig,
  allowApiOrigin,
  loadProfiles,
  switchProfile,
  createProfile,
  deleteProfile,
  renameProfile,
  renderProfileList,
  applyActiveProfile,
} from "./config.js";
import { ai } from "./ai-client.js";
import { analyze, sendJob } from "./current-job.js";
import { parseResume, loadImages } from "./resume.js";
import {
  addCurrentToQueue,
  removeSelectedQueue,
  toggleSelectAll,
  generateQueue,
  startQueue,
} from "./queue.js";
import { renderSavedResumes, loadLibrary, loadQueue, switchGreeting } from "./render.js";
import { initFillUi, refreshFillUi } from "./fill-ui.js";
import { DEFAULT_GREETING_PROMPT, LEGACY_GREETING_PROMPT } from "./prompts.js";

async function initConfig() {
  
  // 先加载用户配置
  const stored = await chrome.storage.local.get("config");
  const storedConfig = stored.config || {};
  setConfig({
    endpoint: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    apiKey: "",
    disableThinking: true,
    candidateProfile: "",
    greetingPrompt: DEFAULT_GREETING_PROMPT,
    resumeImages: [],
    ...storedConfig,
  });
  if (
    !storedConfig.greetingPrompt ||
    storedConfig.greetingPrompt === LEGACY_GREETING_PROMPT ||
    state.config.greetingPrompt.includes("{{候选人资料}}")
  )
    state.config.greetingPrompt = DEFAULT_GREETING_PROMPT;
  // 加载简历 profiles（会覆盖 candidateProfile、greetingPrompt、resumeImages）
  await loadProfiles();
  setUploadedImages(state.config.resumeImages || []);
  setupConfig();
  renderSavedResumes();
  renderProfileList("profileList");
  loadLibrary();
}

function bindEvents() {
  // 标签页切换
  document.querySelectorAll(".tab").forEach((button) =>
    button.addEventListener("click", () => {
      document.querySelectorAll(".tab, .page").forEach((el) => el.classList.remove("active"));
      button.classList.add("active");
      $(button.dataset.tab).classList.add("active");
    })
  );
  // 常规设置
  $("guide").onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL("guide.html") });
  $("saveConfig").onclick = () => persistConfig();
  $("saveGreetingPrompt").onclick = () => persistConfig();
  $("saveProfile").onclick = () => persistConfig();
  $("resetGreetingPrompt").onclick = () => {
    $("greetingPrompt").value = DEFAULT_GREETING_PROMPT;
    toast("已恢复新的 JD 匹配写作要求，请点击保存写作要求");
  };
  $("testApi").onclick = async () => {
    const button = $("testApi");
    button.disabled = true;
    button.textContent = "正在连接…";
    try {
      await allowApiOrigin();
      await persistConfig(false);
      await ai([{ role: "user", content: "只回复：连接成功" }], 200);
      toast("AI 连接成功");
    } catch (error) {
      toast(error.message);
    } finally {
      button.disabled = false;
      button.textContent = "测试连接";
    }
  };
  $("resumeInput").onchange = (event) =>
    loadImages(event.target.files).catch((error) => toast(error.message));
  $("parseResume").onclick = parseResume;
  // 当前岗位
  $("analyze").onclick = analyze;
  $("refreshGreeting").onclick = analyze;
  $("send").onclick = sendJob;
  // 招呼语切换（委托事件，由 render.js 动态生成）
  document.addEventListener("click", (event) => {
    const tab = event.target.closest(".greeting-tab");
    if (tab) {
      const index = parseInt(tab.dataset.greetingIndex, 10);
      if (!isNaN(index)) switchGreeting(index);
    }
  });
  // 岗位库导出
  $("export").onclick = async () => {
    const response = await send({ type: "EXPORT_JOBS" });
    toast(response?.ok ? "已生成 Excel 兼容 CSV" : "导出失败");
  };
  // 投递清单
  $("addQueueTop").onclick = addCurrentToQueue;
  $("generateQueue").onclick = generateQueue;
  $("selectAll").onclick = toggleSelectAll;
  $("removeSelected").onclick = removeSelectedQueue;
  $("startQueue").onclick = startQueue;
  $("stopQueue").onclick = async () => {
    const button = $("stopQueue");
    try {
      button.disabled = true;
      button.textContent = "正在停止…";
      const result = await send({ type: "QUEUE_STOP" });
      if (!result?.ok) throw new Error(result?.error || "无法停止投递");
      toast("已请求停止投递，当前岗位处理完成后即停止。");
    } catch (error) {
      toast(`停止失败：${error.message}`);
    } finally {
      button.disabled = false;
      button.textContent = "停止投递";
    }
  };
  // 多简历管理（委托事件）
  document.addEventListener("click", async (event) => {
    const item = event.target.closest("[data-profile-index]");
    if (!item) return;
    const index = parseInt(item.dataset.profileIndex, 10);
    if (isNaN(index)) return;
    // 删除按钮
    if (event.target.closest(".profile-delete")) {
      event.stopPropagation();
      try {
        const name = state.profiles[index]?.name || "未命名";
        if (!confirm(`确定删除简历"${name}"？此操作不可恢复。`)) return;
        await deleteProfile(index);
        renderProfileList("profileList");
        setupConfig();
        renderSavedResumes();
        refreshFillUi();
        toast(`已删除简历"${name}"`);
      } catch (error) { toast(error.message); }
      return;
    }
    // 切换简历
    try {
      await switchProfile(index);
      renderProfileList("profileList");
      setupConfig();
      renderSavedResumes();
      refreshFillUi();
      toast(`已切换到"${state.profiles[index]?.name || "未命名"}"`);
    } catch (error) { toast(error.message); }
  });
  // 新增简历
  const createBtn = $("createProfile");
  if (createBtn) {
    createBtn.onclick = async () => {
      const name = prompt("请输入简历名称（如：产品方向、AI 方向）：");
      if (!name) return;
      try {
        await createProfile(name.trim());
        renderProfileList("profileList");
        refreshFillUi();
        toast(`已创建简历"${name.trim()}"`);
      } catch (error) { toast(error.message); }
    };
  }
}


// animate: 是否触发按钮旋转动画（仅用户主动点击时为 true）
function applyDarkMode(isDark, animate = true) {
  const btn = $("darkToggle");
  if (animate) {
    btn.classList.add("spinning");
    setTimeout(() => btn.classList.remove("spinning"), 550);
  }
  if (isDark) {
    document.body.classList.add("dark");
    btn.textContent = "🌙";
  } else {
    document.body.classList.remove("dark");
    btn.textContent = "☀️";
  }
}

async function initDarkMode() {
  try {
    const { darkMode } = await chrome.storage.local.get("darkMode");
    if (darkMode !== undefined) {
      applyDarkMode(darkMode, false);
    } else {
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      applyDarkMode(prefersDark, false);
      // 监听系统切换，但只在用户未手动选择时生效
      window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", async (e) => {
        const { darkMode: saved } = await chrome.storage.local.get("darkMode");
        if (saved === undefined) applyDarkMode(e.matches, false);
      });
    }
  } catch (e) { console.error("[猎投] dark mode init error:", e); }
}

document.addEventListener("DOMContentLoaded", async () => {
  await initConfig();
  initDarkMode();
  bindEvents();
  $("darkToggle").onclick = () => {
    const isDark = !document.body.classList.contains("dark");
    applyDarkMode(isDark);
    chrome.storage.local.set({ darkMode: isDark }).catch(() => {});
  };
  loadQueue();
  initFillUi();
});
