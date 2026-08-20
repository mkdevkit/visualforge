import { loadSettings } from "../config.js";
import type { GenerateImageBody, GenerateMusicBody, GenerateVideoBody } from "../types.js";
import { VOLCENGINE_CATALOG, pickCatalogModel } from "./cloud-catalogs.js";
import { CloudError, asRecord, asString, cloudJson } from "./cloud-http.js";
import { persistRemoteUrls, toDataUri } from "./persist-remote.js";
import { createTask, getTask, mark, patchTask } from "./tasks.js";
import { saveBuffer } from "./storage.js";
import { volcOpenApi } from "./volc-sign.js";

function volc() {
  return loadSettings().volcengine;
}

function arkAuth() {
  const s = volc();
  if (!s.apiKey) {
    throw new CloudError(
      "未配置火山方舟 API Key。请到设置页填写，或在 https://console.volcengine.com/ark 申请。",
      400,
      "NO_API_KEY",
    );
  }
  return s;
}

function musicAuth() {
  const s = volc();
  if (!s.accessKeyId || !s.secretKey) {
    throw new CloudError(
      "生音乐需要火山引擎 Access Key ID / Secret（账号密钥，不是方舟 API Key）。请到设置页填写，开通见 https://www.volcengine.com/docs/84992/1404668",
      400,
      "NO_ACCESS_KEY",
    );
  }
  return s;
}

function arkBase() {
  return (arkAuth().baseUrl || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/+$/, "");
}

function arkHeaders() {
  return {
    Authorization: `Bearer ${arkAuth().apiKey}`,
    "Content-Type": "application/json",
  };
}

function arkSize(size?: string) {
  const raw = (size || "2K").trim();
  if (/^[24][kK]$/.test(raw)) return raw.toUpperCase();
  const hit = raw.match(/(\d+)\s*[x*×]\s*(\d+)/i);
  if (hit) return `${hit[1]}x${hit[2]}`;
  return "2K";
}

function finish(opts: {
  type: "image" | "video" | "music";
  model: string;
  prompt: string;
  body: Record<string, unknown>;
  urls: string[];
  kind?: "t2i" | "i2i" | "t2v" | "i2v" | "song" | "instrumental";
  title?: string;
  tags?: string[];
}) {
  return persistRemoteUrls({
    urls: opts.urls,
    type: opts.type,
    prompt: opts.prompt,
    model: opts.model,
    provider: "volcengine",
    params: opts.body,
    kind: opts.kind,
    title: opts.title,
    tags: opts.tags,
  }).then(async (assets) => {
    if (!assets.length) throw new CloudError("火山引擎已返回，但没有可落盘的成品地址", 502, "NO_OUTPUT");
    const task = createTask({
      type: opts.type,
      model: opts.model,
      prompt: opts.prompt,
      payload: { ...opts.body, remoteKind: "volcengine-done" },
    });
    return {
      task: mark(task.id, "succeeded", { assetIds: assets.map((a) => a.id), progress: 100 }),
      assets,
    };
  });
}

function enqueue(opts: {
  type: "image" | "video" | "music";
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
    payload: { ...opts.body, remoteKind: "volcengine", model: opts.model },
  });
  return { task };
}

export async function generateImageVolc(body: GenerateImageBody) {
  const model = pickCatalogModel(VOLCENGINE_CATALOG.image, body.model);
  const prompt = body.prompt.trim();
  if (!prompt) throw new CloudError("请填写提示词", 400);
  const refs = (body.images || []).map(toDataUri);
  const n = Math.min(Math.max(body.n || 1, 1), 15);
  const payload: Record<string, unknown> = {
    model,
    prompt,
    size: arkSize(body.size),
    response_format: "url",
    watermark: body.watermark ?? false,
    sequential_image_generation: n > 1 ? "auto" : "disabled",
  };
  if (n > 1) payload.sequential_image_generation_options = { max_images: n };
  if (refs.length === 1) payload.image = refs[0];
  else if (refs.length > 1) payload.image = refs;
  const json = await cloudJson(`${arkBase()}/images/generations`, {
    method: "POST",
    headers: arkHeaders(),
    body: JSON.stringify(payload),
  }, "火山方舟");
  const data = Array.isArray(json.data) ? json.data : [];
  const urls = data.map((item) => asString(asRecord(item).url)).filter(Boolean);
  const b64 = data.map((item) => asString(asRecord(item).b64_json)).filter(Boolean);
  if (urls.length) {
    return finish({
      type: "image",
      model,
      prompt,
      body: { ...body, model },
      urls,
      kind: refs.length ? "i2i" : "t2i",
      title: body.title,
      tags: body.tags,
    });
  }
  if (b64.length) {
    const assets = b64.map((raw) => saveBuffer({
      type: "image",
      buffer: Buffer.from(raw, "base64"),
      ext: "png",
      mime: "image/png",
      prompt,
      model,
      params: { provider: "volcengine", ...body },
      title: body.title,
      tags: body.tags,
      kind: refs.length ? "i2i" : "t2i",
    }));
    const task = createTask({
      type: "image",
      model,
      prompt,
      payload: { ...body, remoteKind: "volcengine-done", model },
    });
    return { task: mark(task.id, "succeeded", { assetIds: assets.map((a) => a.id), progress: 100 }), assets };
  }
  throw new CloudError("火山方舟生图没有返回图片地址", 502, "NO_OUTPUT", json);
}

export async function generateVideoVolc(body: GenerateVideoBody) {
  const model = pickCatalogModel(VOLCENGINE_CATALOG.video, body.model);
  const prompt = body.prompt.trim();
  if (!prompt) throw new CloudError("请填写提示词", 400);
  const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
  if (body.firstFrame) {
    content.push({ type: "image_url", image_url: { url: toDataUri(body.firstFrame) }, role: "first_frame" });
  }
  if (body.lastFrame) {
    content.push({ type: "image_url", image_url: { url: toDataUri(body.lastFrame) }, role: "last_frame" });
  }
  for (const img of body.referenceImages || []) {
    content.push({ type: "image_url", image_url: { url: toDataUri(img) }, role: "reference_image" });
  }
  const json = await cloudJson(`${arkBase()}/contents/generations/tasks`, {
    method: "POST",
    headers: arkHeaders(),
    body: JSON.stringify({
      model,
      content,
      resolution: (body.resolution || "720P").toLowerCase(),
      ratio: body.ratio || "16:9",
      duration: Math.min(Math.max(body.duration || 5, 2), 15),
      watermark: body.watermark ?? false,
      generate_audio: body.audio ?? true,
    }),
  }, "火山方舟");
  const remote = asString(json.id) || asString(json.task_id) || asString(asRecord(json.data).id);
  if (!remote) throw new CloudError("火山方舟未返回视频任务 id", 502, "NO_TASK_ID", json);
  return enqueue({
    type: "video",
    model,
    prompt,
    remoteTaskId: remote,
    body: { ...body, model, volcKind: "video" },
  });
}

export async function generateMusicVolc(body: GenerateMusicBody) {
  const auth = musicAuth();
  const instrumental = Boolean(body.isInstrumental) || body.model === "gen-bgm";
  const prompt = String(body.prompt || body.lyrics || "").trim();
  if (!prompt) throw new CloudError("请填写风格提示词或歌词", 400);
  const model = instrumental ? "gen-bgm" : pickCatalogModel(VOLCENGINE_CATALOG.music, body.model) || "gen-song";
  if (instrumental || model === "gen-bgm") {
    const json = await volcOpenApi({
      action: "GenBGM",
      accessKeyId: auth.accessKeyId,
      secretKey: auth.secretKey,
      body: { Text: prompt, Duration: 60 },
    });
    const result = asRecord(json.Result);
    const remote = asString(result.TaskID) || asString(json.TaskID);
    if (!remote) throw new CloudError("火山引擎未返回音乐任务 id", 502, "NO_TASK_ID", json);
    return enqueue({
      type: "music",
      model: "gen-bgm",
      prompt,
      remoteTaskId: remote,
      body: { ...body, model: "gen-bgm", volcKind: "bgm" },
    });
  }
  const payload: Record<string, unknown> = {};
  if (body.lyrics?.trim()) payload.Lyrics = body.lyrics.trim();
  else payload.Prompt = prompt;
  if (body.gender === "male") payload.Gender = "Male";
  if (body.gender === "female") payload.Gender = "Female";
  const json = await volcOpenApi({
    action: "GenSongV4",
    accessKeyId: auth.accessKeyId,
    secretKey: auth.secretKey,
    body: payload,
  });
  const result = asRecord(json.Result);
  const remote = asString(result.TaskID) || asString(json.TaskID);
  if (!remote) throw new CloudError("火山引擎未返回歌曲任务 id", 502, "NO_TASK_ID", json);
  return enqueue({
    type: "music",
    model: "gen-song",
    prompt,
    remoteTaskId: remote,
    body: { ...body, model: "gen-song", volcKind: "song" },
  });
}

function videoUrlOf(json: Record<string, unknown>) {
  const content = json.content;
  if (typeof content === "string" && /^https?:\/\//i.test(content)) return content;
  const rec = asRecord(content);
  return asString(rec.video_url) || asString(asRecord(rec.video).url) || asString(json.video_url);
}

async function pollVideo(localId: string, remoteId: string) {
  const json = await cloudJson(`${arkBase()}/contents/generations/tasks/${remoteId}`, {
    method: "GET",
    headers: arkHeaders(),
  }, "火山方舟");
  const status = asString(json.status).toLowerCase();
  if (!status || status === "queued" || status === "running" || status === "pending") {
    const progress = Number(json.progress);
    const next = Number.isFinite(progress) && progress > 0 ? Math.min(90, progress) : undefined;
    return patchTask(localId, { status: "running", progress: next ?? Math.min(80, Math.max(12, (getTask(localId)?.progress || 10) + 6)) });
  }
  if (status === "failed" || status === "cancelled" || status === "canceled") {
    const err = asRecord(json.error);
    return mark(localId, "failed", { error: asString(err.message) || asString(json.message) || "火山方舟视频任务失败" });
  }
  if (status !== "succeeded" && status !== "success") {
    return patchTask(localId, { status: "running", progress: 50 });
  }
  const url = videoUrlOf(json);
  if (!url) return mark(localId, "failed", { error: "火山方舟视频完成但没有下载地址（链接约 24 小时失效，视铸会立刻下载）" });
  const task = getTask(localId);
  const assets = await persistRemoteUrls({
    urls: [url],
    type: "video",
    prompt: task?.prompt || "",
    model: task?.model || "",
    provider: "volcengine",
    params: task?.payload,
    kind: "t2v",
  });
  if (!assets.length) return mark(localId, "failed", { error: "火山方舟视频下载失败" });
  return mark(localId, "succeeded", { assetIds: assets.map((a) => a.id), progress: 100 });
}

async function pollMusic(localId: string, remoteId: string, kind: string) {
  const auth = musicAuth();
  const action = kind === "bgm" ? "QueryBGM" : "QuerySong";
  let json: Record<string, unknown>;
  try {
    json = await volcOpenApi({
      action,
      accessKeyId: auth.accessKeyId,
      secretKey: auth.secretKey,
      body: { TaskID: remoteId },
    });
  } catch (err) {
    if (action !== "QuerySong") {
      json = await volcOpenApi({
        action: "QuerySong",
        accessKeyId: auth.accessKeyId,
        secretKey: auth.secretKey,
        body: { TaskID: remoteId },
      });
    } else {
      throw err;
    }
  }
  const result = asRecord(json.Result);
  const status = Number(result.Status);
  const progress = Number(result.Progress);
  if (status === 0 || status === 1 || Number.isNaN(status)) {
    return patchTask(localId, {
      status: "running",
      progress: Number.isFinite(progress) && progress > 0 ? Math.min(90, progress) : Math.min(80, Math.max(12, (getTask(localId)?.progress || 10) + 6)),
    });
  }
  if (status === 3) {
    const fail = asRecord(result.FailureReason);
    return mark(localId, "failed", { error: asString(fail.Msg) || asString(json.Message) || "火山引擎音乐任务失败" });
  }
  const detail = asRecord(result.SongDetail);
  const url = asString(detail.AudioUrl) || asString(result.AudioUrl) || asString(asRecord(result.BGMDetail).AudioUrl);
  if (!url) return mark(localId, "failed", { error: "火山引擎音乐完成但没有音频地址" });
  const task = getTask(localId);
  const assets = await persistRemoteUrls({
    urls: [url],
    type: "music",
    prompt: task?.prompt || "",
    model: task?.model || "",
    provider: "volcengine",
    params: task?.payload,
    kind: kind === "bgm" ? "instrumental" : "song",
  });
  if (!assets.length) return mark(localId, "failed", { error: "火山引擎音频下载失败" });
  return mark(localId, "succeeded", { assetIds: assets.map((a) => a.id), progress: 100 });
}

export async function pollVolcTask(localId: string) {
  const task = getTask(localId);
  if (!task?.remoteTaskId) return task;
  try {
    const kind = asString(task.payload?.volcKind);
    if (kind === "song" || kind === "bgm") return pollMusic(localId, task.remoteTaskId, kind);
    return pollVideo(localId, task.remoteTaskId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout|超时|ECONNRESET|429/i.test(msg)) return patchTask(localId, { status: "running", progress: 40 });
    return mark(localId, "failed", { error: msg });
  }
}
