import { basename } from "node:path";
import { loadSettings } from "../config.js";
import type { Generate3dBody } from "../types.js";
import { TRIPO_CATALOG, pickCatalogModel } from "./cloud-catalogs.js";
import { CloudError, asRecord, asString, cloudJson } from "./cloud-http.js";
import { localFile, persistRemoteUrls } from "./persist-remote.js";
import { createTask, getTask, mark, patchTask } from "./tasks.js";

function tripo() {
  const s = loadSettings().tripo;
  if (!s.apiKey) {
    throw new CloudError(
      "未配置 Tripo API Key。请到设置页填写，或在 https://www.tripo3d.ai/ 申请。这是 Tripo 官方 Key，不是千问云里的 Tripo。",
      400,
      "NO_API_KEY",
    );
  }
  return s;
}

function baseUrl() {
  return (tripo().baseUrl || "https://openapi.tripo3d.ai").replace(/\/+$/, "");
}

function authHeaders(json = true) {
  const headers: Record<string, string> = { Authorization: `Bearer ${tripo().apiKey}` };
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

function unwrap(json: Record<string, unknown>, label: string) {
  const code = json.code;
  if (code !== undefined && code !== 0 && code !== "0" && code !== "success") {
    throw new CloudError(`${label}：${asString(json.message) || asString(json.msg) || JSON.stringify(json).slice(0, 300)}`, 400, String(code), json);
  }
  return asRecord(json.data);
}

async function tripoPost(path: string, body: Record<string, unknown>) {
  const json = await cloudJson(`${baseUrl()}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  }, "Tripo");
  const data = unwrap(json, "Tripo");
  const id = asString(data.task_id) || asString(json.task_id);
  if (!id) throw new CloudError("Tripo 未返回 task_id", 502, "NO_TASK_ID", json);
  return id;
}

async function tripoGet(path: string) {
  return cloudJson(`${baseUrl()}${path}`, { method: "GET", headers: authHeaders() }, "Tripo");
}

async function uploadLocal(rel: string) {
  const file = localFile(rel);
  if (!file) return rel;
  const form = new FormData();
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const mime = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
  form.set("file", new Blob([new Uint8Array(file.buffer)], { type: mime }), file.name);
  const tryUrls = [`${baseUrl()}/v3/files`, "https://api.tripo3d.ai/v2/openapi/upload"];
  let last = "";
  for (const url of tryUrls) {
    try {
      const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${tripo().apiKey}` }, body: form });
      const text = await res.text();
      last = text;
      if (!res.ok) continue;
      const json = JSON.parse(text) as Record<string, unknown>;
      const data = asRecord(json.data);
      const token = asString(data.file_token) || asString(data.image_token) || asString(json.file_token);
      if (token) return token;
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
  }
  throw new CloudError(`Tripo 上传参考图失败：${last.slice(0, 400)}`, 502, "UPLOAD");
}

async function toInput(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  return uploadLocal(value);
}

function collectImages(body: Generate3dBody) {
  return [...(body.images || []), body.image].filter((v): v is string => Boolean(v));
}

export async function generate3dTripo(body: Generate3dBody) {
  const model = pickCatalogModel(TRIPO_CATALOG.model3d, body.model);
  const images = collectImages(body);
  const prompt = (body.prompt || "").trim();
  const extras = {
    model,
    texture: body.texture !== false,
    pbr: body.pbr ?? true,
    texture_quality: body.textureQuality === "detailed" ? "detailed" : "standard",
    geometry_quality: body.geometryQuality === "ultra" ? "detailed" : "standard",
  };
  let remote: string;
  if (images.length >= 2) {
    const tokens = await Promise.all(images.slice(0, 4).map(toInput));
    const views = ["front", "left", "back", "right"] as const;
    const input: Record<string, string> = {};
    tokens.forEach((token, i) => {
      input[views[i]] = token;
    });
    remote = await tripoPost("/v3/generation/multiview-to-model", { ...extras, input });
  } else if (images.length === 1) {
    remote = await tripoPost("/v3/generation/image-to-model", { ...extras, input: await toInput(images[0]) });
  } else {
    if (!prompt) throw new CloudError("文生 3D 请填写描述，或上传参考图。", 400);
    remote = await tripoPost("/v3/generation/text-to-model", { ...extras, prompt });
  }
  const task = createTask({
    type: "model3d",
    model,
    prompt: prompt || (images[0] ? basename(images[0]) : "image-to-3d"),
    remoteTaskId: remote,
    payload: { ...body, remoteKind: "tripo", model },
  });
  return { task };
}

function collectTripoUrls(output: Record<string, unknown>) {
  const keys = ["pbr_model", "model_url", "model", "base_model", "pbr_model_url"];
  const urls = keys.map((k) => asString(output[k])).filter(Boolean);
  const nested = asRecord(output.model);
  if (asString(nested.url)) urls.push(asString(nested.url));
  return [...new Set(urls)];
}

export async function pollTripoTask(localId: string) {
  const task = getTask(localId);
  if (!task?.remoteTaskId) return task;
  try {
    let json: Record<string, unknown>;
    try {
      json = await tripoGet(`/v3/tasks/${task.remoteTaskId}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/404|not found/i.test(msg)) throw err;
      json = await cloudJson(
        `https://api.tripo3d.ai/v2/openapi/task/${task.remoteTaskId}`,
        { method: "GET", headers: authHeaders() },
        "Tripo",
      );
    }
    const data = asRecord(json.data).task_id ? asRecord(json.data) : (asString(json.task_id) ? json : asRecord(json.data));
    const status = asString(data.status).toLowerCase();
    if (!status || status === "queued" || status === "running" || status === "pending" || status === "unknown") {
      const progress = Number(data.progress);
      const next = Number.isFinite(progress) && progress > 0 ? Math.min(90, progress) : Math.min(80, Math.max(12, (task.progress || 10) + 6));
      return patchTask(localId, { status: "running", progress: next });
    }
    if (status === "failed" || status === "cancelled" || status === "canceled" || status === "banned") {
      return mark(localId, "failed", { error: asString(data.message) || asString(json.message) || "Tripo 任务失败" });
    }
    if (status !== "success" && status !== "succeeded" && status !== "completed") {
      return patchTask(localId, { status: "running", progress: Math.min(80, (task.progress || 10) + 4) });
    }
    const urls = collectTripoUrls(asRecord(data.output));
    if (!urls.length) return mark(localId, "failed", { error: "Tripo 任务完成但没有可下载的模型（链接约 5 分钟失效，视铸会立刻下载）" });
    const assets = await persistRemoteUrls({
      urls: urls.slice(0, 1),
      type: "model3d",
      prompt: task.prompt,
      model: task.model,
      provider: "tripo",
      params: task.payload,
      kind: "t23d",
    });
    if (!assets.length) return mark(localId, "failed", { error: "Tripo 成品下载失败" });
    return mark(localId, "succeeded", { assetIds: assets.map((a) => a.id), progress: 100 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout|超时|ECONNRESET|429/i.test(msg)) return patchTask(localId, { status: "running", progress: 40 });
    return mark(localId, "failed", { error: msg });
  }
}
