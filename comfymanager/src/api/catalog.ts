import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { loadSettings, modelsConfigPath, saveSettings } from "./config.ts";
import type { FeatureId, OpenModelDef } from "./types.ts";
import { FEATURE_IDS, FEATURE_LABELS } from "./types.ts";
import { isPrimaryModel } from "./features.ts";
import { loadJson } from "./json.ts";

export function loadOpenModels(): OpenModelDef[] {
  const raw = loadJson<{ models?: OpenModelDef[] }>(modelsConfigPath(), { models: [] });
  return raw.models || [];
}

export function modelDest(model: OpenModelDef) {
  return join(loadSettings().comfy.modelsDir, model.folder, model.filename);
}

export function isInstalled(model: OpenModelDef) {
  return existsSync(modelDest(model));
}

export function findOpenModel(id: string) {
  return loadOpenModels().find((m) => m.id === id);
}

export function resolveModelName(requested?: string, fallback = "") {
  const id = (requested || "").trim();
  if (!id) return fallback;
  const open = findOpenModel(id);
  return open?.filename || id;
}

export function deleteModel(id: string) {
  const model = findOpenModel(id);
  if (!model) throw new Error(`未知模型 ${id}`);
  const dest = modelDest(model);
  if (!existsSync(dest)) throw new Error("本地没有该模型文件");
  unlinkSync(dest);
  const s = loadSettings();
  const active = { ...s.activeModels };
  for (const fid of FEATURE_IDS) {
    if (active[fid] === id) active[fid] = "";
  }
  saveSettings({ activeModels: active });
  return { id, dest };
}

export function modelCatalog() {
  const all = loadOpenModels();
  const s = loadSettings();
  const toDef = (model: OpenModelDef) => ({
    id: model.id,
    label: model.name,
    family: model.family,
    category: model.folder,
    description: model.description + (isInstalled(model) ? "" : "（未下载）"),
    modes: model.features,
    async: model.features.includes("video") || model.features.includes("model3d") || model.features.includes("anim3d"),
    installed: isInstalled(model),
    filename: model.filename,
    license: model.license,
    primary: isPrimaryModel(model),
  });
  const related = (id: FeatureId) => all.filter((m) => m.features.includes(id)).map(toDef);
  const byFeature = (id: FeatureId) => related(id).filter((m) => m.primary);
  const relatedMap = Object.fromEntries(FEATURE_IDS.map((id) => [id, related(id)])) as Record<FeatureId, ReturnType<typeof related>>;
  return {
    image: byFeature("image"),
    video: byFeature("video"),
    music: byFeature("music"),
    tts: byFeature("tts"),
    sfx: byFeature("sfx"),
    model3d: byFeature("model3d"),
    anim3d: byFeature("anim3d"),
    voiceDesign: byFeature("voiceDesign"),
    related: relatedMap,
    imageSizes: [
      { id: "512*512", label: "1:1 · 512" },
      { id: "768*768", label: "1:1 · 768" },
      { id: "1024*1024", label: "1:1 · 1024" },
      { id: "1280*720", label: "16:9 · 720P" },
      { id: "720*1280", label: "9:16 · 竖版" },
    ],
    ttsVoices: ["default", "Chelsie", "Ethan", "Aiden", "Serena"],
    cosyVoices: [] as { id: string; label: string }[],
    languages: ["Chinese", "English", "Japanese", "Korean", "Auto"],
    catalogFile: modelsConfigPath(),
    activeModels: s.activeModels,
    features: s.features,
    featureLabels: FEATURE_LABELS,
    comfy: { baseUrl: s.comfy.baseUrl, modelsDir: s.comfy.modelsDir },
    openModels: all.map((m) => ({
      ...m,
      installed: isInstalled(m),
      dest: modelDest(m),
      primary: isPrimaryModel(m),
    })),
  };
}
