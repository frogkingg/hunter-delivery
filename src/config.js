// 配置管理：setupConfig / persistConfig / allowApiOrigin / ensureAiConsent / 多简历管理。
import { state, setConfig, setUploadedImages, setProfiles, setActiveProfileIndex, activeProfile, saveCurrentProfileFields } from "./state.js";
import { $, send, toast } from "./chrome-helpers.js";
import { handleError } from "./error-handler.js";
import { validateEndpoint } from "./pure-utils.js";
import { DEFAULT_GREETING_PROMPT } from "./prompts.js";

export function setupConfig() {
  $("endpoint").value = state.config.endpoint || "";
  $("model").value = state.config.model || "";
  $("apiKey").value = state.config.apiKey || "";
  $("candidateProfile").value = state.config.candidateProfile || "";
  $("greetingPrompt").value = state.config.greetingPrompt || DEFAULT_GREETING_PROMPT;
}

export async function persistConfig(show = true) {
  const endpoint = $("endpoint").value.trim();
  if (endpoint) {
    try { validateEndpoint(endpoint); } catch (error) {
      if (show) handleError("保存设置", error, toast);
      throw error;
    }
  }
  state.config = {
    ...state.config,
    endpoint,
    model: $("model").value.trim(),
    apiKey: $("apiKey").value.trim(),
    candidateProfile: $("candidateProfile").value.trim(),
    greetingPrompt: $("greetingPrompt").value.trim() || DEFAULT_GREETING_PROMPT,
    resumeImages: state.uploadedImages,
  };
  await chrome.storage.local.set({ config: state.config });
  // 同步当前简历 profile 的内容
  const profile = activeProfile();
  if (profile) {
    profile.candidateProfile = state.config.candidateProfile;
    profile.greetingPrompt = state.config.greetingPrompt;
    profile.resumeImages = state.uploadedImages;
    await saveProfiles();
  }
  if (show) toast("设置已保存");
}

export async function allowApiOrigin() {
  const value = validateEndpoint($("endpoint").value);
  const origin = new URL(value).origin + "/*";
  const ok = await chrome.permissions.request({ origins: [origin] });
  if (!ok) throw new Error("需要允许访问该 AI 服务，才能继续。");
}

export async function ensureAiConsent() {
  const { aiConsented } = await chrome.storage.local.get("aiConsented");
  if (aiConsented) return;
  const ok = confirm("首次使用提醒：你的简历图片、简历全文和岗位 JD 将发送到你在设置中填写的 AI 服务地址。\n\n请确认你信任该服务地址，且已使用 https。点击确定后继续，本提醒不会再出现。");
  if (!ok) throw new Error("已取消，未向 AI 服务发送任何数据。");
  await chrome.storage.local.set({ aiConsented: true });
}

// —— 多简历管理 ——

export async function loadProfiles() {
  const { profiles: savedProfiles = [], activeProfileIndex = 0 } = await chrome.storage.local.get(["profiles", "activeProfileIndex"]);
  if (savedProfiles.length) {
    setProfiles(savedProfiles);
    setActiveProfileIndex(Math.min(activeProfileIndex, savedProfiles.length - 1));
  } else {
    const defaultProfile = { name: "默认简历", candidateProfile: "", greetingPrompt: "", resumeImages: [] };
    setProfiles([defaultProfile]);
    setActiveProfileIndex(0);
    await saveProfiles();
  }
  applyActiveProfile();
}

export async function saveProfiles() {
  saveCurrentProfileFields();
  await chrome.storage.local.set({ profiles: state.profiles, activeProfileIndex: state.activeProfileIndex });
}

export function applyActiveProfile() {
  const profile = activeProfile();
  if (!profile) return;
  setConfig({ ...state.config, candidateProfile: profile.candidateProfile || "", greetingPrompt: profile.greetingPrompt || "", resumeImages: profile.resumeImages || [] });
  setUploadedImages(profile.resumeImages || []);
}

export async function switchProfile(index) {
  const max = state.profiles.length;
  if (index < 0 || index >= max) throw new Error("简历序号无效。");
  if (index === state.activeProfileIndex) return;
  saveCurrentProfileFields();
  setActiveProfileIndex(index);
  await saveProfiles();
  applyActiveProfile();
}

export async function createProfile(name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("请输入简历名称。");
  if (state.profiles.length >= 5) throw new Error("最多创建 5 份简历。");
  if (state.profiles.some(p => p.name === trimmed)) throw new Error("已存在同名简历。");
  state.profiles.push({ name: trimmed, candidateProfile: "", greetingPrompt: "", resumeImages: [] });
  await saveProfiles();
}

export async function deleteProfile(index) {
  if (state.profiles.length <= 1) throw new Error("至少保留一份简历。");
  if (index < 0 || index >= state.profiles.length) throw new Error("简历序号无效。");
  state.profiles.splice(index, 1);
  if (state.activeProfileIndex >= state.profiles.length) setActiveProfileIndex(state.profiles.length - 1);
  await saveProfiles();
  applyActiveProfile();
}

export async function renameProfile(index, name) {
  const trimmed = String(name || "").trim();
  if (!trimmed) throw new Error("请输入简历名称。");
  if (index < 0 || index >= state.profiles.length) throw new Error("简历序号无效。");
  if (state.profiles.some((p, i) => i !== index && p.name === trimmed)) throw new Error("已存在同名简历。");
  state.profiles[index].name = trimmed;
  await saveProfiles();
}

export function renderProfileList(targetId) {
  const target = document.getElementById(targetId);
  if (!target) return;
  target.innerHTML = state.profiles.map((profile, index) => {
    const active = index === state.activeProfileIndex ? " active" : "";
    const name = profile.name || "(未命名)";
    const images = (profile.resumeImages || []).length;
    const hasContent = profile.candidateProfile?.trim();
    const status = hasContent ? "✓ 已填写" : "○ 未填写";
    return `<div class="profile-item${active}" data-profile-index="${index}">
      <span class="profile-name">${name}</span>
      <span class="profile-status">${status} · ${images} 张图片</span>
      ${state.profiles.length > 1 ? `<button class="profile-delete" type="button" data-profile-index="${index}">×</button>` : ""}
    </div>`;
  }).join("");
}
