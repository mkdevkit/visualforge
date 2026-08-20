const KEY = "visualforge.qwen.prefs";

export type QwenPrefs = {
  apiKey?: string;
  workspaceId?: string;
  baseUrl?: string;
};

export function readQwenPrefs(): QwenPrefs {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "null") || {};
  } catch {
    return {};
  }
}

export function writeQwenPrefs(patch: QwenPrefs) {
  const next = { ...readQwenPrefs(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
