const STORAGE_KEY = "visualforge.managerUrl";
const DEFAULT_MANAGER_URL = "http://127.0.0.1:18788";

function normalizeUrl(url: string) {
  return url.replace(/\/+$/, "");
}

export function managerBase() {
  if (import.meta.env.VITE_COMFYMANAGER_URL) return normalizeUrl(String(import.meta.env.VITE_COMFYMANAGER_URL));
  try {
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) return normalizeUrl(cached);
  } catch {
    /* ignore */
  }
  return DEFAULT_MANAGER_URL;
}

export function setManagerBase(url: string) {
  const next = normalizeUrl(url || DEFAULT_MANAGER_URL);
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  return next;
}

async function mreq<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${managerBase()}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  const json = await res.json();
  if (!res.ok || json.ok === false) throw new Error(json.error || `ComfyManager ${res.status}`);
  return json as T;
}

export const manager = {
  url: managerBase,
  health: () => mreq<{ ok: boolean; comfy: Record<string, unknown> }>("/api/health"),
};
