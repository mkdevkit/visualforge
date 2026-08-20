import { mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import type { AppSettings, CloudApiSettings, ComfyFeatureConfig, ComfySettings, FeatureId, QwenSettings, StationProviders, VolcengineSettings } from "./types.js";
import { loadJson, saveJson } from "./lib/json.js";
import { mergeFeatures } from "./lib/features.js";
import { defaultStations } from "./lib/providers.js";

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

/** Windows: %USERPROFILE%\.visualforge  Linux/macOS: ~/.visualforge */
export function userConfigDir() {
  return join(homedir(), ".visualforge");
}

function defaultDataDir() {
  const fromEnv = (process.env.VISUALFORGE_DATA_DIR || "").trim();
  if (fromEnv) return isAbsolute(fromEnv) ? fromEnv : resolve(REPO_ROOT, fromEnv);
  return userConfigDir();
}

export function settingsPath() {
  return join(userConfigDir(), "settings.json");
}

function migrateLegacySettings() {
  mkdirSync(userConfigDir(), { recursive: true });
  const dest = settingsPath();
  if (existsSync(dest)) return;
  const legacyDirs = [join(FRONTEND_ROOT, "data"), join(REPO_ROOT, "frontend", "data")];
  for (const dir of legacyDirs) {
    const src = join(dir, "settings.json");
    if (!existsSync(src)) continue;
    copyFileSync(src, dest);
    break;
  }
}

/** Empty or masked values from the settings page must not overwrite a real key. */
export function isPlaceholderSecret(value?: string) {
  if (value == null) return true;
  const v = value.trim();
  return !v || /[•*]/.test(v) || /^sk-\w{0,4}\.+$/i.test(v);
}

function realSecret(value?: string) {
  return isPlaceholderSecret(value) ? "" : String(value).trim();
}

function defaultComfy(stored?: Partial<ComfySettings>): ComfySettings {
  return {
    baseUrl: stored?.baseUrl || process.env.COMFYUI_BASE_URL || "http://127.0.0.1:8188",
    apiKey: stored?.apiKey || process.env.COMFYUI_API_KEY || "",
  };
}

function defaultQwen(stored?: Partial<QwenSettings> & { enabled?: boolean }): QwenSettings {
  return {
    apiKey: realSecret(stored?.apiKey) || process.env.DASHSCOPE_API_KEY || "",
    workspaceId: stored?.workspaceId || process.env.DASHSCOPE_WORKSPACE_ID || "",
    baseUrl: (stored?.baseUrl || process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/api/v1").replace(/\/+$/, ""),
  };
}

function defaultCloud(
  stored: Partial<CloudApiSettings> | undefined,
  envKey: string,
  envBase: string,
  fallbackBase: string,
): CloudApiSettings {
  return {
    apiKey: realSecret(stored?.apiKey) || process.env[envKey] || "",
    baseUrl: (stored?.baseUrl || process.env[envBase] || fallbackBase).replace(/\/+$/, ""),
  };
}

function defaultVolcengine(stored?: Partial<VolcengineSettings>): VolcengineSettings {
  return {
    apiKey: realSecret(stored?.apiKey) || process.env.ARK_API_KEY || process.env.VOLCENGINE_API_KEY || "",
    baseUrl: (stored?.baseUrl || process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3").replace(/\/+$/, ""),
    accessKeyId: realSecret(stored?.accessKeyId) || process.env.VOLCENGINE_ACCESS_KEY_ID || "",
    secretKey: realSecret(stored?.secretKey) || process.env.VOLCENGINE_SECRET_KEY || "",
  };
}

export function loadSettings(): AppSettings {
  migrateLegacySettings();
  const configDir = userConfigDir();
  mkdirSync(configDir, { recursive: true });
  const stored = loadJson<Partial<AppSettings>>(settingsPath(), {});
  const fallbackData = defaultDataDir();
  const nextData = stored.dataDir
    ? (isAbsolute(stored.dataDir) ? stored.dataDir : resolve(REPO_ROOT, stored.dataDir))
    : fallbackData;
  mkdirSync(nextData, { recursive: true });
  return {
    dataDir: nextData,
    host: stored.host || process.env.VISUALFORGE_HOST || "127.0.0.1",
    port: Number(stored.port || process.env.VISUALFORGE_PORT || 18787),
    managerUrl: stored.managerUrl || process.env.COMFYMANAGER_URL || "http://127.0.0.1:18788",
    comfy: defaultComfy(stored.comfy),
    qwen: defaultQwen(stored.qwen as Partial<QwenSettings> & { enabled?: boolean }),
    meshy: defaultCloud(stored.meshy, "MESHY_API_KEY", "MESHY_BASE_URL", "https://api.meshy.ai"),
    midjourney: defaultCloud(stored.midjourney, "MIDJOURNEY_API_KEY", "MIDJOURNEY_BASE_URL", ""),
    tripo: defaultCloud(stored.tripo, "TRIPO_API_KEY", "TRIPO_BASE_URL", "https://openapi.tripo3d.ai"),
    volcengine: defaultVolcengine(stored.volcengine),
    engines: defaultStations(stored.engines, (stored.qwen as { enabled?: boolean } | undefined)?.enabled),
    features: mergeFeatures(stored.features as Partial<Record<string, Partial<ComfyFeatureConfig>>>),
  };
}

type SettingsPatch = Partial<Omit<AppSettings, "comfy" | "qwen" | "meshy" | "midjourney" | "tripo" | "volcengine" | "engines" | "features">> & {
  comfy?: Partial<ComfySettings>;
  qwen?: Partial<QwenSettings>;
  meshy?: Partial<CloudApiSettings>;
  midjourney?: Partial<CloudApiSettings>;
  tripo?: Partial<CloudApiSettings>;
  volcengine?: Partial<VolcengineSettings>;
  engines?: Partial<Record<FeatureId, StationProviders>>;
  features?: Partial<Record<string, Partial<ComfyFeatureConfig>>>;
};

export function saveSettings(patch: SettingsPatch): AppSettings {
  const current = loadSettings();
  const next: AppSettings = {
    ...current,
    ...patch,
    comfy: { ...current.comfy, ...(patch.comfy || {}) },
    qwen: { ...current.qwen, ...(patch.qwen || {}) },
    meshy: { ...current.meshy, ...(patch.meshy || {}) },
    midjourney: { ...current.midjourney, ...(patch.midjourney || {}) },
    tripo: { ...current.tripo, ...(patch.tripo || {}) },
    volcengine: { ...current.volcengine, ...(patch.volcengine || {}) },
    engines: defaultStations({ ...current.engines, ...(patch.engines || {}) }),
    features: mergeFeatures({
      ...current.features,
      ...(patch.features || {}),
    }),
  };
  if (patch.comfy && isPlaceholderSecret(patch.comfy.apiKey)) next.comfy.apiKey = current.comfy.apiKey;
  if (patch.qwen && isPlaceholderSecret(patch.qwen.apiKey)) next.qwen.apiKey = current.qwen.apiKey;
  if (patch.meshy && isPlaceholderSecret(patch.meshy.apiKey)) next.meshy.apiKey = current.meshy.apiKey;
  if (patch.midjourney && isPlaceholderSecret(patch.midjourney.apiKey)) next.midjourney.apiKey = current.midjourney.apiKey;
  if (patch.tripo && isPlaceholderSecret(patch.tripo.apiKey)) next.tripo.apiKey = current.tripo.apiKey;
  if (patch.volcengine && isPlaceholderSecret(patch.volcengine.apiKey)) next.volcengine.apiKey = current.volcengine.apiKey;
  if (patch.volcengine && isPlaceholderSecret(patch.volcengine.accessKeyId)) next.volcengine.accessKeyId = current.volcengine.accessKeyId;
  if (patch.volcengine && isPlaceholderSecret(patch.volcengine.secretKey)) next.volcengine.secretKey = current.volcengine.secretKey;
  if (patch.dataDir) {
    next.dataDir = isAbsolute(patch.dataDir) ? patch.dataDir : resolve(REPO_ROOT, patch.dataDir);
  }
  mkdirSync(userConfigDir(), { recursive: true });
  mkdirSync(next.dataDir, { recursive: true });
  saveJson(settingsPath(), next);
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
