import { join } from "node:path";
import type { AssetRecord, FeatureId, GenerateImageBody, GenerateMusicBody, GenerateSfxBody, GenerateTtsBody, GenerateVideoBody, Generate3dBody, VoiceDesignBody } from "../types.js";
import { absPath, saveBuffer } from "./storage.js";
import { createTask, mark, patchTask } from "./tasks.js";
import { upsertVoice } from "./voices.js";
import { type ComfyFile } from "./comfy.js";
import { featureFromManager, runManagerGenerate, runManagerHarvest } from "./manager-client.js";

export async function featureCfg(feature: FeatureId, workflowId?: string) {
  return { comfy: await featureFromManager(feature, workflowId) };
}

function resolveLocal(value?: string) {
  if (!value || /^(https?:\/\/|data:|oss:\/\/)/i.test(value)) return undefined;
  return absPath(value.startsWith("uploads/") || value.includes("/") ? value : join("uploads", value));
}

function parseSize(size?: string) {
  if (!size || size === "auto") return { width: 1024, height: 1024 };
  const [w, h] = size.split(/[*x×]/i).map(Number);
  return { width: w || 1024, height: h || 1024 };
}

function persistFiles(opts: {
  files: ComfyFile[];
  type: AssetRecord["type"];
  prompt: string;
  model: string;
  params: Record<string, unknown>;
  title?: string;
  tags?: string[];
  kind?: AssetRecord["kind"];
  prefer: string[];
}) {
  const ranked = [...opts.files].sort((a, b) => {
    const score = (f: ComfyFile) => opts.prefer.findIndex((p) => f.ext === p || f.mime.includes(p)) + 1 || 99;
    return score(a) - score(b);
  });
  const picked = ranked.length ? ranked : opts.files;
  return picked.map((file) =>
    saveBuffer({
      type: opts.type,
      buffer: file.buffer,
      ext: file.ext,
      mime: file.mime,
      prompt: opts.prompt,
      model: opts.model,
      params: opts.params,
      title: opts.title,
      tags: opts.tags,
      kind: opts.kind,
    }),
  );
}

type AnyBody = Record<string, unknown>;

function asVarsBody(body: object): AnyBody {
  return body as AnyBody;
}

function varsFrom(feature: FeatureId, body: AnyBody, model: string) {
  const size = parseSize(typeof body.size === "string" ? body.size : undefined);
  return {
    prompt: body.prompt || body.voicePrompt || body.text || "",
    negative: body.negativePrompt || "",
    model,
    text: body.text || "",
    voice: body.voice || "",
    instructions: body.instructions || "",
    lyrics: body.lyrics || "",
    name: body.preferredName || body.prefix || "",
    targetModel: body.targetModel || "",
    width: size.width,
    height: size.height,
    size: body.size || "",
    n: body.n ?? 1,
    seed: body.seed ?? Math.floor(Math.random() * 1_000_000_000),
    duration: body.duration ?? 5,
    resolution: body.resolution || "720P",
    ratio: body.ratio || "16:9",
    instrumental: body.isInstrumental ?? false,
    gender: body.gender || "",
    language: body.languageType || body.language || "Chinese",
    image: "",
    image2: "",
    feature,
  };
}

function uploadsOf(body: AnyBody) {
  const list: string[] = [];
  const push = (v?: unknown) => {
    if (typeof v !== "string") return;
    const p = resolveLocal(v);
    if (p) list.push(p);
  };
  if (Array.isArray(body.images)) for (const img of body.images) push(img);
  push(body.image);
  push(body.firstFrame);
  push(body.lastFrame);
  return list;
}

function assetMeta(feature: FeatureId): { type: AssetRecord["type"]; prefer: string[]; kind: AssetRecord["kind"] } {
  if (feature === "video" || feature === "anim3d") return { type: "video", prefer: ["mp4", "webm", "video"], kind: "t2v" };
  if (feature === "music") return { type: "music", prefer: ["mp3", "wav", "audio"], kind: "song" };
  if (feature === "model3d") return { type: "model3d", prefer: ["glb", "gltf", "model"], kind: "t23d" };
  if (feature === "tts") return { type: "audio", prefer: ["wav", "mp3", "audio"], kind: "tts" };
  if (feature === "sfx") return { type: "audio", prefer: ["wav", "mp3", "audio"], kind: "sfx" };
  if (feature === "voiceDesign") return { type: "audio", prefer: ["wav", "mp3", "audio"], kind: "voice-preview" };
  return { type: "image", prefer: ["png", "jpg", "webp", "image"], kind: "t2i" };
}

function taskTypeOf(feature: FeatureId): AssetRecord["type"] {
  if (feature === "model3d") return "model3d";
  if (feature === "video" || feature === "anim3d") return "video";
  if (feature === "music") return "music";
  if (feature === "tts" || feature === "sfx" || feature === "voiceDesign") return "audio";
  return "image";
}

export async function generateImageComfy(body: GenerateImageBody) {
  return enqueueOrSync("image", asVarsBody(body), body.prompt);
}

export async function generateMusicComfy(body: GenerateMusicBody) {
  return enqueueOrSync("music", asVarsBody(body), String(body.prompt || body.lyrics || ""));
}

export async function generateTtsComfy(body: GenerateTtsBody) {
  return enqueueOrSync("tts", asVarsBody({ ...body, prompt: body.text }), body.text);
}

export async function generateSfxComfy(body: GenerateSfxBody) {
  return enqueueOrSync("sfx", asVarsBody(body), body.prompt);
}

export async function designVoiceComfy(body: VoiceDesignBody) {
  return enqueueOrSync("voiceDesign", asVarsBody({ ...body, prompt: body.voicePrompt }), body.voicePrompt);
}

export async function generateVideoComfy(body: GenerateVideoBody) {
  return enqueueOrSync("video", asVarsBody(body), body.prompt);
}

export async function generate3dComfy(body: Generate3dBody) {
  return enqueueOrSync("model3d", asVarsBody(body), body.prompt || "");
}

async function enqueueOrSync(feature: FeatureId, body: AnyBody, prompt: string) {
  const modelHint = String(body.model || "");
  const vars = varsFrom(feature, body, modelHint);
  const queued = await runManagerGenerate({
    feature,
    workflowId: typeof body.workflowId === "string" ? body.workflowId : undefined,
    model: modelHint || undefined,
    wait: false,
    vars,
    uploads: uploadsOf(body),
  });
  const model = queued.model || modelHint || "comfyui";
  if (!queued.promptId) {
    const meta = assetMeta(feature);
    const assets = persistFiles({
      files: queued.files,
      type: meta.type,
      prompt,
      model,
      params: { provider: "comfyui", ...vars },
      kind: meta.kind,
      prefer: meta.prefer,
    });
    if (feature === "voiceDesign" && assets[0]) {
      const voice = String(body.preferredName || body.prefix || "").trim() || `comfy-${Date.now()}`;
      upsertVoice({
        id: voice,
        name: String(body.preferredName || body.prefix || voice),
        prompt: String(body.voicePrompt || prompt),
        targetModel: String(body.targetModel || ""),
        designModel: model,
        createdAt: new Date().toISOString(),
        previewAssetId: assets[0].id,
      });
    }
    const task = createTask({
      type: taskTypeOf(feature),
      model,
      prompt,
      payload: { ...body, remoteKind: "comfy-done" },
    });
    return {
      task: mark(task.id, "succeeded", { assetIds: assets.map((a) => a.id), progress: 100 }),
      raw: queued.raw,
    };
  }
  const task = createTask({
    type: taskTypeOf(feature),
    model,
    prompt,
    remoteTaskId: queued.promptId,
    payload: { ...body, remoteKind: "comfy", feature, model, workflowId: body.workflowId },
  });
  return { task, raw: queued.raw };
}

export async function pollComfyTask(localId: string) {
  const { getTask } = await import("./tasks.js");
  const task = getTask(localId);
  if (!task?.remoteTaskId) return task;
  const feature = (task.payload.feature as FeatureId) || (
    task.type === "image" ? "image"
    : task.type === "video" ? "video"
    : task.type === "music" ? "music"
    : task.type === "audio" ? "tts"
    : "model3d"
  );
  try {
    const files = await runManagerHarvest(task.remoteTaskId);
    if (!files.length) return patchTask(localId, { status: "running", progress: Math.min(90, (task.progress || 10) + 8) });
    const meta = assetMeta(feature);
    const assets = persistFiles({
      files,
      type: meta.type,
      prompt: task.prompt,
      model: task.model,
      params: task.payload,
      kind: meta.kind,
      prefer: meta.prefer,
    });
    if (!assets.length) return mark(localId, "failed", { error: "ComfyUI 完成但未找到成品文件" });
    if (feature === "voiceDesign" && assets[0]) {
      const p = task.payload || {};
      const voice = String(p.preferredName || p.prefix || "").trim() || `comfy-${task.id}`;
      upsertVoice({
        id: voice,
        name: String(p.preferredName || p.prefix || voice),
        prompt: String(p.voicePrompt || task.prompt),
        targetModel: String(p.targetModel || ""),
        designModel: task.model,
        createdAt: new Date().toISOString(),
        previewAssetId: assets[0].id,
      });
    }
    return mark(localId, "succeeded", { assetIds: assets.map((a) => a.id), progress: 100 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/超时/.test(msg)) return patchTask(localId, { status: "running", progress: 40 });
    return mark(localId, "failed", { error: msg });
  }
}
