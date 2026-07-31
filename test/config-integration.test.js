import { test } from "node:test";
import assert from "node:assert/strict";
import {
  state,
  setActiveProfileIndex,
  setConfig,
  setProfiles,
  setUploadedImages,
} from "../src/state.js";
import { deleteProfile, switchProfile } from "../src/config.js";

function setupProfiles() {
  const writes = [];
  globalThis.chrome = {
    storage: {
      local: {
        set: async value => writes.push(structuredClone(value)),
      },
    },
  };
  setProfiles([
    { name: "A", candidateProfile: "resume-A", greetingPrompt: "prompt-A", resumeImages: ["img-A"] },
    { name: "B", candidateProfile: "resume-B", greetingPrompt: "prompt-B", resumeImages: ["img-B"] },
    { name: "C", candidateProfile: "resume-C", greetingPrompt: "prompt-C", resumeImages: ["img-C"] },
  ]);
  setActiveProfileIndex(0);
  setConfig({ candidateProfile: "resume-A", greetingPrompt: "prompt-A", resumeImages: ["img-A"] });
  setUploadedImages(["img-A"]);
  return writes;
}

test("switchProfile 保存源简历且不会覆盖目标简历", async () => {
  const writes = setupProfiles();

  await switchProfile(1);

  assert.equal(state.activeProfileIndex, 1);
  assert.deepEqual(state.profiles[1], {
    name: "B",
    candidateProfile: "resume-B",
    greetingPrompt: "prompt-B",
    resumeImages: ["img-B"],
  });
  assert.equal(state.config.candidateProfile, "resume-B");
  assert.deepEqual(state.uploadedImages, ["img-B"]);
  assert.equal(writes.at(-1).activeProfileIndex, 1);
  assert.equal(writes.at(-1).config.candidateProfile, "resume-B");
});

test("deleteProfile 删除当前项后加载相邻简历而不覆盖内容", async () => {
  setupProfiles();
  setActiveProfileIndex(1);
  setConfig({ candidateProfile: "resume-B", greetingPrompt: "prompt-B", resumeImages: ["img-B"] });
  setUploadedImages(["img-B"]);

  await deleteProfile(1);

  assert.equal(state.activeProfileIndex, 1);
  assert.deepEqual(state.profiles.map(profile => profile.name), ["A", "C"]);
  assert.equal(state.config.candidateProfile, "resume-C");
  assert.deepEqual(state.uploadedImages, ["img-C"]);
});

test("deleteProfile 删除当前项之前的简历时保持当前简历", async () => {
  setupProfiles();
  setActiveProfileIndex(2);
  setConfig({ candidateProfile: "resume-C", greetingPrompt: "prompt-C", resumeImages: ["img-C"] });
  setUploadedImages(["img-C"]);

  await deleteProfile(0);

  assert.equal(state.activeProfileIndex, 1);
  assert.deepEqual(state.profiles.map(profile => profile.name), ["B", "C"]);
  assert.equal(state.config.candidateProfile, "resume-C");
  assert.deepEqual(state.uploadedImages, ["img-C"]);
});
