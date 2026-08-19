import { join } from "node:path";
import { nanoid } from "nanoid";
import type { AssetRecord, FeatureId, GenerateImageBody, GenerateMusicBody, GenerateSfxBody, GenerateTtsBody, GenerateVideoBody, Generate3dBody, VoiceDesignBody } from "../types.js";
import { absPath, saveBuffer } from "./storage.js";
import { createTask, mark, patchTask } from "./tasks.js";
import { upsertVoice } from "./voices.js";
import { harvestComfy, queueComfyPrompt, runComfyHttp, runComfyPrompt, type ComfyFile } from "./comfy.js";
import { HTTP_BODY_TEMPLATES } from "./features.js";
import { activeModel, featureFromManager, fetchManagerRuntime, resolveModelName } from "./manager-client.js";

export async function featureCfg(feature: FeatureId) {
  return { comfy: await featureFromManager(feature) };
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

async function runSync(feature: FeatureId, body: AnyBody) {
  await fetchManagerRuntime().catch(() => undefined);
  const route = await featureCfg(feature);
  const model = resolveModelName(String(body.model || activeModel(feature) || ""), route.comfy.model) || "comfyui";
  const vars = varsFrom(feature, body, model);
  const uploads = uploadsOf(body);
  const result =
    route.comfy.mode === "http"
      ? await runComfyHttp(route.comfy, feature, vars)
      : await runComfyPrompt(route.comfy, feature, vars, uploads);
  const meta = assetMeta(feature);
  const prompt = String(vars.prompt || "");
  const assets = persistFiles({
    files: result.files,
    type: meta.type,
    prompt,
    model,
    params: { provider: "comfyui", ...vars },
    title: typeof body.title === "string" ? body.title : undefined,
    tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
    kind: meta.kind,
    prefer: meta.prefer,
  });
  if (!assets.length) {
    throw new Error(`ComfyUI 未返回可用成品。请检查工作流是否包含 Save 节点，或 http 接口是否返回 url / base64。${route.comfy.mode === "http" ? "" : ` 可参考占位符：${Object.keys(HTTP_BODY_TEMPLATES).join(", ")}`}`);
  }
  return { assets, raw: result.raw, voice: result.voice, model };
}

export async function generateImageComfy(body: GenerateImageBody) {
  const r = await runSync("image", asVarsBody(body));
  if (body.images?.length && r.assets[0]) r.assets[0].kind = "i2i";
  return r;
}

export async function generateMusicComfy(body: GenerateMusicBody) {
  return runSync("music", asVarsBody(body));
}

export async function generateTtsComfy(body: GenerateTtsBody) {
  return runSync("tts", asVarsBody({ ...body, prompt: body.text }));
}

export async function generateSfxComfy(body: GenerateSfxBody) {
  return runSync("sfx", asVarsBody(body));
}

export async function designVoiceComfy(body: VoiceDesignBody) {
  const r = await runSync("voiceDesign", asVarsBody({ ...body, prompt: body.voicePrompt }));
  const voice = r.voice || `comfy-${nanoid(8)}`;
  upsertVoice({
    id: voice,
    name: body.preferredName || body.prefix || voice,
    prompt: body.voicePrompt,
    targetModel: body.targetModel || r.model,
    designModel: r.model,
    createdAt: new Date().toISOString(),
    previewAssetId: r.assets[0]?.id,
  });
  return { voice, preview: r.assets[0], raw: r.raw, assets: r.assets };
}

export async function generateVideoComfy(body: GenerateVideoBody) {
  return enqueueOrSync("video", asVarsBody(body), body.prompt);
}

export async function generate3dComfy(body: Generate3dBody) {
  return enqueueOrSync("model3d", asVarsBody(body), body.prompt || "");
}

async function enqueueOrSync(feature: FeatureId, body: AnyBody, prompt: string) {
  await fetchManagerRuntime().catch(() => undefined);
  const route = await featureCfg(feature);
  const model = resolveModelName(String(body.model || activeModel(feature) || ""), route.comfy.model) || "comfyui";
  if (route.comfy.mode === "http") {
    const r = await runSync(feature, body);
    const task = createTask({
      type: feature === "model3d" ? "model3d" : "video",
      model,
      prompt,
      payload: { ...body, remoteKind: "comfy-done" },
    });
    return {
      task: mark(task.id, "succeeded", { assetIds: r.assets.map((a) => a.id), progress: 100 }),
      raw: r.raw,
    };
  }
  const vars = varsFrom(feature, body, model);
  const queued = await queueComfyPrompt(route.comfy, feature, vars, uploadsOf(body));
  const task = createTask({
      type: feature === "model3d" ? "model3d" : "video",
    model,
    prompt,
    remoteTaskId: queued.promptId,
    payload: { ...body, remoteKind: "comfy", feature, model },
  });
  return { task, raw: queued.raw };
}

export async function pollComfyTask(localId: string) {
  const { getTask } = await import("./tasks.js");
  const task = getTask(localId);
  if (!task?.remoteTaskId) return task;
  const feature = (task.payload.feature as FeatureId) || (task.type === "video" ? "video" : "model3d");
  const cfg = (await featureCfg(feature)).comfy;
  try {
    const files = await harvestComfy(cfg, task.remoteTaskId);
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
    return mark(localId, "succeeded", { assetIds: assets.map((a) => a.id), progress: 100 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/超时/.test(msg)) return patchTask(localId, { status: "running", progress: 40 });
    return mark(localId, "failed", { error: msg });
  }
}
