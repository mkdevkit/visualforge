export type FeatureId = "image" | "video" | "music" | "tts" | "sfx" | "voiceDesign" | "model3d" | "anim3d";

export const FEATURE_IDS: FeatureId[] = [
  "image", "video", "music", "tts", "sfx", "voiceDesign", "model3d", "anim3d",
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
  "checkpoints", "loras", "vae", "controlnet", "clip", "clip_vision",
  "unet", "diffusion_models", "text_encoders", "upscale_models",
  "embeddings", "audio_encoders", "tts",
] as const;

export interface OpenModelDef {
  id: string;
  name: string;
  family: string;
  description: string;
  folder: string;
  filename: string;
  url: string;
  sizeBytes?: number;
  features: FeatureId[];
  license?: string;
  source?: string;
}

export interface ComfySettings {
  baseUrl: string;
  apiKey: string;
  installDir: string;
  pythonPath: string;
  extraArgs: string;
  listenHost: string;
  listenPort: number;
  modelsDir: string;
  hfToken: string;
}

export interface AppSettings {
  dataDir: string;
  host: string;
  port: number;
  comfy: ComfySettings;
  activeModels: Record<FeatureId, string>;
  features: Record<FeatureId, import("./features.ts").ComfyFeatureConfig>;
}
