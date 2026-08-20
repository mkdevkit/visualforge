import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { spawn } from "node:child_process";
import { loadSettings, saveSettings, ensureDataLayout, isPlaceholderSecret, FRONTEND_ROOT, userConfigDir } from "./config.js";
import { initStore, storePath } from "./lib/db.js";
import type { AppSettings } from "./types.js";
import { ComfyError, pingComfy } from "./lib/comfy.js";
import { DashScopeError } from "./lib/dashscope.js";
import { CloudError } from "./lib/cloud-http.js";
import { MESHY_CATALOG, MESHY_IMAGE_SIZES, MIDJOURNEY_CATALOG, TRIPO_CATALOG, VOLCENGINE_CATALOG, VOLC_IMAGE_SIZES } from "./lib/cloud-catalogs.js";
import { qwenCatalog } from "./lib/qwen-catalog.js";
import { FEATURE_LABELS } from "./lib/features.js";
import { publicProviders, PROVIDER_IDS } from "./lib/providers.js";
import { fetchManagerRuntime, managerUrl } from "./lib/manager-client.js";
import { mcpEndpoint } from "./mcp.js";
import { deleteAsset, getAsset, loadLibrary, saveUpload, scanOrphans, absPath, updateAsset } from "./lib/storage.js";
import { rigAndAnimateAsset, rigEngineStatus, type RigEngine } from "./lib/auto-rig.js";
import { loadVoices, removeVoice } from "./lib/voices.js";
import { getTask, loadTasks } from "./lib/tasks.js";
import {
  designVoice,
  generate3d,
  generateImage,
  generateMusic,
  generateSfx,
  generateTts,
  generateVideo,
  pollRemoteTask,
} from "./lib/generate.js";

export const app = new Hono();

app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"], allowHeaders: ["Content-Type", "Authorization"] }));
app.use("/api/*", bodyLimit({ maxSize: 80 * 1024 * 1024 }));

app.onError((err, c) => {
  const typed = err instanceof ComfyError || err instanceof DashScopeError || err instanceof CloudError;
  const statusRaw = typed ? err.status : 500;
  const status = ([400, 401, 403, 404, 500, 502] as const).includes(statusRaw as 400)
    ? (statusRaw as 400 | 401 | 403 | 404 | 500 | 502)
    : statusRaw >= 400 && statusRaw < 500
      ? 400
      : 502;
  return c.json(
    {
      ok: false,
      error: err.message,
      code: err instanceof ComfyError ? err.code : err instanceof DashScopeError || err instanceof CloudError ? err.code : "INTERNAL",
      detail: err instanceof DashScopeError || err instanceof CloudError ? err.raw : undefined,
    },
    status,
  );
});

app.get("/api/ping", (c) => {
  const s = loadSettings();
  return c.json({
    ok: true,
    engine: "VisualForge",
    tools: PROVIDER_IDS,
    port: s.port,
    pid: process.pid,
    qwen: { configured: Boolean(s.qwen.apiKey) },
    meshy: { configured: Boolean(s.meshy.apiKey) },
    midjourney: { configured: Boolean(s.midjourney.apiKey), gateway: Boolean(s.midjourney.baseUrl) },
    tripo: { configured: Boolean(s.tripo.apiKey) },
    volcengine: { configured: Boolean(s.volcengine.apiKey), music: Boolean(s.volcengine.accessKeyId && s.volcengine.secretKey) },
  });
});

function isLoopbackHost(c: { req: { header: (name: string) => string | undefined } }) {
  const host = (c.req.header("host") || "").split(":")[0].replace(/^\[|\]$/g, "");
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

app.post("/api/server/restart", (c) => {
  if (!isLoopbackHost(c)) return c.json({ ok: false, error: "只允许本机重启生成服务" }, 403);
  const script = join(FRONTEND_ROOT, "scripts/restart-api.cjs");
  const child = spawn(process.execPath, [script, String(loadSettings().port)], {
    cwd: FRONTEND_ROOT,
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: process.env,
  });
  child.unref();
  return c.json({ ok: true, restarting: true });
});

app.get("/api/health", async (c) => {
  const s = loadSettings();
  let manager: unknown = { ok: false };
  try {
    manager = await fetchManagerRuntime();
  } catch (err) {
    manager = { ok: false, error: err instanceof Error ? err.message : String(err), url: managerUrl() };
  }
  return c.json({
    ok: true,
    name: "VisualForge",
    engine: "VisualForge",
    tools: PROVIDER_IDS,
    engines: s.engines,
    providers: publicProviders(),
    dataDir: s.dataDir,
    storePath: storePath(s.dataDir),
    managerUrl: s.managerUrl,
    qwen: { configured: Boolean(s.qwen.apiKey), baseUrl: s.qwen.baseUrl },
    meshy: { configured: Boolean(s.meshy.apiKey), baseUrl: s.meshy.baseUrl },
    midjourney: { configured: Boolean(s.midjourney.apiKey), gateway: Boolean(s.midjourney.baseUrl) },
    tripo: { configured: Boolean(s.tripo.apiKey), baseUrl: s.tripo.baseUrl },
    volcengine: {
      configured: Boolean(s.volcengine.apiKey),
      music: Boolean(s.volcengine.accessKeyId && s.volcengine.secretKey),
      baseUrl: s.volcengine.baseUrl,
    },
    manager,
    mcp: {
      url: mcpEndpoint(s.host, s.port),
      transport: "streamable-http",
      stdio: "npm run mcp -w @visualforge/frontend",
    },
    rig: await rigEngineStatus(),
  });
});

app.get("/api/models", async (c) => {
  try {
    const runtime = await fetchManagerRuntime(true);
    return c.json({
      ok: true,
      ...runtime.catalog,
      activeModels: runtime.activeModels,
      features: runtime.catalog?.features || runtime.features,
      featureLabels: runtime.featureLabels,
      managerUrl: managerUrl(),
    });
  } catch (err) {
    return c.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 502);
  }
});

function maskSecret(value: string) {
  if (!value) return "";
  return `${value.slice(0, 4)}••••`;
}

function publicSettings() {
  const s = loadSettings();
  return {
    ...s,
    configDir: userConfigDir(),
    storePath: storePath(s.dataDir),
    comfy: {
      ...s.comfy,
      apiKey: maskSecret(s.comfy.apiKey),
    },
    qwen: {
      ...s.qwen,
      apiKey: maskSecret(s.qwen.apiKey),
      configured: Boolean(s.qwen.apiKey),
    },
    meshy: {
      ...s.meshy,
      apiKey: maskSecret(s.meshy.apiKey),
      configured: Boolean(s.meshy.apiKey),
    },
    midjourney: {
      ...s.midjourney,
      apiKey: maskSecret(s.midjourney.apiKey),
      configured: Boolean(s.midjourney.apiKey),
    },
    tripo: {
      ...s.tripo,
      apiKey: maskSecret(s.tripo.apiKey),
      configured: Boolean(s.tripo.apiKey),
    },
    volcengine: {
      ...s.volcengine,
      apiKey: maskSecret(s.volcengine.apiKey),
      accessKeyId: maskSecret(s.volcengine.accessKeyId),
      secretKey: maskSecret(s.volcengine.secretKey),
      configured: Boolean(s.volcengine.apiKey),
      musicConfigured: Boolean(s.volcengine.accessKeyId && s.volcengine.secretKey),
    },
    providers: publicProviders(),
  };
}

app.get("/api/settings", (c) => {
  return c.json({
    ok: true,
    settings: publicSettings(),
    featureLabels: FEATURE_LABELS,
  });
});

app.put("/api/settings", async (c) => {
  const body = await c.req.json();
  const patch: Parameters<typeof saveSettings>[0] = {};
  if (typeof body.managerUrl === "string") patch.managerUrl = body.managerUrl.replace(/\/+$/, "");
  if (typeof body.dataDir === "string") patch.dataDir = body.dataDir;
  if (body.qwen && typeof body.qwen === "object") {
    const q = body.qwen as { apiKey?: string; workspaceId?: string; baseUrl?: string };
    patch.qwen = {};
    if (typeof q.apiKey === "string" && !isPlaceholderSecret(q.apiKey)) patch.qwen.apiKey = q.apiKey.trim();
    if (typeof q.workspaceId === "string") patch.qwen.workspaceId = q.workspaceId;
    if (typeof q.baseUrl === "string") patch.qwen.baseUrl = q.baseUrl.replace(/\/+$/, "");
  }
  for (const id of ["meshy", "midjourney", "tripo"] as const) {
    const raw = body[id];
    if (!raw || typeof raw !== "object") continue;
    const cloud = raw as { apiKey?: string; baseUrl?: string };
    patch[id] = {};
    if (typeof cloud.apiKey === "string" && !isPlaceholderSecret(cloud.apiKey)) patch[id]!.apiKey = cloud.apiKey.trim();
    if (typeof cloud.baseUrl === "string") patch[id]!.baseUrl = cloud.baseUrl.replace(/\/+$/, "");
  }
  if (body.volcengine && typeof body.volcengine === "object") {
    const v = body.volcengine as { apiKey?: string; baseUrl?: string; accessKeyId?: string; secretKey?: string };
    patch.volcengine = {};
    if (typeof v.apiKey === "string" && !isPlaceholderSecret(v.apiKey)) patch.volcengine.apiKey = v.apiKey.trim();
    if (typeof v.baseUrl === "string") patch.volcengine.baseUrl = v.baseUrl.replace(/\/+$/, "");
    if (typeof v.accessKeyId === "string" && !isPlaceholderSecret(v.accessKeyId)) patch.volcengine.accessKeyId = v.accessKeyId.trim();
    if (typeof v.secretKey === "string" && !isPlaceholderSecret(v.secretKey)) patch.volcengine.secretKey = v.secretKey.trim();
  }
  if (body.engines && typeof body.engines === "object") {
    patch.engines = body.engines as AppSettings["engines"];
  }
  saveSettings(patch);
  return c.json({ ok: true, settings: publicSettings() });
});

app.get("/api/qwen/models", (c) => {
  return c.json({ ok: true, ...qwenCatalog });
});

app.get("/api/cloud/models", (c) => {
  return c.json({
    ok: true,
    meshy: { ...MESHY_CATALOG, imageSizes: MESHY_IMAGE_SIZES },
    midjourney: MIDJOURNEY_CATALOG,
    tripo: TRIPO_CATALOG,
    volcengine: { ...VOLCENGINE_CATALOG, imageSizes: VOLC_IMAGE_SIZES },
  });
});

app.get("/api/qwen/ping", (c) => {
  const s = loadSettings();
  if (!s.qwen.apiKey) {
    return c.json({ ok: false, error: "未配置千问 API Key。请到设置页填写，或访问 https://www.qianwenai.com/ 申请。" }, 400);
  }
  return c.json({ ok: true, baseUrl: s.qwen.baseUrl, workspace: Boolean(s.qwen.workspaceId), platform: "https://www.qianwenai.com/" });
});

app.get("/api/comfy/ping", async (c) => {
  const url = c.req.query("baseUrl");
  return c.json(await pingComfy(url || undefined));
});

app.post("/api/upload", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return c.json({ ok: false, error: "缺少 file" }, 400);
  const buf = Buffer.from(await file.arrayBuffer());
  const saved = saveUpload(buf, file.name);
  return c.json({ ok: true, file: { ...saved, url: `/api/files/${saved.relPath}` } });
});

function generatePayload(result: { task?: { assetIds?: string[] }; assets?: unknown[]; raw?: unknown; [key: string]: unknown }) {
  const { raw: _raw, ...rest } = result;
  const assets = Array.isArray(rest.assets) && rest.assets.length
    ? rest.assets
    : (rest.task?.assetIds || []).map((id) => getAsset(id)).filter(Boolean);
  return { ...rest, assets };
}

app.post("/api/images/generate", async (c) => {
  const body = await c.req.json();
  return c.json({ ok: true, ...generatePayload(await generateImage(body)) });
});

app.post("/api/videos/generate", async (c) => {
  const body = await c.req.json();
  return c.json({ ok: true, ...generatePayload(await generateVideo(body)) });
});

app.post("/api/music/generate", async (c) => {
  const body = await c.req.json();
  return c.json({ ok: true, ...generatePayload(await generateMusic(body)) });
});

app.post("/api/audio/tts", async (c) => {
  const body = await c.req.json();
  return c.json({ ok: true, ...generatePayload(await generateTts(body)) });
});

app.post("/api/audio/sfx", async (c) => {
  const body = await c.req.json();
  return c.json({ ok: true, ...generatePayload(await generateSfx(body)) });
});

app.post("/api/audio/voices", async (c) => {
  const body = await c.req.json();
  return c.json({ ok: true, ...generatePayload(await designVoice(body)), voices: loadVoices() });
});

app.get("/api/audio/voices", (c) => c.json({ ok: true, voices: loadVoices() }));

app.delete("/api/audio/voices/:voice", (c) => {
  const voices = removeVoice(c.req.param("voice"));
  return c.json({ ok: true, voices });
});

app.post("/api/3d/generate", async (c) => {
  const body = await c.req.json();
  return c.json({ ok: true, ...generatePayload(await generate3d(body)) });
});

app.get("/api/3d/rig-status", async (c) => c.json({ ok: true, ...(await rigEngineStatus()) }));

app.post("/api/3d/rig", async (c) => {
  const body = await c.req.json();
  const id = String(body.assetId || "");
  if (!id) return c.json({ ok: false, error: "缺少 assetId" }, 400);
  const engine = (body.engine || "auto") as RigEngine;
  if (!["auto", "unirig", "mixamo", "bbox"].includes(engine)) {
    return c.json({ ok: false, error: "未知绑骨引擎" }, 400);
  }
  const animationRelPaths = Array.isArray(body.animationRelPaths)
    ? body.animationRelPaths.map((p: unknown) => String(p))
    : [];
  const asset = await rigAndAnimateAsset(id, { engine, animationRelPaths });
  return c.json({ ok: true, asset });
});

app.get("/api/tasks", (c) => c.json({ ok: true, tasks: loadTasks() }));

app.get("/api/tasks/:id", async (c) => {
  const id = c.req.param("id");
  let task = getTask(id);
  if (!task) return c.json({ ok: false, error: "任务不存在" }, 404);
  if (task.status === "running" || task.status === "queued") {
    task = (await pollRemoteTask(id)) || task;
  }
  return c.json({ ok: true, task });
});

app.post("/api/tasks/:id/refresh", async (c) => {
  const task = await pollRemoteTask(c.req.param("id"));
  if (!task) return c.json({ ok: false, error: "任务不存在" }, 404);
  return c.json({ ok: true, task });
});

app.get("/api/assets", (c) => {
  const type = c.req.query("type");
  const q = (c.req.query("q") || "").toLowerCase();
  const favorite = c.req.query("favorite");
  let list = loadLibrary();
  if (type) list = list.filter((a) => a.type === type);
  if (favorite === "true") list = list.filter((a) => a.favorite);
  if (q) {
    list = list.filter((a) =>
      [a.title, a.prompt, a.model, a.tags.join(" ")].join(" ").toLowerCase().includes(q),
    );
  }
  return c.json({ ok: true, assets: list, orphans: scanOrphans() });
});

app.get("/api/assets/:id", (c) => {
  const asset = getAsset(c.req.param("id"));
  if (!asset) return c.json({ ok: false, error: "资源不存在" }, 404);
  return c.json({ ok: true, asset });
});

app.patch("/api/assets/:id", async (c) => {
  const body = await c.req.json();
  const allowed = ["title", "notes", "tags", "favorite"] as const;
  const patch: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in body) patch[key] = body[key];
  }
  const asset = updateAsset(c.req.param("id"), patch);
  if (!asset) return c.json({ ok: false, error: "资源不存在" }, 404);
  return c.json({ ok: true, asset });
});

app.delete("/api/assets/:id", (c) => {
  const ok = deleteAsset(c.req.param("id"));
  if (!ok) return c.json({ ok: false, error: "资源不存在" }, 404);
  return c.json({ ok: true });
});

const mimeMap: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
};

app.get("/api/files/*", (c) => {
  const rel = decodeURIComponent(c.req.path.replace("/api/files/", ""));
  if (rel.includes("..")) return c.json({ ok: false, error: "非法路径" }, 400);
  const full = absPath(rel);
  if (!existsSync(full)) return c.json({ ok: false, error: "文件不存在" }, 404);
  const buf = readFileSync(full);
  const ext = extname(full).toLowerCase();
  return new Response(buf, {
    headers: {
      "Content-Type": mimeMap[ext] || "application/octet-stream",
      "Content-Disposition": `inline; filename="${rel.split("/").pop()}"`,
      "Cache-Control": "public, max-age=31536000",
    },
  });
});

app.get("/api/openapi.json", (c) => {
  return c.json({
    openapi: "3.0.3",
    info: { title: "VisualForge Local API", version: "0.3.0", description: "视铸本地多模态工坊：ComfyUI / 千问 / Meshy / Midjourney / Tripo" },
    servers: [{ url: `http://${loadSettings().host}:${loadSettings().port}` }],
    paths: {
      "/api/health": { get: { summary: "健康检查" } },
      "/api/models": { get: { summary: "从 ComfyManager 读取 ComfyUI 模型目录" } },
      "/api/qwen/models": { get: { summary: "千问云模型目录（与 ComfyUI 目录分开）" } },
      "/api/cloud/models": { get: { summary: "Meshy / Midjourney / Tripo 静态目录" } },
      "/api/upload": { post: { summary: "上传参考文件" } },
      "/api/images/generate": { post: { summary: "生图 / 图生图" } },
      "/api/videos/generate": { post: { summary: "生视频（异步）" } },
      "/api/music/generate": { post: { summary: "生音乐" } },
      "/api/audio/tts": { post: { summary: "配音 / TTS" } },
      "/api/audio/sfx": { post: { summary: "音效生成" } },
      "/api/audio/voices": { get: { summary: "本机音色" }, post: { summary: "音色设计" } },
      "/api/audio/voices/{voice}": { delete: { summary: "删除设计角色" } },
      "/api/3d/generate": { post: { summary: "生 3D（异步）" } },
      "/api/3d/rig-status": { get: { summary: "UniRig / Mixamo 绑骨引擎状态" } },
      "/api/3d/rig": { post: { summary: "绑骨导出 GLB：UniRig / Mixamo / 几何估骨" } },
      "/api/tasks": { get: { summary: "任务列表" } },
      "/api/assets": { get: { summary: "资源库" } },
    },
  });
});

export function startTaskPump() {
  setInterval(() => {
    const running = loadTasks().filter((t) => t.status === "running" || t.status === "queued");
    for (const t of running) {
      pollRemoteTask(t.id).catch((err) => {
        console.error("[task]", t.id, err);
      });
    }
  }, 4000);
}

export function prepare() {
  const s = loadSettings();
  ensureDataLayout(s.dataDir);
  initStore();
  return s;
}
