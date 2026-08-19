import type { ComfyFeatureConfig, FeatureId } from "../types.js";

export const FEATURE_IDS: FeatureId[] = [
  "image",
  "video",
  "music",
  "tts",
  "sfx",
  "voiceDesign",
  "model3d",
  "anim3d",
];

export const FEATURE_LABELS: Record<FeatureId, string> = {
  image: "生图",
  video: "生视频",
  music: "生音乐",
  tts: "配音",
  sfx: "音效",
  voiceDesign: "音色设计",
  model3d: "生 3D",
  anim3d: "3D 动画",
};

export const MODEL_FOLDERS = [
  "checkpoints",
  "loras",
  "vae",
  "controlnet",
  "clip",
  "clip_vision",
  "unet",
  "diffusion_models",
  "text_encoders",
  "upscale_models",
  "embeddings",
  "audio_encoders",
  "tts",
] as const;

export function defaultComfyFeature(): ComfyFeatureConfig {
  return {
    mode: "prompt",
    url: "",
    model: "",
    workflow: "",
    extraHeaders: {},
    timeoutMs: 300000,
  };
}

export function defaultFeatures(): Record<FeatureId, ComfyFeatureConfig> {
  return Object.fromEntries(FEATURE_IDS.map((id) => [id, defaultComfyFeature()])) as Record<FeatureId, ComfyFeatureConfig>;
}

export function mergeFeatures(stored?: Partial<Record<FeatureId, Partial<ComfyFeatureConfig>>>): Record<FeatureId, ComfyFeatureConfig> {
  const base = defaultFeatures();
  if (!stored) return base;
  for (const id of FEATURE_IDS) {
    const patch = stored[id] as (Partial<ComfyFeatureConfig> & { comfy?: Partial<ComfyFeatureConfig>; provider?: string }) | undefined;
    if (!patch) continue;
    const fromOld = patch.comfy || {};
    const merged = { ...base[id], ...fromOld, ...patch };
    if (!merged.extraHeaders || typeof merged.extraHeaders !== "object") merged.extraHeaders = {};
    if (!merged.timeoutMs) merged.timeoutMs = 300000;
    base[id] = {
      mode: merged.mode === "http" ? "http" : "prompt",
      url: merged.url || "",
      model: merged.model || "",
      workflow: merged.workflow || "",
      extraHeaders: merged.extraHeaders,
      timeoutMs: merged.timeoutMs,
    };
  }
  return base;
}

export const HTTP_BODY_TEMPLATES: Record<FeatureId, string> = {
  image: `{
  "prompt": "{{prompt}}",
  "negative_prompt": "{{negative}}",
  "model": "{{model}}",
  "width": "{{width}}",
  "height": "{{height}}",
  "n": "{{n}}",
  "seed": "{{seed}}",
  "image": "{{image}}"
}`,
  video: `{
  "prompt": "{{prompt}}",
  "model": "{{model}}",
  "duration": "{{duration}}",
  "resolution": "{{resolution}}",
  "ratio": "{{ratio}}",
  "first_frame": "{{image}}",
  "last_frame": "{{image2}}"
}`,
  music: `{
  "prompt": "{{prompt}}",
  "lyrics": "{{lyrics}}",
  "model": "{{model}}",
  "instrumental": "{{instrumental}}"
}`,
  tts: `{
  "text": "{{text}}",
  "voice": "{{voice}}",
  "model": "{{model}}",
  "instructions": "{{instructions}}"
}`,
  sfx: `{
  "prompt": "{{prompt}}",
  "model": "{{model}}",
  "duration": "{{duration}}"
}`,
  voiceDesign: `{
  "voice_prompt": "{{prompt}}",
  "name": "{{name}}",
  "model": "{{model}}"
}`,
  model3d: `{
  "prompt": "{{prompt}}",
  "model": "{{model}}",
  "image": "{{image}}"
}`,
  anim3d: `{
  "prompt": "{{prompt}}",
  "model": "{{model}}",
  "image": "{{image}}",
  "image2": "{{image2}}",
  "duration": "{{duration}}"
}`,
};
