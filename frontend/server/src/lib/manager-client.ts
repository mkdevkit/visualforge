import { loadSettings, saveSettings } from "../config.js";
import type { ComfyFeatureConfig, FeatureId } from "../types.js";
import { defaultComfyFeature } from "./features.js";

export function managerUrl() {
  return (loadSettings().managerUrl || process.env.COMFYMANAGER_URL || "http://127.0.0.1:18788").replace(/\/+$/, "");
}

export interface ManagerRuntime {
  ok: boolean;
  comfy: { baseUrl: string; apiKey: string; connected: boolean; processRunning: boolean };
  activeModels: Record<FeatureId, string>;
  features: Record<FeatureId, ComfyFeatureConfig>;
  featureLabels?: Record<string, string>;
  catalog: {
    openModels?: Array<{ id: string; filename: string; features: string[]; primary?: boolean }>;
    image: unknown[];
    video: unknown[];
    music: unknown[];
    tts: unknown[];
    sfx: unknown[];
    model3d: unknown[];
    anim3d: unknown[];
    voiceDesign: unknown[];
    related?: Record<string, unknown[]>;
    imageSizes: unknown[];
    ttsVoices: string[];
    languages: string[];
    catalogFile?: string;
    activeModels?: Record<FeatureId, string>;
    features?: Record<FeatureId, ComfyFeatureConfig>;
  };
}

let cache: { at: number; url: string; data: ManagerRuntime } | null = null;

export async function fetchManagerRuntime(force = false): Promise<ManagerRuntime> {
  const url = managerUrl();
  if (!force && cache && cache.url === url && Date.now() - cache.at < 2000) return cache.data;
  const res = await fetch(`${url}/api/runtime`);
  const json = (await res.json()) as ManagerRuntime;
  if (!res.ok || json.ok === false) {
    throw new Error((json as unknown as { error?: string }).error || `ComfyManager 不可用 (${res.status})`);
  }
  json.activeModels = json.activeModels || json.catalog?.activeModels || ({} as Record<FeatureId, string>);
  json.features = json.features || json.catalog?.features || ({} as Record<FeatureId, ComfyFeatureConfig>);
  cache = { at: Date.now(), url, data: json };
  const cur = loadSettings();
  if (json.comfy?.baseUrl && json.comfy.baseUrl !== cur.comfy.baseUrl) {
    saveSettings({
      comfy: {
        ...cur.comfy,
        baseUrl: json.comfy.baseUrl,
        apiKey: json.comfy.apiKey || cur.comfy.apiKey,
      },
    });
  }
  return json;
}

export function resolveModelName(requested?: string, fallback = "") {
  const id = (requested || "").trim();
  const open = cache?.data.catalog.openModels?.find((m) => m.id === id);
  if (open?.filename) return open.filename.split("/").pop() || open.filename;
  if (id) return id;
  return fallback;
}

export function activeModel(feature: FeatureId) {
  return cache?.data.activeModels?.[feature] || "";
}

export async function fetchManagerUniRig() {
  const res = await fetch(`${managerUrl()}/api/tools/unirig`);
  const json = (await res.json()) as {
    ok?: boolean;
    error?: string;
    installed?: boolean;
    dir?: string;
    python?: string;
    busy?: boolean;
  };
  if (!res.ok || json.ok === false) {
    throw new Error(json.error || `ComfyManager UniRig 不可用 (${res.status})`);
  }
  return {
    installed: Boolean(json.installed),
    dir: json.dir || "",
    python: json.python || "",
    busy: Boolean(json.busy),
  };
}

export async function runManagerUniRig(glb: Buffer): Promise<Buffer> {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(glb)], { type: "model/gltf-binary" }), "input.glb");
  const res = await fetch(`${managerUrl()}/api/tools/unirig/run`, { method: "POST", body: form });
  const type = res.headers.get("content-type") || "";
  if (!res.ok) {
    let message = `UniRig 失败 (${res.status})`;
    if (type.includes("json")) {
      const json = (await res.json()) as { error?: string };
      if (json.error) message = json.error;
    } else {
      const text = await res.text();
      if (text) message = text.slice(0, 2000);
    }
    throw new Error(message);
  }
  return Buffer.from(await res.arrayBuffer());
}

export async function featureFromManager(feature: FeatureId): Promise<ComfyFeatureConfig> {
  const runtime = await fetchManagerRuntime();
  const fromMgr = runtime.features?.[feature];
  const next = { ...defaultComfyFeature(), ...(fromMgr || {}) };
  if (!next.url) next.url = runtime.comfy?.baseUrl || loadSettings().comfy.baseUrl;
  if (!next.model) next.model = runtime.activeModels?.[feature] || "";
  return next;
}
