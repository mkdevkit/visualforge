import { loadSettings } from "../config.js";
import type { Generate3dBody, GenerateImageBody } from "../types.js";
import { MESHY_CATALOG, pickCatalogModel } from "./cloud-catalogs.js";
import { CloudError, asRecord, asString, cloudJson } from "./cloud-http.js";
import { persistRemoteUrls, toDataUri } from "./persist-remote.js";
import { createTask, getTask, mark, patchTask } from "./tasks.js";

function meshy() {
  const s = loadSettings().meshy;
  if (!s.apiKey) {
    throw new CloudError(
      "未配置 Meshy API Key。请到设置页填写，或在 https://www.meshy.ai/zh 申请。Key 形如 msy_…",
      400,
      "NO_API_KEY",
    );
  }
  return s;
}

function baseUrl() {
  return (meshy().baseUrl || "https://api.meshy.ai").replace(/\/+$/, "");
}

function headers() {
  return {
    Authorization: `Bearer ${meshy().apiKey}`,
    "Content-Type": "application/json",
  };
}

async function meshyPost(path: string, body: Record<string, unknown>) {
  const json = await cloudJson(`${baseUrl()}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  }, "Meshy");
  const id = asString(json.result) || asString(json.id);
  if (!id) throw new CloudError("Meshy 未返回任务 id", 502, "NO_TASK_ID", json);
  return id;
}

async function meshyGet(path: string) {
  return cloudJson(`${baseUrl()}${path}`, { method: "GET", headers: headers() }, "Meshy");
}

function aspectRatio(size: string | undefined, model: string) {
  const raw = (size || "1:1").trim();
  let ratio = /^\d+:\d+$/.test(raw) ? raw : "";
  if (!ratio) {
    const hit = raw.match(/(\d+)\s*[x*×]\s*(\d+)/i);
    if (hit) {
      const w = Number(hit[1]);
      const h = Number(hit[2]);
      const r = w / Math.max(h, 1);
      ratio = Math.abs(r - 1) < 0.08 ? "1:1"
        : r > 1.7 ? "16:9"
        : r < 0.6 ? "9:16"
        : r > 1.15 ? "4:3"
        : "3:4";
    } else ratio = "1:1";
  }
  if (model === "gpt-image-2") {
    if (ratio === "16:9" || ratio === "4:3") return "3:2";
    if (ratio === "9:16" || ratio === "3:4") return "2:3";
    if (ratio === "3:2" || ratio === "2:3" || ratio === "1:1") return ratio;
    return "1:1";
  }
  if (["1:1", "16:9", "9:16", "4:3", "3:4"].includes(ratio)) return ratio;
  return "1:1";
}

function collectImages(body: { image?: string; images?: string[] }) {
  return [...(body.images || []), body.image].filter((v): v is string => Boolean(v));
}

function enqueue(opts: {
  type: "image" | "model3d";
  model: string;
  prompt: string;
  remoteTaskId: string;
  pollPath: string;
  body: Record<string, unknown>;
  meshyStage?: string;
}) {
  const task = createTask({
    type: opts.type,
    model: opts.model,
    prompt: opts.prompt,
    remoteTaskId: opts.remoteTaskId,
    payload: {
      ...opts.body,
      remoteKind: "meshy",
      pollPath: opts.pollPath,
      meshyStage: opts.meshyStage || "",
      model: opts.model,
    },
  });
  return { task };
}

export async function generateImageMeshy(body: GenerateImageBody) {
  const model = pickCatalogModel(MESHY_CATALOG.image, body.model);
  const refs = (body.images || []).map(toDataUri);
  const prompt = body.prompt.trim();
  if (!prompt) throw new CloudError("请填写提示词", 400);
  const payload: Record<string, unknown> = {
    ai_model: model,
    prompt,
    aspect_ratio: aspectRatio(body.size, model),
  };
  const path = refs.length ? "/openapi/v1/image-to-image" : "/openapi/v1/text-to-image";
  if (refs.length) payload.reference_image_urls = refs;
  const remote = await meshyPost(path, payload);
  return enqueue({
    type: "image",
    model,
    prompt,
    remoteTaskId: remote,
    pollPath: path,
    body: { ...body, model },
  });
}

function textureResolution(quality?: string) {
  if (quality === "ultra") return "8k";
  if (quality === "detailed") return "4k";
  return "2k";
}

export async function generate3dMeshy(body: Generate3dBody) {
  const model = pickCatalogModel(MESHY_CATALOG.model3d, body.model);
  const images = collectImages(body).map(toDataUri);
  const prompt = (body.prompt || "").trim();
  const shouldTexture = body.texture !== false;
  const enablePbr = body.pbr ?? true;
  const ultra = body.geometryQuality === "ultra";
  if (images.length >= 2) {
    const remote = await meshyPost("/openapi/v1/multi-image-to-3d", {
      image_urls: images.slice(0, 4),
      ai_model: model,
      should_texture: shouldTexture,
      enable_pbr: enablePbr,
      texture_resolution: textureResolution(body.textureQuality),
      texture_prompt: prompt || undefined,
      target_formats: ["glb"],
      ultra_mode: ultra || undefined,
    });
    return enqueue({
      type: "model3d",
      model,
      prompt: prompt || "multi-image-to-3d",
      remoteTaskId: remote,
      pollPath: "/openapi/v1/multi-image-to-3d",
      body: { ...body, model },
    });
  }
  if (images.length === 1) {
    const remote = await meshyPost("/openapi/v1/image-to-3d", {
      image_url: images[0],
      ai_model: model,
      should_texture: shouldTexture,
      enable_pbr: enablePbr,
      texture_resolution: textureResolution(body.textureQuality),
      texture_prompt: prompt || undefined,
      target_formats: ["glb"],
      ultra_mode: ultra || undefined,
    });
    return enqueue({
      type: "model3d",
      model,
      prompt: prompt || "image-to-3d",
      remoteTaskId: remote,
      pollPath: "/openapi/v1/image-to-3d",
      body: { ...body, model },
    });
  }
  if (!prompt) throw new CloudError("文生 3D 请填写描述，或上传参考图。", 400);
  const remote = await meshyPost("/openapi/v2/text-to-3d", {
    mode: "preview",
    prompt,
    ai_model: model,
    target_formats: ["glb"],
    ultra_mode: ultra || undefined,
  });
  return enqueue({
    type: "model3d",
    model,
    prompt,
    remoteTaskId: remote,
    pollPath: "/openapi/v2/text-to-3d",
    body: { ...body, model, wantRefine: shouldTexture, enablePbr },
    meshyStage: "preview",
  });
}

function meshyStatus(json: Record<string, unknown>) {
  return asString(json.status).toUpperCase();
}

function collectMeshyUrls(json: Record<string, unknown>, type: "image" | "model3d") {
  if (type === "image") {
    const list = json.image_urls;
    if (Array.isArray(list)) return list.filter((u): u is string => typeof u === "string");
    return [];
  }
  const models = asRecord(json.model_urls);
  const urls = [asString(models.glb), asString(models.gltf), asString(models.fbx)].filter(Boolean);
  if (urls.length) return urls;
  const nested = asRecord(json.model_url);
  const single = asString(json.model_url) || asString(nested.glb);
  return single ? [single] : [];
}

async function startRefine(localId: string, previewId: string, payload: Record<string, unknown>) {
  const remote = await meshyPost("/openapi/v2/text-to-3d", {
    mode: "refine",
    preview_task_id: previewId,
    enable_pbr: payload.enablePbr !== false,
    target_formats: ["glb"],
  });
  return patchTask(localId, {
    remoteTaskId: remote,
    progress: 55,
    status: "running",
    payload: { ...payload, meshyStage: "refine", pollPath: "/openapi/v2/text-to-3d" },
  });
}

export async function pollMeshyTask(localId: string) {
  const task = getTask(localId);
  if (!task?.remoteTaskId) return task;
  const pollPath = asString(task.payload?.pollPath) || "/openapi/v1/text-to-image";
  try {
    const json = await meshyGet(`${pollPath}/${task.remoteTaskId}`);
    const status = meshyStatus(json);
    if (!status || status === "PENDING" || status === "IN_PROGRESS") {
      const progress = Number(json.progress);
      const next = Number.isFinite(progress) && progress > 0 ? Math.min(90, progress) : Math.min(80, Math.max(12, (task.progress || 10) + 6));
      return patchTask(localId, { status: "running", progress: next });
    }
    if (status === "FAILED" || status === "CANCELED") {
      const err = asRecord(json.task_error);
      const msg = asString(err.message) || asString(json.message) || "Meshy 任务失败";
      return mark(localId, "failed", { error: msg });
    }
    if (status !== "SUCCEEDED") {
      return patchTask(localId, { status: "running", progress: Math.min(80, (task.progress || 10) + 4) });
    }
    const stage = asString(task.payload?.meshyStage);
    if (task.type === "model3d" && stage === "preview" && task.payload?.wantRefine !== false) {
      return startRefine(localId, task.remoteTaskId, task.payload);
    }
    const urls = collectMeshyUrls(json, task.type === "model3d" ? "model3d" : "image");
    if (!urls.length) return mark(localId, "failed", { error: "Meshy 任务完成但没有可下载的成品地址" });
    const assets = await persistRemoteUrls({
      urls,
      type: task.type,
      prompt: task.prompt,
      model: task.model,
      provider: "meshy",
      params: task.payload,
      kind: task.type === "model3d" ? (stage === "preview" ? "t23d" : "t23d") : "t2i",
    });
    if (!assets.length) return mark(localId, "failed", { error: "Meshy 成品下载失败" });
    return mark(localId, "succeeded", { assetIds: assets.map((a) => a.id), progress: 100 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout|超时|ECONNRESET|429/i.test(msg)) return patchTask(localId, { status: "running", progress: 40 });
    return mark(localId, "failed", { error: msg });
  }
}
