import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppSettings, ComfyFeatureConfig, ComfySettings } from "./types.js";
import { loadJson, saveJson } from "./lib/json.js";
import { mergeFeatures } from "./lib/features.js";

const here = dirname(fileURLToPath(import.meta.url));
export const FRONTEND_ROOT = resolve(here, "../..");
export const REPO_ROOT = resolve(here, "../../..");

function loadDotEnv() {
  for (const envPath of [join(FRONTEND_ROOT, ".env"), join(REPO_ROOT, ".env")]) {
    if (!existsSync(envPath)) continue;
    const text = readFileSync(envPath, "utf8");
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
      if (!(key in process.env)) process.env[key] = value;
    }
  }
}

loadDotEnv();

const CATEGORIES = ["images", "videos", "music", "audio", "models3d", "uploads"] as const;

function defaultDataDir() {
  const fromEnv = process.env.VISUALFORGE_DATA_DIR;
  if (fromEnv) return isAbsolute(fromEnv) ? fromEnv : resolve(REPO_ROOT, fromEnv);
  return join(FRONTEND_ROOT, "data");
}

export function settingsPath(dataDir = defaultDataDir()) {
  return join(dataDir, "settings.json");
}

function defaultComfy(stored?: Partial<ComfySettings>): ComfySettings {
  return {
    baseUrl: stored?.baseUrl || process.env.COMFYUI_BASE_URL || "http://127.0.0.1:8188",
    apiKey: stored?.apiKey || process.env.COMFYUI_API_KEY || "",
  };
}

export function loadSettings(): AppSettings {
  const dataDir = defaultDataDir();
  mkdirSync(dataDir, { recursive: true });
  const stored = loadJson<Partial<AppSettings>>(settingsPath(dataDir), {});
  const nextData = stored.dataDir || dataDir;
  return {
    dataDir: nextData,
    host: stored.host || process.env.VISUALFORGE_HOST || "127.0.0.1",
    port: Number(stored.port || process.env.VISUALFORGE_PORT || 18787),
    managerUrl: stored.managerUrl || process.env.COMFYMANAGER_URL || "http://127.0.0.1:18788",
    comfy: defaultComfy(stored.comfy),
    features: mergeFeatures(stored.features as Partial<Record<string, Partial<ComfyFeatureConfig>>>),
  };
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const current = loadSettings();
  const next: AppSettings = {
    ...current,
    ...patch,
    comfy: { ...current.comfy, ...(patch.comfy || {}) },
    features: mergeFeatures({
      ...current.features,
      ...(patch.features || {}),
    }),
  };
  if (patch.comfy && patch.comfy.apiKey === "") next.comfy.apiKey = current.comfy.apiKey;
  if (patch.dataDir) {
    next.dataDir = isAbsolute(patch.dataDir) ? patch.dataDir : resolve(REPO_ROOT, patch.dataDir);
  }
  mkdirSync(next.dataDir, { recursive: true });
  saveJson(settingsPath(next.dataDir), next);
  ensureDataLayout(next.dataDir);
  return next;
}

export function ensureDataLayout(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  for (const dir of CATEGORIES) mkdirSync(join(dataDir, dir), { recursive: true });
  const mixamo = join(dataDir, "motions", "mixamo");
  mkdirSync(mixamo, { recursive: true });
  const hint = join(mixamo, "放到 Mixamo GLB.txt");
  if (!existsSync(hint)) {
    writeFileSync(
      hint,
      [
        "把你从 mixamo.com 下载并转成 GLB 的动作文件放在这个文件夹。",
        "Mixamo 原生是 FBX：可在视铸工位直接上传 FBX（需本机 Blender），或先用 Blender 导出 GLB。",
        "Adobe 禁止把原始 Mixamo FBX 当素材包再分发，所以视铸不会内置这些文件。",
        "",
      ].join("\n"),
      "utf8",
    );
  }
}

export function webDistDir() {
  return resolve(FRONTEND_ROOT, "dist");
}

export { CATEGORIES };
