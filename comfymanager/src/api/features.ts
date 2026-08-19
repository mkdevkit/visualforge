import type { FeatureId } from "./types.ts";
import { FEATURE_IDS } from "./types.ts";

export type ComfyMode = "prompt" | "http";

export interface ComfyFeatureConfig {
  mode: ComfyMode;
  url: string;
  model: string;
  workflow: string;
  extraHeaders: Record<string, string>;
  timeoutMs: number;
}

export function defaultFeature(): ComfyFeatureConfig {
  return {
    mode: "prompt",
    url: "",
    model: "",
    workflow: "",
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
    base[id] = {
      mode: merged.mode === "http" ? "http" : "prompt",
      url: merged.url || "",
      model: merged.model || "",
      workflow: merged.workflow || "",
      extraHeaders: merged.extraHeaders,
      timeoutMs: merged.timeoutMs,
    };
  }
  return base;
}

const PRIMARY_FOLDERS = new Set(["checkpoints", "diffusion_models", "unet", "tts"]);

export function isPrimaryModel(m: { id: string; name: string; filename: string; folder: string }) {
  if (!PRIMARY_FOLDERS.has(m.folder)) return false;
  return !/tokenizer|vae|encoder|clip.vision|lightning/i.test(`${m.id} ${m.name} ${m.filename}`);
}
