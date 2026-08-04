// 全局可变状态与操作函数。
// 各模块通过 import 引用同一份 state 对象。
// 纯函数不依赖这些状态；有状态操作的函数从这里读取并调用 action。
export const state = {
  config: {},
  currentJob: null,
  uploadedImages: [],
  jobPromptOverride: "",
  selectedQueueKeys: new Set(),
  queuePollTimer: null,
  queueWasRunning: false,
  // 多简历支持
  profiles: [],
  activeProfileIndex: 0,
  // 智能填充
  fillScanFields: [],
  fillScanPage: null,
  fillScanSession: null,
  fillRepeaters: [],
  fillMatches: [],
  fillSelected: new Set(),
  fillValues: {},
  fillFailedIds: [],
  fillAiEnabled: true,
  fillTemplateEnabled: true,
  resumeFieldsDraft: null,
  resumeFieldsDraftProfile: null,
  resumeFieldsDirty: false,
};

// —— State Actions（集中管理状态写入） ——

export function setConfig(config) { state.config = config; }
export function setCurrentJob(job) { state.currentJob = job; }
export function setUploadedImages(images) { state.uploadedImages = images; }
export function setJobPromptOverride(prompt) { state.jobPromptOverride = prompt; }
export function setQueuePollTimer(timer) { state.queuePollTimer = timer; }
export function setQueueWasRunning(running) { state.queueWasRunning = running; }
export function setProfiles(profiles) {
  state.profiles = profiles;
  state.resumeFieldsDraft = null;
  state.resumeFieldsDraftProfile = null;
  state.resumeFieldsDirty = false;
}
export function setActiveProfileIndex(index) { state.activeProfileIndex = index; }

export function setFillScanFields(fields) { state.fillScanFields = fields; }
export function setFillScanPage(page) { state.fillScanPage = page; }
export function setFillScanSession(session) { state.fillScanSession = session; }
export function setFillRepeaters(repeaters) { state.fillRepeaters = repeaters; }
export function setFillMatches(matches) { state.fillMatches = matches; }
export function setFillSelected(keys) { state.fillSelected = keys; }
export function setFillValues(values) { state.fillValues = values; }
export function setFillFailedIds(ids) { state.fillFailedIds = ids; }
export function setFillAiEnabled(value) { state.fillAiEnabled = value; }
export function setFillTemplateEnabled(value) { state.fillTemplateEnabled = value; }
export function setResumeFieldsDraft(value, profile = activeProfile()) {
  state.resumeFieldsDraft = value;
  state.resumeFieldsDraftProfile = profile;
}
export function setResumeFieldsDirty(value) { state.resumeFieldsDirty = !!value; }

export function activeProfile() { return state.profiles[state.activeProfileIndex] || null; }
export function saveCurrentProfileFields() {
  const p = activeProfile();
  if (p) Object.assign(p, {
    candidateProfile: state.config.candidateProfile,
    greetingPrompt: state.config.greetingPrompt,
    resumeImages: state.uploadedImages,
  });
}
