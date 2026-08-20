import { loadSettings } from "../config.js";
import type { FeatureId, StationEngine } from "../types.js";
import { getTask } from "./tasks.js";
import {
  designVoiceComfy,
  generate3dComfy,
  generateImageComfy,
  generateMusicComfy,
  generateSfxComfy,
  generateTtsComfy,
  generateVideoComfy,
  pollComfyTask,
} from "./comfy-generate.js";
import {
  designVoiceQwen,
  generate3dQwen,
  generateImageQwen,
  generateMusicQwen,
  generateSfxQwen,
  generateTtsQwen,
  generateVideoQwen,
  pollQwenTask,
} from "./qwen-generate.js";

export type { DashScopeError } from "./dashscope.js";

function qwenOffered(feature: FeatureId) {
  const s = loadSettings();
  return Boolean(s.qwen.enabled) && s.engines[feature] === "qwen";
}

function engineOf(feature: FeatureId, body?: { engine?: StationEngine }): StationEngine {
  const offered = qwenOffered(feature);
  const want = body?.engine === "qwen" || body?.engine === "comfyui" ? body.engine : offered ? "qwen" : "comfyui";
  if (want === "qwen" && !offered) {
    throw new Error("未开启千问云，或该工位默认工具不是千问云。请到设置页开启千问云，并把该工位默认工具设为千问云。");
  }
  return want;
}

export async function generateImage(body: Parameters<typeof generateImageComfy>[0]) {
  return engineOf("image", body) === "qwen" ? generateImageQwen(body) : generateImageComfy(body);
}

export async function generateVideo(body: Parameters<typeof generateVideoComfy>[0]) {
  return engineOf("video", body) === "qwen" ? generateVideoQwen(body) : generateVideoComfy(body);
}

export async function generateMusic(body: Parameters<typeof generateMusicComfy>[0]) {
  return engineOf("music", body) === "qwen" ? generateMusicQwen(body) : generateMusicComfy(body);
}

export async function generateTts(body: Parameters<typeof generateTtsComfy>[0]) {
  return engineOf("tts", body) === "qwen" ? generateTtsQwen(body) : generateTtsComfy(body);
}

export async function generateSfx(body: Parameters<typeof generateSfxComfy>[0]) {
  return engineOf("sfx", body) === "qwen" ? generateSfxQwen(body) : generateSfxComfy(body);
}

export async function designVoice(body: Parameters<typeof designVoiceComfy>[0]) {
  return engineOf("voiceDesign", body) === "qwen" ? designVoiceQwen(body) : designVoiceComfy(body);
}

export async function generate3d(body: Parameters<typeof generate3dComfy>[0]) {
  return engineOf("model3d", body) === "qwen" ? generate3dQwen(body) : generate3dComfy(body);
}

export async function pollRemoteTask(id: string) {
  const task = getTask(id);
  if (!task) return task;
  if (task.payload?.remoteKind === "qwen") return pollQwenTask(id);
  return pollComfyTask(id);
}
