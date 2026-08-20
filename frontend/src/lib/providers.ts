import type { FeatureId, ProviderId, StationProviders } from "./types";
import { FEATURE_IDS } from "./types";

export interface ProviderDef {
  id: ProviderId;
  label: string;
  kicker: string;
  description: string;
  stations: FeatureId[];
  docsUrl?: string;
  tone: "comfy" | "qwen";
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "comfyui",
    label: "ComfyUI",
    kicker: "本机",
    description: "工作流 + ComfyManager 权重，不经过云端。",
    stations: [...FEATURE_IDS],
    tone: "comfy",
  },
  {
    id: "qwen",
    label: "千问云",
    kicker: "云端",
    description: "DashScope 模型，无需工作流。",
    stations: ["image", "video", "music", "tts", "sfx", "voiceDesign", "model3d"],
    docsUrl: "https://www.qianwenai.com/",
    tone: "qwen",
  },
];

export function providerById(id: ProviderId) {
  return PROVIDERS.find((p) => p.id === id);
}

export function providersForStation(feature: FeatureId) {
  return PROVIDERS.filter((p) => p.stations.includes(feature));
}

export function providerToneClass(tone: ProviderDef["tone"], active: boolean) {
  if (tone === "qwen") {
    return active
      ? "border-qwen bg-qwen/15 shadow-[0_0_0_1px_rgba(94,200,216,0.4)]"
      : "border-line bg-panel/60 hover:border-qwen/40";
  }
  return active
    ? "border-brass bg-brass/15 shadow-[0_0_0_1px_rgba(212,165,116,0.35)]"
    : "border-line bg-panel/60 hover:border-brass/40";
}

export function providerKickerClass(tone: ProviderDef["tone"]) {
  return tone === "qwen" ? "text-qwen" : "text-brass";
}

export function providerIdsForStation(feature: FeatureId): ProviderId[] {
  return providersForStation(feature).map((p) => p.id);
}

function isStationProviders(value: unknown): value is StationProviders {
  if (!value || typeof value !== "object") return false;
  const v = value as StationProviders;
  return Array.isArray(v.enabled) && (v.default === "comfyui" || v.default === "qwen");
}

export function normalizeStation(feature: FeatureId, raw?: unknown, qwenGloballyEnabled?: boolean): StationProviders {
  const allowed = providerIdsForStation(feature);
  const fallback: ProviderId = allowed.includes("comfyui") ? "comfyui" : allowed[0];
  if (isStationProviders(raw)) {
    const enabled = [...new Set(raw.enabled.filter((id) => allowed.includes(id)))];
    if (!enabled.length) enabled.push(fallback);
    const def = enabled.includes(raw.default) ? raw.default : enabled[0];
    return { enabled, default: def };
  }
  const legacy = raw === "qwen" || raw === "comfyui" ? raw : "comfyui";
  const wantQwen = allowed.includes("qwen") && qwenGloballyEnabled === true && legacy === "qwen";
  if (wantQwen) return { enabled: allowed.filter((id) => id === "comfyui" || id === "qwen"), default: "qwen" };
  return { enabled: [fallback], default: fallback };
}

export function emptyStations(): Record<FeatureId, StationProviders> {
  return Object.fromEntries(FEATURE_IDS.map((id) => [id, normalizeStation(id)])) as Record<FeatureId, StationProviders>;
}
