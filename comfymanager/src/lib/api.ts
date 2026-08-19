async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const json = await res.json();
  if (!res.ok || json.ok === false) throw new Error(json.error || `请求失败 ${res.status}`);
  return json as T;
}

export const api = {
  health: () => req<{ ok: boolean; comfy: Record<string, unknown>; dataDir: string }>("/api/health"),
  settings: () => req<{ settings: Record<string, unknown> }>("/api/settings"),
  saveSettings: (body: Record<string, unknown>) =>
    req("/api/settings", { method: "PUT", body: JSON.stringify(body) }),
  status: () =>
    req<{
      ok: boolean;
      installed: boolean;
      installDir: string;
      modelsDir: string;
      processRunning: boolean;
      pid?: number;
      baseUrl: string;
      api: { ok: boolean; error?: string; baseUrl: string };
    }>("/api/comfy/status"),
  ping: (baseUrl?: string) =>
    req<{ ok: boolean; baseUrl: string; error?: string }>(
      `/api/comfy/ping${baseUrl ? `?baseUrl=${encodeURIComponent(baseUrl)}` : ""}`,
    ),
  install: () => req("/api/comfy/install", { method: "POST" }),
  start: () => req<{ pid: number; baseUrl: string }>("/api/comfy/start", { method: "POST" }),
  stop: () => req("/api/comfy/stop", { method: "POST" }),
  installUniRig: () => req("/api/tools/unirig/install", { method: "POST" }),
  models: () =>
    req<{
      openModels: Array<Record<string, unknown>>;
      catalogFile?: string;
      activeModels: Record<string, string>;
    }>("/api/models"),
  downloads: () => req<{ jobs: Array<Record<string, unknown>> }>("/api/models/downloads"),
  download: (id: string) => req(`/api/models/${encodeURIComponent(id)}/download`, { method: "POST" }),
  remove: (id: string) => req(`/api/models/${encodeURIComponent(id)}`, { method: "DELETE" }),
  saveActive: (activeModels: Record<string, string>) =>
    req("/api/active-models", { method: "PUT", body: JSON.stringify({ activeModels }) }),
  features: () =>
    req<{ features: Record<string, unknown>; featureLabels: Record<string, string>; activeModels: Record<string, string> }>(
      "/api/features",
    ),
  saveFeatures: (features: Record<string, unknown>) =>
    req("/api/features", { method: "PUT", body: JSON.stringify({ features }) }),
};
