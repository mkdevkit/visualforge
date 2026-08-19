import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { existsSync, readFileSync } from "node:fs";
import { extname } from "node:path";
import { loadSettings, saveSettings, ensureDataLayout } from "./config.js";
import { ComfyError, pingComfy } from "./lib/comfy.js";
import { FEATURE_LABELS } from "./lib/features.js";
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
  const statusRaw = err instanceof ComfyError ? err.status : 500;
  const status = ([400, 401, 403, 404, 500, 502] as const).includes(statusRaw as 400) ? (statusRaw as 400 | 401 | 403 | 404 | 500 | 502) : 500;
  return c.json(
    {
      ok: false,
      error: err.message,
      code: err instanceof ComfyError ? err.code : "INTERNAL",
    },
    status,
  );
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
    engine: "ComfyUI",
    dataDir: s.dataDir,
    managerUrl: s.managerUrl,
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

function publicSettings() {
  const s = loadSettings();
  return {
    ...s,
    comfy: {
      ...s.comfy,
      apiKey: s.comfy.apiKey ? `${s.comfy.apiKey.slice(0, 4)}••••` : "",
    },
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
  const patch: { managerUrl?: string; dataDir?: string } = {};
  if (typeof body.managerUrl === "string") patch.managerUrl = body.managerUrl.replace(/\/+$/, "");
  if (typeof body.dataDir === "string") patch.dataDir = body.dataDir;
  saveSettings(patch);
  return c.json({ ok: true, settings: publicSettings() });
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

app.post("/api/images/generate", async (c) => {
  const body = await c.req.json();
  const result = await generateImage(body);
  return c.json({ ok: true, ...result });
});

app.post("/api/videos/generate", async (c) => {
  const body = await c.req.json();
  const result = await generateVideo(body);
  return c.json({ ok: true, ...result });
});

app.post("/api/music/generate", async (c) => {
  const body = await c.req.json();
  const result = await generateMusic(body);
  return c.json({ ok: true, ...result });
});

app.post("/api/audio/tts", async (c) => {
  const body = await c.req.json();
  const result = await generateTts(body);
  return c.json({ ok: true, ...result });
});

app.post("/api/audio/sfx", async (c) => {
  const body = await c.req.json();
  const result = await generateSfx(body);
  return c.json({ ok: true, ...result });
});

app.post("/api/audio/voices", async (c) => {
  const body = await c.req.json();
  const result = await designVoice(body);
  return c.json({ ok: true, ...result, voices: loadVoices() });
});

app.get("/api/audio/voices", (c) => c.json({ ok: true, voices: loadVoices() }));

app.delete("/api/audio/voices/:voice", (c) => {
  const voices = removeVoice(c.req.param("voice"));
  return c.json({ ok: true, voices });
});

app.post("/api/3d/generate", async (c) => {
  const body = await c.req.json();
  const result = await generate3d(body);
  return c.json({ ok: true, ...result });
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
    info: { title: "VisualForge Local API", version: "0.2.0", description: "ComfyUI 本地多模态工坊" },
    servers: [{ url: `http://${loadSettings().host}:${loadSettings().port}` }],
    paths: {
      "/api/health": { get: { summary: "健康检查" } },
      "/api/models": { get: { summary: "从 ComfyManager 读取模型目录" } },
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
  return s;
}
