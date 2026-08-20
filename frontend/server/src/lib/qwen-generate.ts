import { basename, join } from "node:path";
import type {
  AssetRecord,
  FeatureId,
  Generate3dBody,
  GenerateImageBody,
  GenerateMusicBody,
  GenerateSfxBody,
  GenerateTtsBody,
  GenerateVideoBody,
  VoiceDesignBody,
} from "../types.js";
import { absPath, saveBuffer } from "./storage.js";
import { createTask, getTask, mark, patchTask } from "./tasks.js";
import { upsertVoice } from "./voices.js";
import {
  audioBase64Of,
  collectResultUrls,
  dashPost,
  downloadUrl,
  getDashTask,
  taskIdOf,
  taskStatusOf,
  uploadLocalFile,
  usesOss,
  DashScopeError,
} from "./dashscope.js";
import { qwenCatalog } from "./qwen-catalog.js";

function resolveLocal(value?: string) {
  if (!value || /^(https?:\/\/|data:|oss:\/\/)/i.test(value)) return undefined;
  return absPath(value.startsWith("uploads/") || value.includes("/") ? value : join("uploads", value));
}

async function toRemote(value: string | undefined, model: string): Promise<string | undefined> {
  if (!value) return undefined;
  if (/^(https?:\/\/|oss:\/\/|data:)/i.test(value)) return value;
  const local = resolveLocal(value);
  if (!local) return value;
  return uploadLocalFile(local, model);
}

function hasOss(...urls: Array<string | undefined>) {
  return urls.some((u) => usesOss(u));
}

function mimeOf(ext: string, type: AssetRecord["type"]) {
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "glb") return "model/gltf-binary";
  if (ext === "gltf") return "model/gltf+json";
  if (type === "image") return "image/png";
  if (type === "video") return "video/mp4";
  if (type === "model3d") return "model/gltf-binary";
  return "audio/mpeg";
}

function fallbackExt(type: AssetRecord["type"]) {
  if (type === "image") return "png";
  if (type === "video") return "mp4";
  if (type === "model3d") return "glb";
  return "mp3";
}

function pickUrls(urls: string[], type: AssetRecord["type"]) {
  if (type === "model3d") {
    const meshes = urls.filter((u) => !/\.(png|jpe?g|webp|gif)(\?|$)/i.test(u));
    return meshes.length ? meshes : urls;
  }
  if (type === "video") {
    const vids = urls.filter((u) => !/\.(png|jpe?g|webp|gif|mp3|wav)(\?|$)/i.test(u));
    return vids.length ? vids : urls;
  }
  if (type === "image") {
    const imgs = urls.filter((u) => !/\.(mp4|webm|mp3|wav|glb|gltf)(\?|$)/i.test(u));
    return imgs.length ? imgs : urls;
  }
  const audio = urls.filter((u) => !/\.(png|jpe?g|webp|gif|mp4|glb)(\?|$)/i.test(u));
  return audio.length ? audio : urls;
}

async function persistUrls(opts: {
  urls: string[];
  type: AssetRecord["type"];
  prompt: string;
  model: string;
  params: Record<string, unknown>;
  title?: string;
  tags?: string[];
  kind?: AssetRecord["kind"];
  remoteUrl?: string;
}): Promise<AssetRecord[]> {
  const urls = pickUrls(opts.urls, opts.type);
  const assets: AssetRecord[] = [];
  for (const url of urls) {
    const file = await downloadUrl(url);
    const ext = file.ext && file.ext !== "bin" ? file.ext : fallbackExt(opts.type);
    assets.push(
      saveBuffer({
        type: opts.type,
        buffer: file.buffer,
        ext,
        mime: file.mime && file.mime !== "application/octet-stream" ? file.mime : mimeOf(ext, opts.type),
        prompt: opts.prompt,
        model: opts.model,
        params: { provider: "qwen", ...opts.params },
        title: opts.title,
        tags: opts.tags,
        kind: opts.kind,
        remoteUrl: url,
      }),
    );
  }
  return assets;
}

async function persistBase64Audio(opts: {
  b64: string;
  prompt: string;
  model: string;
  params: Record<string, unknown>;
  title?: string;
  tags?: string[];
  kind?: AssetRecord["kind"];
}) {
  const buffer = Buffer.from(opts.b64, "base64");
  return saveBuffer({
    type: "audio",
    buffer,
    ext: "wav",
    mime: "audio/wav",
    prompt: opts.prompt,
    model: opts.model,
    params: { provider: "qwen", ...opts.params },
    title: opts.title,
    tags: opts.tags,
    kind: opts.kind,
  });
}

function defaultModel(feature: FeatureId, requested?: string) {
  const list =
    feature === "image" ? qwenCatalog.image
    : feature === "video" ? qwenCatalog.video
    : feature === "music" ? qwenCatalog.music
    : feature === "tts" ? qwenCatalog.tts
    : feature === "sfx" ? qwenCatalog.sfx
    : feature === "voiceDesign" ? qwenCatalog.voiceDesign
    : qwenCatalog.model3d;
  if (requested && list.some((m) => m.id === requested)) return requested;
  return list[0]?.id || requested || "";
}

function enqueueQwen(opts: {
  feature: FeatureId;
  type: AssetRecord["type"];
  model: string;
  prompt: string;
  remoteTaskId: string;
  body: Record<string, unknown>;
}) {
  const task = createTask({
    type: opts.type,
    model: opts.model,
    prompt: opts.prompt,
    remoteTaskId: opts.remoteTaskId,
    payload: { ...opts.body, remoteKind: "qwen", feature: opts.feature, model: opts.model },
  });
  return { task };
}

async function finishSync(opts: {
  feature: FeatureId;
  type: AssetRecord["type"];
  model: string;
  prompt: string;
  body: Record<string, unknown>;
  urls: string[];
  b64?: string;
  kind?: AssetRecord["kind"];
  title?: string;
  tags?: string[];
}) {
  let assets: AssetRecord[] = [];
  if (opts.b64 && !opts.urls.length) {
    assets = [await persistBase64Audio({
      b64: opts.b64,
      prompt: opts.prompt,
      model: opts.model,
      params: opts.body,
      title: opts.title,
      tags: opts.tags,
      kind: opts.kind,
    })];
  } else {
    assets = await persistUrls({
      urls: opts.urls,
      type: opts.type,
      prompt: opts.prompt,
      model: opts.model,
      params: opts.body,
      title: opts.title,
      tags: opts.tags,
      kind: opts.kind,
    });
  }
  if (!assets.length) throw new DashScopeError("千问已返回，但没有可落盘的成品地址", 502, "NO_OUTPUT");
  const task = createTask({
    type: opts.type,
    model: opts.model,
    prompt: opts.prompt,
    payload: { ...opts.body, remoteKind: "qwen-done", feature: opts.feature },
  });
  return {
    task: mark(task.id, "succeeded", { assetIds: assets.map((a) => a.id), progress: 100 }),
    assets,
  };
}

function isImage3(model: string) {
  return /qwen-image-3/i.test(model);
}

export async function generateImageQwen(body: GenerateImageBody) {
  const model = defaultModel("image", body.model);
  const images = await Promise.all((body.images || []).map((img) => toRemote(img, model)));
  const content: Array<Record<string, string>> = [];
  for (const img of images) if (img) content.push({ image: img });
  content.push({ text: body.prompt });
  const payload = {
    model,
    input: { messages: [{ role: "user", content }] },
    parameters: {
      size: body.size || "1024*1024",
      n: Math.min(Math.max(body.n || 1, 1), 6),
      prompt_extend: body.promptExtend ?? true,
      watermark: body.watermark ?? false,
      negative_prompt: body.negativePrompt || undefined,
      seed: body.seed,
      prompt_extend_mode: body.promptExtendMode,
      enable_thinking: body.enableThinking,
    },
  };
  const path = "/services/aigc/image-generation/generation";
  const oss = hasOss(...images);
  if (isImage3(model)) {
    const json = await dashPost(path, payload, { async: true, oss });
    const remote = taskIdOf(json);
    if (!remote) throw new DashScopeError("千问未返回 task_id", 502);
    return enqueueQwen({
      feature: "image",
      type: "image",
      model,
      prompt: body.prompt,
      remoteTaskId: remote,
      body: { ...body, model },
    });
  }
  const json = await dashPost("/services/aigc/multimodal-generation/generation", payload, { oss });
  const remote = taskIdOf(json);
  if (remote) {
    return enqueueQwen({
      feature: "image",
      type: "image",
      model,
      prompt: body.prompt,
      remoteTaskId: remote,
      body: { ...body, model },
    });
  }
  return finishSync({
    feature: "image",
    type: "image",
    model,
    prompt: body.prompt,
    body: { ...body, model },
    urls: collectResultUrls(json.output),
    kind: images.length ? "i2i" : "t2i",
    title: body.title,
    tags: body.tags,
  });
}

function videoSize(resolution?: string, ratio?: string) {
  const res = (resolution || "720P").toUpperCase();
  const r = ratio || "16:9";
  const table: Record<string, Record<string, string>> = {
    "480P": { "16:9": "832*480", "9:16": "480*832", "1:1": "624*624", "4:3": "832*624", "3:4": "624*832" },
    "720P": { "16:9": "1280*720", "9:16": "720*1280", "1:1": "960*960", "4:3": "1088*832", "3:4": "832*1088" },
    "1080P": { "16:9": "1920*1080", "9:16": "1080*1920", "1:1": "1440*1440", "4:3": "1632*1248", "3:4": "1248*1632" },
  };
  return (table[res] || table["720P"])[r] || table["720P"]["16:9"];
}

function pickVideoModel(model: string, body: GenerateVideoBody) {
  if (body.lastFrame && body.firstFrame && /-t2v|-i2v/.test(model) && /wan2\.[12]/.test(model)) {
    return model.replace(/-t2v|-i2v/, "-kf2v-plus").replace("wan2.2-kf2v-plus", "wan2.2-kf2v-flash");
  }
  if (body.firstFrame && model.includes("-t2v")) return model.replace("-t2v", "-i2v");
  if ((body.referenceImages?.length || body.referenceVideos?.length) && model.includes("-t2v")) {
    return model.replace("-t2v", "-r2v");
  }
  return model;
}

export async function generateVideoQwen(body: GenerateVideoBody) {
  const selected = defaultModel("video", body.model);
  const model = pickVideoModel(selected, body);
  const first = await toRemote(body.firstFrame, model);
  const last = await toRemote(body.lastFrame, model);
  const audio = await toRemote(body.audioUrl, model);
  const refs = await Promise.all([...(body.referenceImages || []), ...(body.referenceVideos || [])].map((x) => toRemote(x, model)));
  const input: Record<string, unknown> = {
    prompt: body.prompt,
    negative_prompt: body.negativePrompt || undefined,
  };
  if (first) {
    input.img_url = first;
    input.first_frame_url = first;
  }
  if (last) input.last_frame_url = last;
  if (audio) input.audio_url = audio;
  const media = refs.filter(Boolean);
  if (media.length) {
    input.reference_urls = media;
    input.media = media;
  }
  const modern = /wan2\.7|happyhorse/i.test(model);
  const parameters = modern
    ? {
        resolution: body.resolution || "720P",
        ratio: body.ratio || "16:9",
        duration: body.duration || 5,
        prompt_extend: body.promptExtend ?? true,
        watermark: body.watermark ?? false,
        audio: body.audio,
      }
    : {
        size: body.sizeHint || videoSize(body.resolution, body.ratio),
        duration: body.duration || 5,
        prompt_extend: body.promptExtend ?? true,
        watermark: body.watermark ?? false,
      };
  const json = await dashPost(
    "/services/aigc/video-generation/video-synthesis",
    { model, input, parameters },
    { async: true, oss: hasOss(first, last, audio, ...media.map(String)) },
  );
  const remote = taskIdOf(json);
  if (!remote) throw new DashScopeError("千问视频任务未返回 task_id", 502);
  return enqueueQwen({
    feature: "video",
    type: "video",
    model,
    prompt: body.prompt,
    remoteTaskId: remote,
    body: { ...body, model },
  });
}

export async function generateMusicQwen(body: GenerateMusicBody) {
  const model = defaultModel("music", body.model);
  const json = await dashPost("/services/audio/music/generation", {
    model,
    input: {
      prompt: body.prompt || undefined,
      lyrics: body.lyrics || undefined,
      gender: body.gender || "female",
      is_instrumental: Boolean(body.isInstrumental),
      format: body.format || "mp3",
      enable_aigc_watermark: Boolean(body.watermark),
    },
  });
  const remote = taskIdOf(json);
  const prompt = String(body.prompt || body.lyrics || "");
  if (remote) {
    return enqueueQwen({
      feature: "music",
      type: "music",
      model,
      prompt,
      remoteTaskId: remote,
      body: { ...body, model },
    });
  }
  return finishSync({
    feature: "music",
    type: "music",
    model,
    prompt,
    body: { ...body, model },
    urls: collectResultUrls(json.output),
    b64: audioBase64Of(json.output),
    kind: body.isInstrumental ? "instrumental" : "song",
    title: body.title,
    tags: body.tags,
  });
}

export async function generateTtsQwen(body: GenerateTtsBody) {
  const model = defaultModel("tts", body.model);
  const payload = {
    model,
    input: {
      text: body.text,
      voice: body.voice || "Cherry",
      language_type: body.languageType || "Chinese",
      instructions: body.instructions || undefined,
    },
  };
  const json = await dashPost("/services/aigc/multimodal-generation/generation", payload);
  const remote = taskIdOf(json);
  if (remote) {
    return enqueueQwen({
      feature: "tts",
      type: "audio",
      model,
      prompt: body.text,
      remoteTaskId: remote,
      body: { ...body, model },
    });
  }
  return finishSync({
    feature: "tts",
    type: "audio",
    model,
    prompt: body.text,
    body: { ...body, model },
    urls: collectResultUrls(json.output),
    b64: audioBase64Of(json.output),
    kind: "tts",
    title: body.title,
    tags: body.tags,
  });
}

export async function generateSfxQwen(body: GenerateSfxBody) {
  const model = defaultModel("sfx", body.model);
  if (model.startsWith("fun-music")) {
    const json = await dashPost("/services/audio/music/generation", {
      model,
      input: {
        prompt: `纯氛围音效，不要人声演唱：${body.prompt}`,
        is_instrumental: true,
        format: (body.format as "mp3" | "wav") || "mp3",
      },
    });
    const remote = taskIdOf(json);
    if (remote) {
      return enqueueQwen({
        feature: "sfx",
        type: "audio",
        model,
        prompt: body.prompt,
        remoteTaskId: remote,
        body: { ...body, model },
      });
    }
    return finishSync({
      feature: "sfx",
      type: "audio",
      model,
      prompt: body.prompt,
      body: { ...body, model },
      urls: collectResultUrls(json.output),
      b64: audioBase64Of(json.output),
      kind: "sfx",
      title: body.title,
      tags: body.tags,
    });
  }
  const json = await dashPost("/services/aigc/multimodal-generation/generation", {
    model,
    input: {
      messages: [
        {
          role: "user",
          content: [{ text: `请只生成音效音频，不要说话、不要旁白：${body.prompt}。时长约 ${body.duration || 6} 秒。` }],
        },
      ],
    },
    parameters: { modalities: ["audio", "text"] },
  });
  const remote = taskIdOf(json);
  if (remote) {
    return enqueueQwen({
      feature: "sfx",
      type: "audio",
      model,
      prompt: body.prompt,
      remoteTaskId: remote,
      body: { ...body, model },
    });
  }
  return finishSync({
    feature: "sfx",
    type: "audio",
    model,
    prompt: body.prompt,
    body: { ...body, model },
    urls: collectResultUrls(json.output),
    b64: audioBase64Of(json.output),
    kind: "sfx",
    title: body.title,
    tags: body.tags,
  });
}

export async function designVoiceQwen(body: VoiceDesignBody) {
  const model = defaultModel("voiceDesign", body.model);
  const target = body.targetModel || "qwen3-tts-vd-realtime-2026-01-15";
  const json = await dashPost("/services/audio/tts/customization", {
    model,
    input: {
      action: "create",
      target_model: target,
      voice_prompt: body.voicePrompt,
      preview_text: body.previewText || "雨停了。铜灯还亮着，巷子里只剩下水滴敲打石板的声音。",
      preferred_name: (body.preferredName || body.prefix || "voice").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 16) || "voice",
      language: body.language || "zh",
    },
  });
  const out = (json.output || {}) as Record<string, unknown>;
  const voiceId = String(out.voice || out.voice_id || out.preferred_name || body.preferredName || `qwen-${Date.now()}`);
  const urls = collectResultUrls(out);
  const b64 = audioBase64Of(out);
  let preview: AssetRecord | undefined;
  if (urls.length) {
    preview = (await persistUrls({
      urls,
      type: "audio",
      prompt: body.voicePrompt,
      model,
      params: { provider: "qwen", voice: voiceId, targetModel: target },
      kind: "voice-preview",
    }))[0];
  } else if (b64) {
    preview = await persistBase64Audio({
      b64,
      prompt: body.voicePrompt,
      model,
      params: { voice: voiceId, targetModel: target },
      kind: "voice-preview",
    });
  }
  const voice = upsertVoice({
    id: voiceId,
    name: body.preferredName || body.prefix || voiceId,
    prompt: body.voicePrompt,
    targetModel: String(out.target_model || target),
    designModel: model,
    createdAt: new Date().toISOString(),
    previewAssetId: preview?.id,
  });
  const task = createTask({
    type: "audio",
    model,
    prompt: body.voicePrompt,
    payload: { ...body, remoteKind: "qwen-done", feature: "voiceDesign" },
  });
  return {
    voice: voice.id,
    preview,
    assets: preview ? [preview] : [],
    task: mark(task.id, "succeeded", { assetIds: preview ? [preview.id] : [], progress: 100 }),
  };
}

export async function generate3dQwen(body: Generate3dBody) {
  const model = defaultModel("model3d", body.model);
  const images = await Promise.all((body.images || []).map((img) => toRemote(img, model)));
  const single = await toRemote(body.image, model);
  const input: Record<string, unknown> = {};
  if (images.filter(Boolean).length >= 2) input.images = images.filter(Boolean);
  else if (single || images[0]) input.image = single || images[0];
  else input.prompt = body.prompt || "";
  const json = await dashPost(
    "/services/aigc/video-generation/3d-generation",
    {
      model,
      input,
      parameters: {
        texture_quality: body.textureQuality || "standard",
        geometry_quality: body.geometryQuality || "standard",
        pbr: body.pbr ?? true,
        texture: body.texture ?? true,
      },
    },
    { async: true, oss: hasOss(single, ...images.map(String)) },
  );
  const remote = taskIdOf(json);
  if (!remote) throw new DashScopeError("千问 3D 任务未返回 task_id", 502);
  return enqueueQwen({
    feature: "model3d",
    type: "model3d",
    model,
    prompt: body.prompt || (single ? basename(single) : "image-to-3d"),
    remoteTaskId: remote,
    body: { ...body, model },
  });
}

function featureMeta(feature: FeatureId): { type: AssetRecord["type"]; kind: AssetRecord["kind"] } {
  if (feature === "video") return { type: "video", kind: "t2v" };
  if (feature === "music") return { type: "music", kind: "song" };
  if (feature === "model3d") return { type: "model3d", kind: "t23d" };
  if (feature === "tts") return { type: "audio", kind: "tts" };
  if (feature === "sfx") return { type: "audio", kind: "sfx" };
  if (feature === "voiceDesign") return { type: "audio", kind: "voice-preview" };
  return { type: "image", kind: "t2i" };
}

export async function pollQwenTask(localId: string) {
  const task = getTask(localId);
  if (!task?.remoteTaskId) return task;
  try {
    const json = await getDashTask(task.remoteTaskId);
    const status = taskStatusOf(json);
    if (status === "PENDING" || status === "RUNNING" || status === "UNKNOWN" || !status) {
      const progress = status === "RUNNING" ? Math.min(85, Math.max(20, (task.progress || 15) + 8)) : 12;
      return patchTask(localId, { status: "running", progress });
    }
    if (status === "FAILED" || status === "CANCELED") {
      const msg = String((json.output as { message?: string } | undefined)?.message || json.message || "千问任务失败");
      return mark(localId, "failed", { error: msg });
    }
    const urls = collectResultUrls(json.output);
    const b64 = audioBase64Of(json.output);
    const feature = (task.payload.feature as FeatureId) || "image";
    const meta = featureMeta(feature);
    let assets: AssetRecord[] = [];
    if (urls.length) {
      assets = await persistUrls({
        urls,
        type: meta.type,
        prompt: task.prompt,
        model: task.model,
        params: { provider: "qwen", ...task.payload },
        kind: meta.kind,
      });
    } else if (b64 && meta.type === "audio") {
      assets = [await persistBase64Audio({
        b64,
        prompt: task.prompt,
        model: task.model,
        params: task.payload,
        kind: meta.kind,
      })];
    }
    if (!assets.length) return mark(localId, "failed", { error: "千问任务完成但没有可下载的成品（结果链接可能已过期）" });
    if (feature === "voiceDesign" && assets[0]) {
      const p = task.payload || {};
      const voice = String(p.preferredName || p.prefix || "").trim() || `qwen-${task.id}`;
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
    if (/timeout|超时|ECONNRESET/i.test(msg)) return patchTask(localId, { status: "running", progress: 40 });
    return mark(localId, "failed", { error: msg });
  }
}
