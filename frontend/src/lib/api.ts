import { readQwenPrefs } from "./qwen-prefs";
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
      res.status === 500 || res.status === 502
        ? `视铸生成服务 18787 未启动（${path} HTTP ${res.status}）。请到设置页点「重启生成服务」。`
        : `视铸生成接口 ${path} 返回空响应（HTTP ${res.status}）。请到设置页点「重启生成服务」。`,
    );
  }
  let json: { ok?: boolean; error?: string; code?: string; detail?: unknown };
  try {
    json = JSON.parse(raw) as { ok?: boolean; error?: string; code?: string; detail?: unknown };
  } catch {
    throw new Error(`接口 ${path} 返回了非 JSON（HTTP ${res.status}）：${raw.slice(0, 180)}`);
  }
  if (!res.ok || json.ok === false) {
    const parts = [json.error || `请求失败 ${res.status}`];
    if (json.code && !String(json.error || "").includes(String(json.code))) parts.push(`code: ${json.code}`);
    throw new Error(parts.filter(Boolean).join("\n"));
  }
  return json as T;
}

async function parseJsonRes(res: Response) {
  const raw = await res.text();
  try {
    return JSON.parse(raw) as { ok?: boolean; error?: string; restarting?: boolean; engine?: string; pid?: number; port?: number };
  } catch {
    throw new Error(raw.trim().slice(0, 180) || `HTTP ${res.status}`);
  }
}

export async function restartApi() {
  try {
    const res = await fetch("/__visualforge/restart-api", { method: "POST" });
    if (res.status !== 404) {
      const json = await parseJsonRes(res);
      if (!res.ok || json.ok === false) throw new Error(json.error || `重启失败 ${res.status}`);
      return json;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!/404|Failed to fetch|NetworkError|ECONNREFUSED/i.test(msg)) throw err;
  }
  const res = await fetch(`${apiBase()}/api/server/restart`, { method: "POST" });
  const json = await parseJsonRes(res);
  if (!res.ok || json.ok === false) throw new Error(json.error || `重启失败 ${res.status}`);
  const start = Date.now();
  while (Date.now() - start < 20000) {
    await new Promise((r) => setTimeout(r, 400));
    try {
      const pingRes = await fetch(`${apiBase()}/api/ping`, { signal: AbortSignal.timeout(1500) });
      if (pingRes.ok) return parseJsonRes(pingRes);
    } catch {
      /* 正在拉起 */
    }
  }
  throw new Error("已发出重启，但 20 秒内没有重新就绪");
}

async function pushQwenKeyIfNeeded() {
  const key = (readQwenPrefs().apiKey || "").trim();
  if (!key || /[•*]/.test(key)) return;
  try {
    const p = await req<{ qwen?: { configured?: boolean } }>("/api/ping");
    if (p.qwen?.configured) return;
  } catch {
    /* 继续写入 */
  }
  const saved = await req<{ settings?: { qwen?: { configured?: boolean; apiKey?: string } } }>(
    "/api/settings",
    { method: "PUT", body: JSON.stringify({ qwen: { apiKey: key } }) },
  );
  if (!saved.settings?.qwen?.configured && !saved.settings?.qwen?.apiKey) {
    throw new Error("千问 API Key 还在浏览器里，没有写入生成服务。请打开设置页再点一次保存。");
  }
}

function postGenerate<T>(path: string, body: Record<string, unknown>) {
  return (async () => {
    if (body.engine === "qwen") await pushQwenKeyIfNeeded();
    return req<T>(path, { method: "POST", body: JSON.stringify(body) });
  })();
}

export const api = {
  ping: () => req<{ ok: boolean; engine?: string; tools?: string[]; port?: number; pid?: number; qwen?: { configured?: boolean } }>("/api/ping"),
  health: () => req<{ ok: boolean; engine?: string; tools?: string[]; dataDir: string; managerUrl?: string; manager?: unknown; qwen?: { configured?: boolean }; engines?: Record<string, unknown> }>("/api/health"),
  models: () => req<Catalog & { ok: boolean; openModels?: import("./types").OpenModel[] }>("/api/models"),
  settings: () => req<{ settings: Record<string, unknown> }>("/api/settings"),
  saveSettings: (body: Record<string, unknown>) =>
    req<{ ok: boolean; settings: Record<string, unknown> }>("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  pingComfy: (baseUrl?: string) =>
    req<{ ok: boolean; baseUrl: string; error?: string }>(
      `/api/comfy/ping${baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : ""}`,
    ),
  generateImage: (body: Record<string, unknown>) =>
    postGenerate<{ assets?: AssetRecord[]; task?: TaskRecord }>("/api/images/generate", body),
  generateVideo: (body: Record<string, unknown>) =>
    postGenerate<{ assets?: AssetRecord[]; task?: TaskRecord }>("/api/videos/generate", body),
  generateMusic: (body: Record<string, unknown>) =>
    postGenerate<{ assets?: AssetRecord[]; task?: TaskRecord }>("/api/music/generate", body),
  tts: (body: Record<string, unknown>) =>
    postGenerate<{ assets?: AssetRecord[]; task?: TaskRecord }>("/api/audio/tts", body),
  sfx: (body: Record<string, unknown>) =>
    postGenerate<{ assets?: AssetRecord[]; task?: TaskRecord }>("/api/audio/sfx", body),
  designVoice: (body: Record<string, unknown>) =>
    postGenerate<{ voice?: string; preview?: AssetRecord; voices?: DesignedVoice[]; assets?: AssetRecord[]; task?: TaskRecord }>(
      "/api/audio/voices",
      body,
    ),
  voices: () => req<{ voices: DesignedVoice[] }>("/api/audio/voices"),
  deleteVoice: (id: string, targetModel?: string) =>
    req<{ voices: DesignedVoice[] }>(
      `/api/audio/voices/${encodeURIComponent(id)}${targetModel ? `?targetModel=${encodeURIComponent(targetModel)}` : ""}`,
      { method: "DELETE" },
    ),
  generate3d: (body: Record<string, unknown>) =>
    postGenerate<{ assets?: AssetRecord[]; task?: TaskRecord }>("/api/3d/generate", body),
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
