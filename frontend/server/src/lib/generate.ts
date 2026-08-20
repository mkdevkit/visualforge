import { loadSettings } from "../config.js";
import type { FeatureId, ProviderId, StationEngine } from "../types.js";
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
import { generateImageMeshy, generate3dMeshy, pollMeshyTask } from "./meshy-generate.js";
import { generateImageMidjourney } from "./midjourney-generate.js";
import { generate3dTripo, pollTripoTask } from "./tripo-generate.js";
import { generateImageVolc, generateVideoVolc, generateMusicVolc, pollVolcTask } from "./volcengine-generate.js";
import { isProviderId, providerById } from "./providers.js";

export type { DashScopeError } from "./dashscope.js";
export type { CloudError } from "./cloud-http.js";

function unsupported(engine: ProviderId, station: string): never {
  const label = providerById(engine)?.label || engine;
  throw new Error(`「${label}」不支持${station}。请到设置页改选该工位已开启的提供商。`);
}

function stationOf(feature: FeatureId) {
  return loadSettings().engines[feature];
}

function engineOf(feature: FeatureId, body?: { engine?: StationEngine }): ProviderId {
  const station = stationOf(feature);
  const want = isProviderId(body?.engine) ? body.engine : station.default;
  if (!station.enabled.includes(want)) {
    const label = providerById(want)?.label || want;
    throw new Error(`该工位未开启「${label}」。请到设置页为该工位勾选对应平台提供商。`);
  }
  return want;
}

export async function generateImage(body: Parameters<typeof generateImageComfy>[0]) {
  const engine = engineOf("image", body);
  if (engine === "qwen") return generateImageQwen(body);
  if (engine === "meshy") return generateImageMeshy(body);
  if (engine === "midjourney") return generateImageMidjourney(body);
  if (engine === "volcengine") return generateImageVolc(body);
  if (engine === "comfyui") return generateImageComfy(body);
  return unsupported(engine, "生图");
}

export async function generateVideo(body: Parameters<typeof generateVideoComfy>[0]) {
  const engine = engineOf("video", body);
  if (engine === "qwen") return generateVideoQwen(body);
  if (engine === "volcengine") return generateVideoVolc(body);
  if (engine === "comfyui") return generateVideoComfy(body);
  return unsupported(engine, "生视频");
}

export async function generateMusic(body: Parameters<typeof generateMusicComfy>[0]) {
  const engine = engineOf("music", body);
  if (engine === "qwen") return generateMusicQwen(body);
  if (engine === "volcengine") return generateMusicVolc(body);
  if (engine === "comfyui") return generateMusicComfy(body);
  return unsupported(engine, "生音乐");
}

export async function generateTts(body: Parameters<typeof generateTtsComfy>[0]) {
  const engine = engineOf("tts", body);
  if (engine === "qwen") return generateTtsQwen(body);
  if (engine === "comfyui") return generateTtsComfy(body);
  return unsupported(engine, "配音");
}

export async function generateSfx(body: Parameters<typeof generateSfxComfy>[0]) {
  const engine = engineOf("sfx", body);
  if (engine === "qwen") return generateSfxQwen(body);
  if (engine === "comfyui") return generateSfxComfy(body);
  return unsupported(engine, "音效");
}

export async function designVoice(body: Parameters<typeof designVoiceComfy>[0]) {
  const engine = engineOf("voiceDesign", body);
  if (engine === "qwen") return designVoiceQwen(body);
  if (engine === "comfyui") return designVoiceComfy(body);
  return unsupported(engine, "音色设计");
}

export async function generate3d(body: Parameters<typeof generate3dComfy>[0]) {
  const engine = engineOf("model3d", body);
  if (engine === "qwen") return generate3dQwen(body);
  if (engine === "meshy") return generate3dMeshy(body);
  if (engine === "tripo") return generate3dTripo(body);
  if (engine === "comfyui") return generate3dComfy(body);
  return unsupported(engine, "生 3D");
}

export async function pollRemoteTask(id: string) {
  const task = getTask(id);
  if (!task) return task;
  const kind = String(task.payload?.remoteKind || "");
  if (kind === "qwen") return pollQwenTask(id);
  if (kind === "meshy") return pollMeshyTask(id);
  if (kind === "tripo") return pollTripoTask(id);
  if (kind === "volcengine") return pollVolcTask(id);
  return pollComfyTask(id);
}
