import type { FeatureId, StationEngine } from "./types";

const KEY = "visualforge.qwen.prefs";

export type QwenPrefs = {
  enabled?: boolean;
  apiKey?: string;
  workspaceId?: string;
  baseUrl?: string;
  engines?: Partial<Record<FeatureId, StationEngine>>;
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

export function resolveQwenEnabled(server?: { enabled?: boolean } | null) {
  return server?.enabled === true || Boolean(readQwenPrefs().enabled);
}
