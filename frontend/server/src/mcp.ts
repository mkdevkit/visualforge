import { existsSync, readFileSync } from "node:fs";
import { basename, isAbsolute } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadSettings } from "./config.js";
import { storePath } from "./lib/db.js";
import { FEATURE_IDS, FEATURE_LABELS } from "./lib/features.js";
import { fetchManagerRuntime, managerUrl } from "./lib/manager-client.js";
import { pingComfy } from "./lib/comfy.js";
import { deleteAsset, getAsset, loadLibrary, saveUpload, updateAsset } from "./lib/storage.js";
import { rigAndAnimateAsset, rigEngineStatus } from "./lib/auto-rig.js";
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
import type { AssetRecord } from "./types.js";

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorResult(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

async function waitForTaskAssets(result: {
  task?: { id: string; status: string; error?: string; assetIds?: string[] };
  assets?: AssetRecord[];
}) {
  let task = result.task;
  const start = Date.now();
  while (task && (task.status === "running" || task.status === "queued") && Date.now() - start < 300000) {
    await new Promise((r) => setTimeout(r, 2000));
    task = (await pollRemoteTask(task.id)) || task;
  }
  if (task?.status === "failed") throw new Error(task.error || "生成失败");
  const assets = (
    Array.isArray(result.assets) && result.assets.length
      ? result.assets
      : (task?.assetIds || []).map((id) => getAsset(id)).filter(Boolean)
  ) as AssetRecord[];
  return { task, assets };
}

function fileUrl(relPath: string) {
  const s = loadSettings();
  return `http://${s.host}:${s.port}/api/files/${relPath}`;
}

function assetOut(a: AssetRecord) {
  return {
    id: a.id,
    type: a.type,
    kind: a.kind,
    title: a.title,
    prompt: a.prompt,
    model: a.model,
    relPath: a.relPath,
    url: fileUrl(a.relPath),
    createdAt: a.createdAt,
  };
}

function ingestPath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  if (/^(https?:\/\/|data:)/i.test(trimmed)) return trimmed;
  if (existsSync(trimmed) && isAbsolute(trimmed)) {
    const buf = readFileSync(trimmed);
    return saveUpload(buf, basename(trimmed)).relPath;
  }
  return trimmed;
}

export function createVisualForgeMcp() {
  const server = new McpServer({
    name: "visualforge",
    version: "0.1.0",
  });

  server.registerResource(
    "status",
    "visualforge://status",
    { description: "视铸健康状态与 ComfyManager 连接", mimeType: "application/json" },
    async () => ({
      contents: [
        {
          uri: "visualforge://status",
          mimeType: "application/json",
          text: JSON.stringify(await statusSnapshot(), null, 2),
        },
      ],
    }),
  );

  server.registerResource(
    "models",
    "visualforge://models",
    { description: "各工位可用模型（来自 ComfyManager）", mimeType: "application/json" },
    async () => ({
      contents: [
        {
          uri: "visualforge://models",
          mimeType: "application/json",
          text: JSON.stringify(await modelsSnapshot(), null, 2),
        },
      ],
    }),
  );

  server.registerTool(
    "get_status",
    { description: "视铸生成服务、ComfyManager、ComfyUI 是否可用", inputSchema: {} },
    async () => jsonResult(await statusSnapshot()),
  );

  server.registerTool(
    "list_models",
    {
      description: "列出各工位主模型。生成前可用来选 model id。",
      inputSchema: {
        feature: z.enum(["image", "video", "music", "tts", "sfx", "voiceDesign", "model3d", "anim3d"]).optional(),
      },
    },
    async ({ feature }) => {
      const snap = await modelsSnapshot();
      if (!feature) return jsonResult(snap);
      return jsonResult({
        managerUrl: snap.managerUrl,
        active: snap.activeModels[feature] || "",
        models: snap.stations[feature] || [],
      });
    },
  );

  server.registerTool(
    "list_workflows",
    {
      description: "列出工位已生效的工作流。生成时可把返回的 id 作为 workflowId，与 model 独立选择。",
      inputSchema: {
        feature: z.enum(["image", "video", "music", "tts", "sfx", "voiceDesign", "model3d", "anim3d"]).optional(),
      },
    },
    async ({ feature }) => jsonResult(await workflowsSnapshot(feature)),
  );

  server.registerTool(
    "generate_image",
    {
      description: "文生图或图生图。参考图可传本机绝对路径或已上传的 relPath。engine=qwen 走千问云，默认用工位设置。",
      inputSchema: {
        prompt: z.string(),
        model: z.string().optional(),
        workflowId: z.string().optional().describe("ComfyUI 工位生效工作流 id，与 model 独立"),
        engine: z.enum(["comfyui", "qwen"]).optional().describe("comfyui=本机 ComfyUI，qwen=千问云。默认用该工位设置"),
        negativePrompt: z.string().optional(),
        size: z.string().optional().describe("如 1024*1024"),
        n: z.number().optional(),
        images: z.array(z.string()).optional(),
        title: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const { task, assets } = await waitForTaskAssets(await generateImage({
          ...args,
          images: (args.images || []).map(ingestPath),
        }));
        return jsonResult({ ok: true, assets: assets.map(assetOut), task });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "generate_video",
    {
      description: "生视频（异步）。返回 task，用 get_task 轮询。",
      inputSchema: {
        prompt: z.string(),
        model: z.string().optional(),
        workflowId: z.string().optional().describe("ComfyUI 工位生效工作流 id，与 model 独立"),
        engine: z.enum(["comfyui", "qwen"]).optional().describe("comfyui=本机 ComfyUI，qwen=千问云。默认用该工位设置"),
        negativePrompt: z.string().optional(),
        duration: z.number().optional(),
        resolution: z.string().optional(),
        ratio: z.string().optional(),
        firstFrame: z.string().optional().describe("参考图：本机路径或 relPath"),
        lastFrame: z.string().optional(),
        referenceImages: z.array(z.string()).optional(),
        referenceVideos: z.array(z.string()).optional(),
        title: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const result = await generateVideo({
          ...args,
          firstFrame: args.firstFrame ? ingestPath(args.firstFrame) : undefined,
          lastFrame: args.lastFrame ? ingestPath(args.lastFrame) : undefined,
          referenceImages: (args.referenceImages || []).map(ingestPath),
          referenceVideos: (args.referenceVideos || []).map(ingestPath),
        });
        return jsonResult({ ok: true, task: result.task });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "generate_music",
    {
      description: "生音乐。可填歌词 lyrics，或纯器乐 isInstrumental。",
      inputSchema: {
        prompt: z.string().optional(),
        lyrics: z.string().optional(),
        model: z.string().optional(),
        workflowId: z.string().optional().describe("ComfyUI 工位生效工作流 id，与 model 独立"),
        engine: z.enum(["comfyui", "qwen"]).optional().describe("comfyui=本机 ComfyUI，qwen=千问云。默认用该工位设置"),
        isInstrumental: z.boolean().optional(),
        title: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const { task, assets } = await waitForTaskAssets(await generateMusic(args));
        return jsonResult({ ok: true, assets: assets.map(assetOut), task });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "generate_tts",
    {
      description: "配音 / TTS",
      inputSchema: {
        text: z.string(),
        model: z.string().optional(),
        workflowId: z.string().optional().describe("ComfyUI 工位生效工作流 id，与 model 独立"),
        engine: z.enum(["comfyui", "qwen"]).optional().describe("comfyui=本机 ComfyUI，qwen=千问云。默认用该工位设置"),
        voice: z.string().optional(),
        languageType: z.string().optional(),
        instructions: z.string().optional(),
        title: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const { task, assets } = await waitForTaskAssets(await generateTts(args));
        return jsonResult({ ok: true, assets: assets.map(assetOut), task });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "generate_sfx",
    {
      description: "音效",
      inputSchema: {
        prompt: z.string(),
        model: z.string().optional(),
        workflowId: z.string().optional().describe("ComfyUI 工位生效工作流 id，与 model 独立"),
        engine: z.enum(["comfyui", "qwen"]).optional().describe("comfyui=本机 ComfyUI，qwen=千问云。默认用该工位设置"),
        duration: z.number().optional(),
        title: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const { task, assets } = await waitForTaskAssets(await generateSfx(args));
        return jsonResult({ ok: true, assets: assets.map(assetOut), task });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "design_voice",
    {
      description: "用描述设计本机音色角色",
      inputSchema: {
        voicePrompt: z.string(),
        model: z.string().optional(),
        workflowId: z.string().optional().describe("ComfyUI 工位生效工作流 id，与 model 独立"),
        engine: z.enum(["comfyui", "qwen"]).optional().describe("comfyui=本机 ComfyUI，qwen=千问云。默认用该工位设置"),
        targetModel: z.string().optional(),
        previewText: z.string().optional(),
        preferredName: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const { task, assets } = await waitForTaskAssets(await designVoice(args));
        return jsonResult({ ok: true, assets: assets.map(assetOut), task, voices: loadVoices() });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "generate_3d",
    {
      description: "单图或文生 3D（异步）。返回 task，用 get_task 轮询。",
      inputSchema: {
        prompt: z.string().optional(),
        model: z.string().optional(),
        workflowId: z.string().optional().describe("ComfyUI 工位生效工作流 id，与 model 独立"),
        engine: z.enum(["comfyui", "qwen"]).optional().describe("comfyui=本机 ComfyUI，qwen=千问云。默认用该工位设置"),
        image: z.string().optional().describe("参考图：本机路径或 relPath"),
        title: z.string().optional(),
      },
    },
    async (args) => {
      try {
        const result = await generate3d({
          ...args,
          image: args.image ? ingestPath(args.image) : undefined,
        });
        return jsonResult({ ok: true, task: result.task });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "rig_3d",
    {
      description:
        "对已有 3D 资源绑骨并导出 GLB。UniRig 由 ComfyManager 起子进程。engine: auto / unirig / mixamo / bbox",
      inputSchema: {
        assetId: z.string(),
        engine: z.enum(["auto", "unirig", "mixamo", "bbox"]).optional(),
        animationRelPaths: z.array(z.string()).optional().describe("用户上传的 Mixamo 动作 relPath"),
      },
    },
    async ({ assetId, engine, animationRelPaths }) => {
      try {
        const asset = await rigAndAnimateAsset(assetId, { engine, animationRelPaths });
        return jsonResult({ ok: true, asset: assetOut(asset) });
      } catch (err) {
        return errorResult(err);
      }
    },
  );

  server.registerTool(
    "get_task",
    {
      description: "查询异步任务（图 / 视频 / 音乐 / 音频 / 3D）",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      let task = getTask(id);
      if (!task) return errorResult("任务不存在");
      if (task.status === "running" || task.status === "queued") {
        task = (await pollRemoteTask(id)) || task;
      }
      const assets = (task.assetIds || []).map((aid) => getAsset(aid)).filter(Boolean).map((a) => assetOut(a as AssetRecord));
      return jsonResult({ ok: true, task, assets });
    },
  );

  server.registerTool(
    "list_tasks",
    { description: "列出生成任务", inputSchema: {} },
    async () => jsonResult({ tasks: loadTasks() }),
  );

  server.registerTool(
    "list_assets",
    {
      description: "资源库",
      inputSchema: {
        type: z.enum(["image", "video", "music", "audio", "model3d"]).optional(),
        q: z.string().optional(),
        favorite: z.boolean().optional(),
      },
    },
    async ({ type, q, favorite }) => {
      let list = loadLibrary();
      if (type) list = list.filter((a) => a.type === type);
      if (favorite) list = list.filter((a) => a.favorite);
      if (q) {
        const needle = q.toLowerCase();
        list = list.filter((a) => [a.title, a.prompt, a.model, a.tags.join(" ")].join(" ").toLowerCase().includes(needle));
      }
      return jsonResult({ assets: list.slice(0, 50).map(assetOut), total: list.length });
    },
  );

  server.registerTool(
    "get_asset",
    { description: "读取一条成品", inputSchema: { id: z.string() } },
    async ({ id }) => {
      const asset = getAsset(id);
      if (!asset) return errorResult("资源不存在");
      return jsonResult({ ok: true, asset: assetOut(asset) });
    },
  );

  server.registerTool(
    "update_asset",
    {
      description: "更新成品标题、备注、标签或收藏",
      inputSchema: {
        id: z.string(),
        title: z.string().optional(),
        notes: z.string().optional(),
        tags: z.array(z.string()).optional(),
        favorite: z.boolean().optional(),
      },
    },
    async ({ id, title, notes, tags, favorite }) => {
      const patch: Record<string, unknown> = {};
      if (title !== undefined) patch.title = title;
      if (notes !== undefined) patch.notes = notes;
      if (tags !== undefined) patch.tags = tags;
      if (favorite !== undefined) patch.favorite = favorite;
      const asset = updateAsset(id, patch);
      if (!asset) return errorResult("资源不存在");
      return jsonResult({ ok: true, asset: assetOut(asset) });
    },
  );

  server.registerTool(
    "delete_asset",
    { description: "删除一条成品", inputSchema: { id: z.string() } },
    async ({ id }) => {
      if (!deleteAsset(id)) return errorResult("资源不存在");
      return jsonResult({ ok: true });
    },
  );

  server.registerTool(
    "list_voices",
    { description: "本机设计的音色角色", inputSchema: {} },
    async () => jsonResult({ voices: loadVoices() }),
  );

  server.registerTool(
    "delete_voice",
    { description: "删除设计角色", inputSchema: { id: z.string() } },
    async ({ id }) => jsonResult({ ok: true, voices: removeVoice(id) }),
  );

  return server;
}

async function statusSnapshot() {
  const s = loadSettings();
  let manager: unknown = { ok: false };
  try {
    manager = await fetchManagerRuntime();
  } catch (err) {
    manager = { ok: false, error: err instanceof Error ? err.message : String(err), url: managerUrl() };
  }
  return {
    ok: true,
    name: "VisualForge",
    engine: "VisualForge",
    tools: ["comfyui", "qwen"],
    engines: s.engines,
    dataDir: s.dataDir,
    storePath: storePath(s.dataDir),
    managerUrl: s.managerUrl,
    mcp: mcpEndpoint(s.host, s.port),
    comfy: await pingComfy(),
    manager,
    rig: await rigEngineStatus(),
  };
}

async function modelsSnapshot() {
  const runtime = await fetchManagerRuntime(true);
  const stations = Object.fromEntries(
    FEATURE_IDS.map((id) => [
      id,
      {
        label: FEATURE_LABELS[id],
        active: runtime.activeModels?.[id] || "",
        activeWorkflowId: runtime.features?.[id]?.activeWorkflowId || "",
        models: runtime.catalog?.[id] || [],
        workflows: (runtime.features?.[id]?.workflows || [])
          .filter((w) => w.enabled !== false)
          .map((w) => ({ id: w.id, name: w.name, source: w.source })),
      },
    ]),
  );
  return {
    managerUrl: managerUrl(),
    activeModels: runtime.activeModels,
    stations,
  };
}

async function workflowsSnapshot(feature?: (typeof FEATURE_IDS)[number]) {
  const snap = await modelsSnapshot();
  if (!feature) return snap.stations;
  return snap.stations[feature] || {};
}

export function mcpEndpoint(host = "127.0.0.1", port = 18787) {
  return `http://${host}:${port}/mcp`;
}
