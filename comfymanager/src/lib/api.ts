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
  installLog: () =>
    req<{ ok: boolean; text: string; path: string; installing: boolean; truncated: boolean }>("/api/comfy/install-log"),
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
  workflows: () =>
    req<{
      ok: boolean;
      root: string;
      defaultDir: string;
      items: Array<{
        path: string;
        name: string;
        size: number;
        mtime: string;
        format: "api" | "ui" | "unknown";
        assignedTo: string[];
      }>;
    }>("/api/comfy/workflows"),
  assignWorkflow: (path: string, featureId: string) =>
    req("/api/comfy/workflows/assign", { method: "POST", body: JSON.stringify({ path, featureId }) }),
};

export async function downloadWorkflowZip(paths?: string[]) {
  const res = await fetch("/api/comfy/workflows/zip", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths: paths || [] }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({ error: `下载失败 ${res.status}` }));
    throw new Error((json as { error?: string }).error || `下载失败 ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "comfy-workflows.zip";
  a.click();
  URL.revokeObjectURL(url);
}

export async function importWorkflows(files: File[]) {
  const form = new FormData();
  for (const f of files) form.append("file", f);
  const res = await fetch("/api/comfy/workflows/import", { method: "POST", body: form });
  const json = await res.json();
  if (!res.ok || json.ok === false) throw new Error(json.error || "导入失败");
  return json as { imported: string[]; skipped: string[]; items: unknown[] };
}
