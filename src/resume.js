// 简历：parseResume / loadImages。
import { state, setUploadedImages, activeProfile } from "./state.js";
import { $, toast } from "./chrome-helpers.js";
import { handleError } from "./error-handler.js";
import { aiStream } from "./ai-client.js";
import { persistConfig, saveProfiles } from "./config.js";
import { renderSavedResumes } from "./render.js";

export async function parseResume() {
  try {
    if (!state.uploadedImages.length) throw new Error("请先选择简历图片。");
    $("parseResume").disabled = true;
    $("parseResume").textContent = "正在提取简历内容…";
    const profileField = $("candidateProfile");
    profileField.value = "";
    const content = [{ type: "text", text: "请读取以下简历图片，完整提取简历中明确出现的全部文字内容。输出标题必须是简历内容。只提取原文，不得推测、概括、评价、改写或补充；完整保留个人信息、项目经历、工作经历、岗位名称、公司名称、时间、职责、行动、成果、能力、工具、行业经验、教育经历和其他文字，重点保留简历中提到的项目经理经历、项目管理能力、业务能力、协作能力、专业能力和量化成果。看不清的文字标记为图片文字不清，不要猜测。使用清晰的 Markdown 结构，但不要改变原文含义。只输出简历内容和提取结果，不要输出候选人画像、分析、评价或建议。" }, ...state.uploadedImages.map(image => ({ type: "image_url", image_url: { url: image.dataUrl } }))];
    // 流式逐字更新：onDelta 收到累计全文，实时写入 textarea，让用户看到生成进度。
    const profile = await aiStream([{ role: "user", content }], 5000, (text) => { profileField.value = text; });
    profileField.value = profile;
    // 同步到当前简历 profile
    const p = activeProfile();
    if (p) {
      p.candidateProfile = profile;
      await saveProfiles();
    }
    await persistConfig(false);
    toast("简历内容已提取，请检查并保存");
  } catch (error) {
    handleError("解析简历图片", error, toast);
  } finally {
    $("parseResume").disabled = false;
    $("parseResume").textContent = "解析简历图片";
  }
}

export async function loadImages(files) {
  const next = [];
  for (const file of files) {
    if (file.size > 4 * 1024 * 1024) throw new Error(`${file.name} 超过 4MB，请压缩后上传。`);
    next.push(await new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve({ name: file.name, type: file.type, dataUrl: reader.result }); reader.readAsDataURL(file); }));
  }
  setUploadedImages(next);
  // 同步图片到当前简历 profile
  const p = activeProfile();
  if (p) {
    p.resumeImages = next;
    await saveProfiles();
  }
  renderSavedResumes();
  await persistConfig(false);
  toast(`已保存 ${next.length} 张简历图片`);
}
