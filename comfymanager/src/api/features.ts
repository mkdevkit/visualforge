import type { FeatureId } from "./types.ts";
import { FEATURE_IDS } from "./types.ts";

export type ComfyMode = "prompt" | "http";

export interface StationWorkflow {
  id: string;
  name: string;
  source: string;
  workflow: string;
  enabled: boolean;
}

export interface ComfyFeatureConfig {
  mode: ComfyMode;
  url: string;
  model: string;
  workflow: string;
  workflowSource: string;
  workflows: StationWorkflow[];
  activeWorkflowId: string;
  extraHeaders: Record<string, string>;
  timeoutMs: number;
}

function stableId(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return `wf_${(h >>> 0).toString(36)}`;
}

function asWorkflow(raw: unknown, featureId: FeatureId, index: number): StationWorkflow | null {
  if (!raw || typeof raw !== "object") return null;
  const w = raw as Partial<StationWorkflow>;
  const source = String(w.source || "");
  const name =
    String(w.name || "").trim() ||
    (source ? source.split(/[/\\]/).pop()?.replace(/\.json$/i, "") : "") ||
    `工作流 ${index + 1}`;
  const workflow = String(w.workflow || "");
  if (!workflow && !source && !w.id) return null;
  const id = String(w.id || "").trim() || stableId(`${featureId}:${source || name}:${index}`);
  return {
    id,
    name,
    source,
    workflow,
    enabled: w.enabled !== false,
  };
}

export function normalizeWorkflows(featureId: FeatureId, cfg: Partial<ComfyFeatureConfig>): StationWorkflow[] {
  const incoming = Array.isArray(cfg.workflows) ? cfg.workflows : [];
  const used = new Set<string>();
  const out: StationWorkflow[] = [];
  incoming.forEach((raw, index) => {
    const item = asWorkflow(raw, featureId, index);
    if (!item) return;
    let id = item.id;
    if (used.has(id)) id = `${id}_${index}`;
    used.add(id);
    out.push({ ...item, id });
  });
  if (!out.length && cfg.workflow) {
    const source = String(cfg.workflowSource || "manual");
    const name =
      source === "manual"
        ? "手动粘贴"
        : source.split(/[/\\]/).pop()?.replace(/\.json$/i, "") || "工作流";
    out.push({
      id: stableId(`${featureId}:${source}`),
      name,
      source,
      workflow: String(cfg.workflow),
      enabled: true,
    });
  }
  return out;
}

export function syncActiveWorkflow(cfg: ComfyFeatureConfig): ComfyFeatureConfig {
  const list = cfg.workflows || [];
  if (!list.length) {
    return { ...cfg, workflow: cfg.workflow || "", workflowSource: cfg.workflowSource || "", activeWorkflowId: "" };
  }
  const active =
    list.find((w) => w.id === cfg.activeWorkflowId) ||
    list.find((w) => w.enabled) ||
    list[0];
  return {
    ...cfg,
    activeWorkflowId: active.id,
    workflow: active.workflow,
    workflowSource: active.source,
  };
}

export function upsertStationWorkflow(cfg: ComfyFeatureConfig, item: StationWorkflow): ComfyFeatureConfig {
  const workflows = [...(cfg.workflows || [])];
  const sourceKey = (item.source || "").replace(/\\/g, "/");
  const hit = sourceKey
    ? workflows.findIndex((w) => (w.source || "").replace(/\\/g, "/") === sourceKey)
    : workflows.findIndex((w) => w.id === item.id);
  if (hit >= 0) {
    workflows[hit] = { ...workflows[hit], ...item, id: workflows[hit].id };
  } else {
    workflows.push(item);
  }
  const keepActive = cfg.activeWorkflowId && workflows.some((w) => w.id === cfg.activeWorkflowId);
  return syncActiveWorkflow({
    ...cfg,
    workflows,
    activeWorkflowId: keepActive ? cfg.activeWorkflowId : workflows[workflows.length - 1].id,
  });
}

export function applyStationWorkflow(cfg: ComfyFeatureConfig, workflowId?: string): ComfyFeatureConfig {
  const list = (cfg.workflows?.length
    ? cfg.workflows
    : cfg.workflow
      ? [
          {
            id: cfg.activeWorkflowId || "legacy",
            name: "默认",
            source: cfg.workflowSource || "manual",
            workflow: cfg.workflow,
            enabled: true,
          },
        ]
      : []) as StationWorkflow[];
  const enabled = list.filter((w) => w.enabled !== false && w.workflow);
  if (!enabled.length) {
    if (cfg.workflow) return cfg;
    throw new Error("该工位没有生效的工作流。请在「工作流」页加入至少一份并勾选生效。");
  }
  const requested = (workflowId || cfg.activeWorkflowId || "").trim();
  const hit = enabled.find((w) => w.id === requested) || enabled[0];
  if (requested && workflowId && !enabled.some((w) => w.id === requested)) {
    throw new Error(`找不到生效工作流 ${workflowId}`);
  }
  return {
    ...cfg,
    workflow: hit.workflow,
    workflowSource: hit.source,
    activeWorkflowId: hit.id,
    workflows: list,
  };
}

export function defaultFeature(): ComfyFeatureConfig {
  return {
    mode: "prompt",
    url: "",
    model: "",
    workflow: "",
    workflowSource: "",
    workflows: [],
    activeWorkflowId: "",
    extraHeaders: {},
    timeoutMs: 300000,
  };
}

export function defaultFeatures(): Record<FeatureId, ComfyFeatureConfig> {
  return Object.fromEntries(FEATURE_IDS.map((id) => [id, defaultFeature()])) as Record<FeatureId, ComfyFeatureConfig>;
}

export function mergeFeatures(
  stored?: Partial<Record<FeatureId, Partial<ComfyFeatureConfig>>>,
): Record<FeatureId, ComfyFeatureConfig> {
  const base = defaultFeatures();
  if (!stored) return base;
  for (const id of FEATURE_IDS) {
    const patch = stored[id];
    if (!patch) continue;
    const merged = { ...base[id], ...patch };
    if (!merged.extraHeaders || typeof merged.extraHeaders !== "object") merged.extraHeaders = {};
    if (!merged.timeoutMs) merged.timeoutMs = 300000;
    const workflows = normalizeWorkflows(id, merged);
    if (typeof patch.workflow === "string" && workflows.length) {
      const target =
        workflows.find((w) => w.id === merged.activeWorkflowId) || workflows.find((w) => w.enabled) || workflows[0];
      if (target && patch.workflow !== target.workflow) target.workflow = patch.workflow;
    }
    base[id] = syncActiveWorkflow({
      mode: merged.mode === "http" ? "http" : "prompt",
      url: merged.url || "",
      model: merged.model || "",
      workflow: merged.workflow || "",
      workflowSource: merged.workflowSource || "",
      workflows,
      activeWorkflowId: merged.activeWorkflowId || "",
      extraHeaders: merged.extraHeaders,
      timeoutMs: merged.timeoutMs,
    });
  }
  return base;
}

export function publicFeatures(features: Record<FeatureId, ComfyFeatureConfig>): Record<FeatureId, ComfyFeatureConfig> {
  return Object.fromEntries(
    FEATURE_IDS.map((id) => {
      const cfg = features[id] || defaultFeature();
      const refs: StationWorkflow[] = (cfg.workflows || []).map((w) => ({
        id: w.id,
        name: w.name,
        source: w.source,
        workflow: "",
        enabled: w.enabled !== false,
      }));
      return [
        id,
        {
          ...cfg,
          workflow: cfg.workflow ? "{{configured}}" : "",
          workflows: refs,
        },
      ];
    }),
  ) as Record<FeatureId, ComfyFeatureConfig>;
}

const PRIMARY_FOLDERS = new Set(["checkpoints", "diffusion_models", "unet", "tts"]);

export function isPrimaryModel(m: { id: string; name: string; filename: string; folder: string }) {
  if (!PRIMARY_FOLDERS.has(m.folder)) return false;
  return !/tokenizer|vae|encoder|clip.vision|lightning/i.test(`${m.id} ${m.name} ${m.filename}`);
}
