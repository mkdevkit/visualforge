import { Hono } from "hono";
import { cors } from "hono/cors";
import { bodyLimit } from "hono/body-limit";
import { loadSettings, publicSettings, saveSettings, ensureLayout } from "./config.ts";
import { FEATURE_IDS, FEATURE_LABELS } from "./types.ts";
import type { FeatureId } from "./types.ts";
import { modelCatalog, deleteModel } from "./catalog.ts";
import { cancelDownload, loadDownloads, startDownload } from "./download.ts";
import { comfyStatus, isInstallRunning, readComfyLog, readInstallLog, startComfy, startInstallComfy, stopComfy, writeExtraModelPaths } from "./deploy.ts";
import { installUniRig, runUniRigFromBuffer, unirigStatus } from "./unirig.ts";
import { pingComfy } from "./ping.ts";
import { parseGenerateRequest, runGenerate, harvestPrompt } from "./generate.ts";
import {
  assignWorkflowToFeature,
  hydrateFeatures,
  importWorkflowJson,
  importWorkflowZip,
  listComfyWorkflows,
  readWorkflowJson,
  zipWorkflows,
  deleteWorkflowFiles,
} from "./comfy-workflows.ts";

ensureLayout(loadSettings().dataDir, loadSettings().comfy.modelsDir);

export const app = new Hono();

app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"], allowHeaders: ["Content-Type", "Authorization"] }));
app.use("/api/*", bodyLimit({ maxSize: 80 * 1024 * 1024 }));

app.onError((err, c) => {
  return c.json({ ok: false, error: err.message }, 500);
});

app.get("/api/health", async (c) => {
  const s = loadSettings();
  return c.json({
    ok: true,
    name: "ComfyManager",
    dataDir: s.dataDir,
    comfy: await comfyStatus(),
    unirig: unirigStatus(),
  });
});

app.get("/api/settings", (c) => c.json({ ok: true, settings: publicSettings(), featureLabels: FEATURE_LABELS }));

app.put("/api/settings", async (c) => {
  const body = await c.req.json();
  if (body.comfy && typeof body.comfy.apiKey === "string" && body.comfy.apiKey.includes("•")) delete body.comfy.apiKey;
  if (body.comfy && typeof body.comfy.hfToken === "string" && body.comfy.hfToken.includes("•")) delete body.comfy.hfToken;
  saveSettings(body);
  writeExtraModelPaths();
  return c.json({ ok: true, settings: publicSettings() });
});

app.get("/api/comfy/ping", async (c) => {
  const url = c.req.query("baseUrl") || loadSettings().comfy.baseUrl;
  return c.json(await pingComfy(url));
});

app.get("/api/comfy/status", async (c) => c.json({ ok: true, ...(await comfyStatus()), unirig: unirigStatus() }));
app.get("/api/comfy/install-log", (c) => {
  try {
    return c.json({ ok: true, ...readInstallLog() });
  } catch (err) {
    return c.json({
      ok: true,
      text: "",
      installing: isInstallRunning(),
      truncated: false,
      path: "",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
app.get("/api/comfy/log", (c) => {
  try {
    return c.json({ ok: true, ...readComfyLog() });
  } catch (err) {
    return c.json({
      ok: true,
      text: "",
      truncated: false,
      path: "",
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
app.post("/api/comfy/install", (c) => c.json(startInstallComfy()));
app.post("/api/comfy/start", (c) => c.json({ ...startComfy(), ok: true }));
app.post("/api/comfy/stop", (c) => c.json({ ...stopComfy(), ok: true }));
app.post("/api/tools/unirig/install", async (c) => c.json({ ...(await installUniRig()), ok: true }));
app.get("/api/tools/unirig", (c) => c.json({ ok: true, ...unirigStatus() }));
app.post("/api/tools/unirig/run", async (c) => {
  const form = await c.req.formData();
  const file = form.get("file");
  if (!file || typeof file !== "object" || typeof (file as File).arrayBuffer !== "function") {
    return c.json({ ok: false, error: "缺少 file（GLB）" }, 400);
  }
  const out = await runUniRigFromBuffer(Buffer.from(await (file as File).arrayBuffer()));
  return new Response(new Uint8Array(out), {
    headers: {
      "Content-Type": "model/gltf-binary",
      "Content-Disposition": "attachment; filename=rigged.glb",
    },
  });
});

app.get("/api/comfy/workflows", (c) => c.json({ ok: true, ...listComfyWorkflows() }));
app.get("/api/comfy/workflows/file", (c) => {
  const path = String(c.req.query("path") || "");
  if (!path) return c.json({ ok: false, error: "缺少 path" }, 400);
  return c.json({ ok: true, ...readWorkflowJson(path) });
});
app.post("/api/comfy/workflows/assign", async (c) => {
  const body = await c.req.json();
  const path = String(body.path || "");
  const featureId = String(body.featureId || "");
  if (!path || !featureId) return c.json({ ok: false, error: "需要 path 和 featureId" }, 400);
  return c.json(await assignWorkflowToFeature(path, featureId, body.inject !== false));
});
app.post("/api/comfy/workflows/delete", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const paths = Array.isArray((body as { paths?: string[] }).paths)
    ? (body as { paths: string[] }).paths
    : String((body as { path?: string }).path || "")
      ? [String((body as { path: string }).path)]
      : [];
  return c.json({ ok: true, ...deleteWorkflowFiles(paths) });
});
app.post("/api/comfy/workflows/zip", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const paths = Array.isArray((body as { paths?: string[] }).paths) ? (body as { paths: string[] }).paths : undefined;
  const buf = await zipWorkflows(paths);
  return new Response(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="comfy-workflows.zip"`,
    },
  });
});
app.post("/api/comfy/workflows/import", async (c) => {
  const form = await c.req.formData();
  const files = form.getAll("file").filter((f) => f && typeof f === "object" && typeof (f as File).arrayBuffer === "function") as File[];
  if (!files.length) return c.json({ ok: false, error: "请选择 .json 或 .zip" }, 400);
  const imported: string[] = [];
  const skipped: string[] = [];
  for (const file of files) {
    const name = file.name || "upload";
    const buf = Buffer.from(await file.arrayBuffer());
    if (name.toLowerCase().endsWith(".zip")) {
      const r = await importWorkflowZip(buf);
      imported.push(...r.imported);
      skipped.push(...r.skipped);
    } else if (name.toLowerCase().endsWith(".json")) {
      imported.push(importWorkflowJson(name, buf.toString("utf8")));
    } else {
      skipped.push(name);
    }
  }
  if (!imported.length) return c.json({ ok: false, error: "没有导入任何工作流" }, 400);
  return c.json({ ok: true, imported, skipped, ...listComfyWorkflows() });
});

app.get("/api/endpoint", async (c) => {
  const status = await comfyStatus();
  const s = loadSettings();
  return c.json({
    ok: true,
    baseUrl: s.comfy.baseUrl,
    listenHost: s.comfy.listenHost,
    listenPort: s.comfy.listenPort,
    connected: status.api.ok,
    processRunning: status.processRunning,
  });
});

app.get("/api/models", (c) => c.json({ ok: true, ...modelCatalog() }));
app.get("/api/models/downloads", (c) => c.json({ ok: true, jobs: loadDownloads() }));

app.post("/api/models/:id/download", (c) => {
  const job = startDownload(c.req.param("id"));
  return c.json({ ok: true, job });
});

app.delete("/api/models/:id", (c) => {
  const result = deleteModel(c.req.param("id"));
  return c.json({ ok: true, ...result });
});

app.post("/api/models/downloads/:id/cancel", (c) => {
  const job = cancelDownload(c.req.param("id"));
  if (!job) return c.json({ ok: false, error: "任务不存在" }, 404);
  return c.json({ ok: true, job });
});

app.get("/api/active-models", (c) => c.json({ ok: true, activeModels: loadSettings().activeModels }));

app.put("/api/active-models", async (c) => {
  const body = await c.req.json();
  const patch = (body.activeModels || body) as Record<string, string>;
  const current = loadSettings().activeModels;
  const next = { ...current };
  for (const id of FEATURE_IDS) {
    if (typeof patch[id] === "string") next[id] = patch[id];
  }
  saveSettings({ activeModels: next });
  return c.json({ ok: true, activeModels: next });
});

app.get("/api/runtime", async (c) => {
  const s = loadSettings();
  const status = await comfyStatus();
  const catalog = modelCatalog();
  return c.json({
    ok: true,
    comfy: {
      baseUrl: s.comfy.baseUrl,
      apiKey: s.comfy.apiKey,
      connected: status.api.ok,
      processRunning: status.processRunning,
    },
    activeModels: s.activeModels,
    features: await hydrateFeatures(s.features),
    featureLabels: FEATURE_LABELS,
    catalog,
    unirig: unirigStatus(),
  });
});

app.post("/api/generate", async (c) => {
  const req = await parseGenerateRequest(c);
  return c.json(await runGenerate(req));
});
app.get("/api/generate/:promptId", async (c) => c.json(await harvestPrompt(c.req.param("promptId"))));

app.get("/api/features", (c) => {
  const s = loadSettings();
  return c.json({ ok: true, features: s.features, featureLabels: FEATURE_LABELS, activeModels: s.activeModels });
});

app.put("/api/features", async (c) => {
  const body = await c.req.json();
  const next = saveSettings({ features: body.features || body });
  return c.json({ ok: true, features: next.features, activeModels: next.activeModels });
});
