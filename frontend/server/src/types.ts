export type AssetType = "image" | "video" | "music" | "audio" | "model3d";
export type AudioKind = "tts" | "sfx" | "voice-preview" | "other";
export type TaskStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type ComfyMode = "prompt" | "http";
export type FeatureId = "image" | "video" | "music" | "tts" | "sfx" | "voiceDesign" | "model3d" | "anim3d";

export interface ComfyFeatureConfig {
  mode: ComfyMode;
  url: string;
  model: string;
  workflow: string;
  extraHeaders: Record<string, string>;
  timeoutMs: number;
}

export interface ComfySettings {
  baseUrl: string;
  apiKey: string;
}

export interface AppSettings {
  dataDir: string;
  host: string;
  port: number;
  managerUrl: string;
  comfy: ComfySettings;
  features: Record<FeatureId, ComfyFeatureConfig>;
}

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

export interface AssetRecord {
  id: string;
  type: AssetType;
  kind?: AudioKind | "t2i" | "i2i" | "t2v" | "i2v" | "r2v" | "song" | "instrumental" | "t23d" | "i23d";
  filename: string;
  relPath: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  duration?: number;
  prompt: string;
  negativePrompt?: string;
  model: string;
  params: Record<string, unknown>;
  favorite: boolean;
  tags: string[];
  title: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  remoteUrl?: string;
  extraFiles?: Array<{ relPath: string; label: string }>;
}

export interface TaskRecord {
  id: string;
  remoteTaskId?: string;
  type: AssetType;
  model: string;
  prompt: string;
  status: TaskStatus;
  progress: number;
  error?: string;
  assetIds: string[];
  createdAt: string;
  updatedAt: string;
  payload: Record<string, unknown>;
}

export interface ModelDef {
  id: string;
  label: string;
  family: string;
  category: string;
  description: string;
  modes: string[];
  async: boolean;
  installed?: boolean;
  filename?: string;
}

export interface GenerateImageBody {
  model?: string;
  prompt: string;
  negativePrompt?: string;
  size?: string;
  n?: number;
  seed?: number;
  watermark?: boolean;
  promptExtend?: boolean;
  promptExtendMode?: "direct" | "agent";
  enableThinking?: boolean;
  images?: string[];
  title?: string;
  tags?: string[];
}

export interface GenerateVideoBody {
  model?: string;
  prompt: string;
  negativePrompt?: string;
  resolution?: string;
  ratio?: string;
  duration?: number;
  promptExtend?: boolean;
  watermark?: boolean;
  audio?: boolean;
  firstFrame?: string;
  lastFrame?: string;
  audioUrl?: string;
  referenceImages?: string[];
  referenceVideos?: string[];
  sizeHint?: string;
  title?: string;
  tags?: string[];
}

export interface GenerateMusicBody {
  model?: string;
  prompt?: string;
  lyrics?: string;
  gender?: "male" | "female";
  isInstrumental?: boolean;
  format?: "mp3" | "wav";
  watermark?: boolean;
  title?: string;
  tags?: string[];
}

export interface GenerateTtsBody {
  model?: string;
  text: string;
  voice?: string;
  languageType?: string;
  format?: string;
  sampleRate?: number;
  instructions?: string;
  title?: string;
  tags?: string[];
}

export interface VoiceDesignBody {
  model?: string;
  targetModel?: string;
  voicePrompt: string;
  previewText?: string;
  preferredName?: string;
  prefix?: string;
  language?: string;
}

export interface GenerateSfxBody {
  model?: string;
  prompt: string;
  duration?: number;
  format?: string;
  title?: string;
  tags?: string[];
}

export interface Generate3dBody {
  model?: string;
  prompt?: string;
  image?: string;
  images?: string[];
  textureQuality?: "standard" | "detailed";
  geometryQuality?: "standard" | "ultra";
  pbr?: boolean;
  texture?: boolean;
  title?: string;
  tags?: string[];
}
