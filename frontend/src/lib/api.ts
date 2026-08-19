import type { AssetRecord, Catalog, DesignedVoice, TaskRecord } from "./types";

export function apiBase() {
  if (import.meta.env.VITE_API_BASE) return String(import.meta.env.VITE_API_BASE).replace(/\/$/, "");
  if (typeof window === "undefined") return "";
  const { hostname, port } = window.location;
  if (port === "5173" || port === "4173" || port === "18787") return "";
  if (hostname === "tauri.localhost" || hostname === "localhost" || hostname === "127.0.0.1") {
    return "http://127.0.0.1:18787";
  }
  return "";
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const raw = await res.text();
  if (!raw.trim()) {
    throw new Error(
      `视铸生成接口 ${path} 返回空响应（HTTP ${res.status}）。请确认 npm run dev 在跑。设置里的地址是 ComfyManager（默认 18788），由视铸生成服务去调用，不是浏览器直接打那个地址。`,
    );
  }
  let json: { ok?: boolean; error?: string };
  try {
    json = JSON.parse(raw) as { ok?: boolean; error?: string };
  } catch {
    throw new Error(`接口 ${path} 返回了非 JSON（HTTP ${res.status}）：${raw.slice(0, 180)}`);
  }
  if (!res.ok || json.ok === false) throw new Error(json.error || `请求失败 ${res.status}`);
  return json as T;
}

export const api = {
  health: () => req<{ ok: boolean; engine?: string; dataDir: string; managerUrl?: string; manager?: unknown }>("/api/health"),
  models: () => req<Catalog & { ok: boolean; openModels?: import("./types").OpenModel[] }>("/api/models"),
  settings: () => req<{ settings: Record<string, unknown> }>("/api/settings"),
  saveSettings: (body: Record<string, unknown>) =>
    req("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  pingComfy: (baseUrl?: string) =>
    req<{ ok: boolean; baseUrl: string; error?: string }>(
      `/api/comfy/ping${baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : ""}`,
    ),
  generateImage: (body: Record<string, unknown>) =>
    req<{ assets?: AssetRecord[]; task?: TaskRecord }>("/api/images/generate", { method: "POST", body: JSON.stringify(body) }),
  generateVideo: (body: Record<string, unknown>) =>
    req<{ assets?: AssetRecord[]; task?: TaskRecord }>("/api/videos/generate", { method: "POST", body: JSON.stringify(body) }),
  generateMusic: (body: Record<string, unknown>) =>
    req<{ assets?: AssetRecord[]; task?: TaskRecord }>("/api/music/generate", { method: "POST", body: JSON.stringify(body) }),
  tts: (body: Record<string, unknown>) =>
    req<{ assets?: AssetRecord[]; task?: TaskRecord }>("/api/audio/tts", { method: "POST", body: JSON.stringify(body) }),
  sfx: (body: Record<string, unknown>) =>
    req<{ assets?: AssetRecord[]; task?: TaskRecord }>("/api/audio/sfx", { method: "POST", body: JSON.stringify(body) }),
  designVoice: (body: Record<string, unknown>) =>
    req<{ voice?: string; preview?: AssetRecord; voices?: DesignedVoice[]; assets?: AssetRecord[]; task?: TaskRecord }>(
      "/api/audio/voices",
      { method: "POST", body: JSON.stringify(body) },
    ),
  voices: () => req<{ voices: DesignedVoice[] }>("/api/audio/voices"),
  deleteVoice: (id: string, targetModel?: string) =>
    req<{ voices: DesignedVoice[] }>(
      `/api/audio/voices/${encodeURIComponent(id)}${targetModel ? `?targetModel=${encodeURIComponent(targetModel)}` : ""}`,
      { method: "DELETE" },
    ),
  generate3d: (body: Record<string, unknown>) =>
    req<{ assets?: AssetRecord[]; task?: TaskRecord }>("/api/3d/generate", { method: "POST", body: JSON.stringify(body) }),
  rigStatus: () =>
    req<{
      ok: boolean;
      engines: string[];
      unirig: { installed: boolean; dir: string; python: string };
      mixamo: { clips: string[]; blender: boolean };
    }>("/api/3d/rig-status"),
  rig3d: (assetId: string, opts?: { engine?: string; animationRelPaths?: string[] }) =>
    req<{ asset: AssetRecord }>("/api/3d/rig", { method: "POST", body: JSON.stringify({ assetId, ...opts }) }),
  assets: (query = "") => req<{ assets: AssetRecord[] }>(`/api/assets${query}`),
  asset: (id: string) => req<{ asset: AssetRecord }>(`/api/assets/${id}`),
  patchAsset: (id: string, body: Record<string, unknown>) =>
    req<{ asset: AssetRecord }>(`/api/assets/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteAsset: (id: string) => req(`/api/assets/${id}`, { method: "DELETE" }),
  tasks: () => req<{ tasks: TaskRecord[] }>("/api/tasks"),
  task: (id: string) => req<{ task: TaskRecord }>(`/api/tasks/${id}`),
  openapi: () => req<unknown>("/api/openapi.json"),
};

export async function uploadFile(file: File) {
  const form = new FormData();
  form.set("file", file);
  const res = await fetch(`${apiBase()}/api/upload`, { method: "POST", body: form });
  const raw = await res.text();
  if (!raw.trim()) throw new Error(`上传失败：空响应（HTTP ${res.status}）`);
  let json: { ok?: boolean; error?: string; file?: { id: string; relPath: string; url: string; filename: string } };
  try {
    json = JSON.parse(raw) as { ok?: boolean; error?: string; file?: { id: string; relPath: string; url: string; filename: string } };
  } catch {
    throw new Error(`上传失败：非 JSON（HTTP ${res.status}）`);
  }
  if (!res.ok || !json.ok) throw new Error(json.error || "上传失败");
  return json.file as { id: string; relPath: string; url: string; filename: string };
}

export function fileUrl(relPath: string) {
  return `${apiBase()}/api/files/${relPath}`;
}
