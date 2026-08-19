import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import JSZip from "jszip";
import { nanoid } from "nanoid";
import { loadSettings, saveSettings } from "./config.ts";
import { FEATURE_IDS, FEATURE_LABELS } from "./types.ts";
import type { FeatureId } from "./types.ts";
import { syncActiveWorkflow, upsertStationWorkflow } from "./features.ts";
import type { ComfyFeatureConfig, StationWorkflow } from "./features.ts";
import { injectPlaceholders, uiToApiPrompt, unwrapApiGraph, workflowFormat } from "./workflow-convert.ts";

export type WorkflowItem = {
  path: string;
  name: string;
  size: number;
  mtime: string;
  format: "api" | "ui" | "unknown";
  assignedTo: FeatureId[];
};

function installDir() {
  return loadSettings().comfy.installDir;
}

export function defaultWorkflowsDir() {
  return join(installDir(), "user", "default", "workflows");
}

export function workflowRoots() {
  const root = installDir();
  return [
    join(root, "user", "default", "workflows"),
    join(root, "user", "workflows"),
    join(root, "workflows"),
  ];
}

function slash(p: string) {
  return p.replace(/\\/g, "/");
}

function safeRel(rel: string) {
  const cleaned = slash(rel).replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("..") || cleaned.startsWith("/")) throw new Error("非法工作流路径");
  return cleaned;
}

function within(root: string, abs: string) {
  const a = resolve(abs);
  const r = resolve(root);
  return a === r || a.startsWith(r + sep);
}

export function resolveWorkflowFile(rel: string) {
  const cleaned = safeRel(rel);
  const abs = resolve(installDir(), cleaned);
  if (!within(installDir(), abs)) throw new Error("非法工作流路径");
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new Error("工作流不存在");
  return abs;
}

function walkJson(dir: string, acc: string[] = []) {
  if (!existsSync(dir)) return acc;
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const ent of entries) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) walkJson(full, acc);
    else if (ent.isFile() && extname(ent.name).toLowerCase() === ".json") acc.push(full);
  }
  return acc;
}

function assignedMap() {
  const map = new Map<string, FeatureId[]>();
  const features = loadSettings().features;
  for (const id of FEATURE_IDS) {
    const cfg = features[id];
    const sources = new Set<string>();
    if (cfg?.workflowSource) sources.add(slash(cfg.workflowSource));
    for (const w of cfg?.workflows || []) {
      if (w.source) sources.add(slash(w.source));
    }
    for (const key of sources) {
      if (!key || key === "manual") continue;
      map.set(key, [...(map.get(key) || []), id]);
    }
  }
  return map;
}

export function listComfyWorkflows(): { root: string; defaultDir: string; items: WorkflowItem[] } {
  const root = installDir();
  const assigned = assignedMap();
  const seen = new Set<string>();
  const items: WorkflowItem[] = [];
  for (const dir of workflowRoots()) {
    for (const abs of walkJson(dir)) {
      const path = slash(relative(root, abs));
      if (seen.has(path)) continue;
      seen.add(path);
      let format: WorkflowItem["format"] = "unknown";
      try {
        format = workflowFormat(JSON.parse(readFileSync(abs, "utf8")));
      } catch {
        format = "unknown";
      }
      const st = statSync(abs);
      items.push({
        path,
        name: basename(abs, ".json"),
        size: st.size,
        mtime: st.mtime.toISOString(),
        format,
        assignedTo: assigned.get(path) || [],
      });
    }
  }
  items.sort((a, b) => a.path.localeCompare(b.path));
  return { root, defaultDir: defaultWorkflowsDir(), items };
}

export function readWorkflowJson(rel: string) {
  const abs = resolveWorkflowFile(rel);
  const text = readFileSync(abs, "utf8");
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("工作流不是合法 JSON");
  }
  return { path: slash(rel), text, json, format: workflowFormat(json) };
}

let objectInfoCache: { at: number; data: Record<string, { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } }> } | null = null;

async function fetchObjectInfo() {
  if (objectInfoCache && Date.now() - objectInfoCache.at < 30000) return objectInfoCache.data;
  const base = loadSettings().comfy.baseUrl.replace(/\/+$/, "");
  if (!base) return {};
  for (const path of ["/object_info", "/api/object_info"]) {
    try {
      const res = await fetch(`${base}${path}`);
      if (!res.ok) continue;
      const json = (await res.json()) as Record<string, { input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> } }>;
      if (json && typeof json === "object") {
        objectInfoCache = { at: Date.now(), data: json };
        return json;
      }
    } catch {
      /* try next */
    }
  }
  return {};
}

export async function workflowToStationPrompt(rel: string) {
  const { json, format } = readWorkflowJson(rel);
  let graph: Record<string, unknown>;
  const notes: string[] = [];
  if (format === "api") {
    graph = unwrapApiGraph(json);
    notes.push("已是 API 格式");
  } else if (format === "ui") {
    const info = await fetchObjectInfo();
    graph = uiToApiPrompt(json, info);
    notes.push(Object.keys(info).length ? "已从 ComfyUI 画布格式转为 /prompt API" : "ComfyUI 未连通，按画布结构尽力转换；请启动 ComfyUI 后再配一次更稳");
  } else {
    throw new Error("无法识别工作流格式（需要 ComfyUI 画布 JSON 或 API Format）");
  }
  const injected = injectPlaceholders(graph);
  notes.push(...injected.notes);
  return { prompt: injected.graph, notes, format };
}

export function isLibrarySource(source?: string) {
  const s = slash(source || "");
  return Boolean(s) && s !== "manual";
}

const resolveCache = new Map<string, { mtimeMs: number; text: string }>();

export async function resolveStationWorkflowText(wf: Pick<StationWorkflow, "source" | "workflow">) {
  if (!isLibrarySource(wf.source)) return wf.workflow || "";
  const source = slash(wf.source);
  try {
    const abs = resolveWorkflowFile(source);
    const mtimeMs = statSync(abs).mtimeMs;
    const hit = resolveCache.get(source);
    if (hit && hit.mtimeMs === mtimeMs) return hit.text;
    const converted = await workflowToStationPrompt(source);
    const text = JSON.stringify(converted.prompt, null, 2);
    resolveCache.set(source, { mtimeMs, text });
    return text;
  } catch (err) {
    if (wf.workflow) return wf.workflow;
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export async function hydrateFeatures(features: Record<FeatureId, ComfyFeatureConfig>) {
  const next = { ...features };
  for (const id of FEATURE_IDS) {
    const cfg = next[id];
    if (!cfg) continue;
    const workflows: StationWorkflow[] = [];
    for (const w of cfg.workflows || []) {
      try {
        workflows.push({ ...w, workflow: (await resolveStationWorkflowText(w)) || w.workflow });
      } catch {
        workflows.push(w);
      }
    }
    next[id] = syncActiveWorkflow({ ...cfg, workflows });
  }
  return next;
}

export async function assignWorkflowToFeature(rel: string, featureId: string, inject = true) {
  if (!FEATURE_IDS.includes(featureId as FeatureId)) throw new Error("未知工位");
  const id = featureId as FeatureId;
  const converted = await workflowToStationPrompt(rel);
  const graph = inject ? converted.prompt : unwrapApiGraph(readWorkflowJson(rel).json);
  const text = JSON.stringify(graph, null, 2);
  const source = slash(rel);
  const current = loadSettings();
  const existing = current.features[id];
  const same = (existing.workflows || []).find((w) => slash(w.source || "") === source);
  const next = saveSettings({
    features: {
      ...current.features,
      [id]: upsertStationWorkflow(
        { ...existing, mode: "prompt" },
        {
          id: same?.id || nanoid(10),
          name: basename(rel, ".json"),
          source,
          workflow: text,
          enabled: true,
        },
      ),
    },
  });
  return {
    ok: true,
    featureId: id,
    label: FEATURE_LABELS[id],
    path: source,
    notes: converted.notes,
    workflowId: next.features[id].workflows.find((w) => slash(w.source || "") === source)?.id || "",
    count: next.features[id].workflows.length,
    features: next.features,
  };
}

function writeWorkflowFile(rel: string, text: string) {
  const cleaned = safeRel(rel);
  const abs = resolve(installDir(), cleaned.endsWith(".json") ? cleaned : `${cleaned}.json`);
  if (!within(installDir(), abs)) throw new Error("非法工作流路径");
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text, "utf8");
  return slash(relative(installDir(), abs));
}

export function importWorkflowJson(filename: string, text: string) {
  const name = basename(filename).replace(/[^\w.\u4e00-\u9fff-]+/g, "_");
  if (!name.toLowerCase().endsWith(".json")) throw new Error("只接受 .json 工作流");
  JSON.parse(text);
  const rel = slash(relative(installDir(), join(defaultWorkflowsDir(), name)));
  return writeWorkflowFile(rel, text);
}

export async function zipWorkflows(paths?: string[]) {
  const listed = listComfyWorkflows().items;
  const selected = paths?.length ? listed.filter((i) => paths.includes(i.path)) : listed;
  if (!selected.length) throw new Error("没有可打包的工作流");
  const zip = new JSZip();
  for (const item of selected) {
    zip.file(item.path, readFileSync(resolveWorkflowFile(item.path)));
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function importWorkflowZip(buffer: Buffer) {
  const zip = await JSZip.loadAsync(buffer);
  const imported: string[] = [];
  const skipped: string[] = [];
  mkdirSync(defaultWorkflowsDir(), { recursive: true });
  for (const [name, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const base = slash(name);
    if (base.startsWith("__MACOSX/") || base.endsWith("/.DS_Store") || base.endsWith(".DS_Store")) continue;
    if (!base.toLowerCase().endsWith(".json")) {
      skipped.push(base);
      continue;
    }
    const text = await entry.async("string");
    try {
      JSON.parse(text);
    } catch {
      skipped.push(base);
      continue;
    }
    let rel = base.replace(/^\/+/, "");
    if (!rel.includes("/")) rel = slash(relative(installDir(), join(defaultWorkflowsDir(), basename(rel))));
    else if (!rel.startsWith("user/") && !rel.startsWith("workflows/")) {
      rel = slash(relative(installDir(), join(defaultWorkflowsDir(), rel)));
    }
    imported.push(writeWorkflowFile(rel, text));
  }
  if (!imported.length) throw new Error("压缩包里没有可用的 .json 工作流");
  return { imported, skipped };
}
