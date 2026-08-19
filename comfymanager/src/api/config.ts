import { mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppSettings, ComfySettings, FeatureId } from "./types.ts";
import { FEATURE_IDS, MODEL_FOLDERS } from "./types.ts";
import { mergeFeatures } from "./features.ts";
import { loadJson, saveJson } from "./json.ts";

const here = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = resolve(here, "../..");

function loadDotEnv() {
  for (const envPath of [join(PACKAGE_ROOT, ".env"), join(PACKAGE_ROOT, "..", ".env")]) {
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

function defaultDataDir() {
  const fromEnv = process.env.COMFYMANAGER_DATA_DIR;
  if (fromEnv) return isAbsolute(fromEnv) ? fromEnv : resolve(PACKAGE_ROOT, fromEnv);
  return join(PACKAGE_ROOT, "data");
}

export function settingsPath(dataDir = defaultDataDir()) {
  return join(dataDir, "settings.json");
}

function defaultInstallDir() {
  return process.env.COMFYUI_INSTALL_DIR
    ? isAbsolute(process.env.COMFYUI_INSTALL_DIR)
      ? process.env.COMFYUI_INSTALL_DIR
      : resolve(PACKAGE_ROOT, process.env.COMFYUI_INSTALL_DIR)
    : join(PACKAGE_ROOT, "comfy");
}

function defaultModelsDir() {
  return process.env.COMFYUI_MODELS_DIR
    ? isAbsolute(process.env.COMFYUI_MODELS_DIR)
      ? process.env.COMFYUI_MODELS_DIR
      : resolve(PACKAGE_ROOT, process.env.COMFYUI_MODELS_DIR)
    : join(PACKAGE_ROOT, "models");
}

function defaultComfy(dataDir: string, stored?: Partial<ComfySettings>): ComfySettings {
  const oldInstall = join(dataDir, "ComfyUI");
  const storedInstall = stored?.installDir || "";
  const installDir =
    storedInstall && storedInstall !== oldInstall ? storedInstall : defaultInstallDir();
  const oldModels = join(dataDir, "models");
  const storedModels = stored?.modelsDir || "";
  const modelsDir =
    storedModels && storedModels !== oldModels ? storedModels : defaultModelsDir();
  return {
    baseUrl: stored?.baseUrl || process.env.COMFYUI_BASE_URL || "http://127.0.0.1:8188",
    apiKey: stored?.apiKey || process.env.COMFYUI_API_KEY || "",
    installDir,
    pythonPath: stored?.pythonPath || process.env.COMFYUI_PYTHON || "",
    extraArgs: stored?.extraArgs || "",
    listenHost: stored?.listenHost || "127.0.0.1",
    listenPort: Number(stored?.listenPort || 8188),
    modelsDir,
    hfToken: stored?.hfToken || process.env.HF_TOKEN || process.env.HUGGING_FACE_HUB_TOKEN || "",
  };
}

function emptyActive(): Record<FeatureId, string> {
  return Object.fromEntries(FEATURE_IDS.map((id) => [id, ""])) as Record<FeatureId, string>;
}

export function loadSettings(): AppSettings {
  const dataDir = defaultDataDir();
  mkdirSync(dataDir, { recursive: true });
  const stored = loadJson<Partial<AppSettings>>(settingsPath(dataDir), {});
  const nextData = stored.dataDir || dataDir;
  return {
    dataDir: nextData,
    host: stored.host || process.env.COMFYMANAGER_HOST || "127.0.0.1",
    port: Number(stored.port || process.env.COMFYMANAGER_PORT || 18788),
    comfy: defaultComfy(nextData, stored.comfy),
    activeModels: { ...emptyActive(), ...(stored.activeModels || {}) },
    features: mergeFeatures(stored.features),
  };
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const current = loadSettings();
  const next: AppSettings = {
    ...current,
    ...patch,
    comfy: { ...current.comfy, ...(patch.comfy || {}) },
    activeModels: { ...current.activeModels, ...(patch.activeModels || {}) },
    features: mergeFeatures({
      ...current.features,
      ...(patch.features || {}),
    }),
  };
  if (patch.comfy && patch.comfy.apiKey === "") next.comfy.apiKey = current.comfy.apiKey;
  if (patch.comfy && patch.comfy.hfToken === "") next.comfy.hfToken = current.comfy.hfToken;
  if (patch.dataDir) {
    next.dataDir = isAbsolute(patch.dataDir) ? patch.dataDir : resolve(PACKAGE_ROOT, patch.dataDir);
  }
  if (next.comfy.installDir && !isAbsolute(next.comfy.installDir)) {
    next.comfy.installDir = resolve(PACKAGE_ROOT, next.comfy.installDir);
  }
  if (next.comfy.modelsDir && !isAbsolute(next.comfy.modelsDir)) {
    next.comfy.modelsDir = resolve(PACKAGE_ROOT, next.comfy.modelsDir);
  }
  mkdirSync(next.dataDir, { recursive: true });
  saveJson(settingsPath(next.dataDir), next);
  ensureLayout(next.dataDir, next.comfy.modelsDir);
  return next;
}

export function ensureLayout(dataDir: string, modelsDir?: string) {
  mkdirSync(dataDir, { recursive: true });
  const models = modelsDir || join(PACKAGE_ROOT, "models");
  mkdirSync(models, { recursive: true });
  for (const folder of MODEL_FOLDERS) mkdirSync(join(models, folder), { recursive: true });
}

export function modelsConfigPath() {
  const local = join(loadSettings().dataDir, "models.json");
  if (existsSync(local)) return local;
  return join(PACKAGE_ROOT, "config", "models.json");
}

export function formatOsPath(p: string) {
  if (!p) return "";
  if (!/[\\/]/.test(p) && !existsSync(p)) return p;
  const n = resolve(p);
  return process.platform === "win32" ? n.replace(/\//g, "\\") : n.replace(/\\/g, "/");
}

export function publicSettings() {
  const s = loadSettings();
  return {
    ...s,
    dataDir: formatOsPath(s.dataDir),
    comfy: {
      ...s.comfy,
      installDir: formatOsPath(s.comfy.installDir),
      modelsDir: formatOsPath(s.comfy.modelsDir),
      pythonPath: s.comfy.pythonPath ? formatOsPath(s.comfy.pythonPath) : "",
      apiKey: s.comfy.apiKey ? `${s.comfy.apiKey.slice(0, 4)}••••` : "",
      hfToken: s.comfy.hfToken ? `${s.comfy.hfToken.slice(0, 4)}••••` : "",
    },
  };
}
