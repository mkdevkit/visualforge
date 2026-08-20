import type { FeatureId, ProviderId, StationProviders } from "../types.js";
import { FEATURE_IDS, FEATURE_LABELS } from "./features.js";

/** 需要选生成提供商的工位。anim3d 是 ComfyManager 后处理，不进提供商矩阵。 */
export const PROVIDER_STATION_IDS: FeatureId[] = FEATURE_IDS.filter((id) => id !== "anim3d");

export interface ProviderDef {
  id: ProviderId;
  label: string;
  kicker: string;
  description: string;
  stations: FeatureId[];
  docsUrl?: string;
}

export const PROVIDERS: ProviderDef[] = [
  {
    id: "comfyui",
    label: "ComfyUI",
    kicker: "本机",
    description: "工作流 + ComfyManager 权重，不经过云端。",
    stations: [...PROVIDER_STATION_IDS],
  },
  {
    id: "qwen",
    label: "千问云",
    kicker: "云端",
    description: "DashScope 模型，无需工作流。",
    stations: ["image", "video", "music", "tts", "sfx", "voiceDesign", "model3d"],
    docsUrl: "https://www.qianwenai.com/",
  },
  {
    id: "meshy",
    label: "Meshy",
    kicker: "云端",
    description: "官方 OpenAPI：生图与生 3D。",
    stations: ["image", "model3d"],
    docsUrl: "https://www.meshy.ai/zh",
  },
  {
    id: "midjourney",
    label: "Midjourney",
    kicker: "云端",
    description: "仅生图。官方没有公开 API，需自备兼容网关。",
    stations: ["image"],
    docsUrl: "https://www.midjourney.com/",
  },
  {
    id: "tripo",
    label: "Tripo",
    kicker: "云端",
    description: "官方 OpenAPI 生 3D，与千问云里的 Tripo 不是同一条线路。",
    stations: ["model3d"],
    docsUrl: "https://www.tripo3d.ai/",
  },
  {
    id: "volcengine",
    label: "火山引擎",
    kicker: "云端",
    description: "方舟 Seedream 生图、Seedance 生视频；生音乐走海绵/音视频 OpenAPI。",
    stations: ["image", "video", "music"],
    docsUrl: "https://www.volcengine.com/",
  },
];

export const PROVIDER_IDS = PROVIDERS.map((p) => p.id);

export function isProviderId(value: unknown): value is ProviderId {
  return PROVIDER_IDS.includes(value as ProviderId);
}

export function providerById(id: ProviderId) {
  return PROVIDERS.find((p) => p.id === id);
}

export function providersForStation(feature: FeatureId) {
  return PROVIDERS.filter((p) => p.stations.includes(feature));
}

export function providerIdsForStation(feature: FeatureId): ProviderId[] {
  return providersForStation(feature).map((p) => p.id);
}

export function providerSupports(id: ProviderId, feature: FeatureId) {
  return providerIdsForStation(feature).includes(id);
}

function isStationProviders(value: unknown): value is StationProviders {
  if (!value || typeof value !== "object") return false;
  const v = value as StationProviders;
  return Array.isArray(v.enabled) && isProviderId(v.default);
}

export function normalizeStation(
  feature: FeatureId,
  raw?: unknown,
  qwenGloballyEnabled?: boolean,
): StationProviders {
  const allowed = providerIdsForStation(feature);
  const fallback: ProviderId = allowed.includes("comfyui") ? "comfyui" : allowed[0] || "comfyui";
  if (isStationProviders(raw)) {
    const enabled = [...new Set(raw.enabled.filter((id) => allowed.includes(id)))];
    if (!enabled.length) enabled.push(fallback);
    const def = enabled.includes(raw.default) ? raw.default : enabled[0];
    return { enabled, default: def };
  }
  const legacy = raw === "qwen" || raw === "comfyui" ? raw : "comfyui";
  const wantQwen = allowed.includes("qwen") && qwenGloballyEnabled === true && legacy === "qwen";
  if (wantQwen) return { enabled: ["comfyui", "qwen"].filter((id) => allowed.includes(id as ProviderId)) as ProviderId[], default: "qwen" };
  return { enabled: [fallback], default: fallback };
}

export function defaultStations(
  stored?: Partial<Record<FeatureId, unknown>>,
  qwenGloballyEnabled?: boolean,
): Record<FeatureId, StationProviders> {
  return Object.fromEntries(
    FEATURE_IDS.map((id) => [id, normalizeStation(id, stored?.[id], qwenGloballyEnabled)]),
  ) as Record<FeatureId, StationProviders>;
}

export function publicProviders() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    kicker: p.kicker,
    description: p.description,
    docsUrl: p.docsUrl,
    stations: p.stations.map((id) => ({ id, label: FEATURE_LABELS[id] })),
  }));
}
