export type AssetType = "image" | "video" | "music" | "audio" | "model3d";

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
  license?: string;
  primary?: boolean;
}

export interface AssetRecord {
  id: string;
  type: AssetType;
  kind?: string;
  filename: string;
  relPath: string;
  mime: string;
  size: number;
  prompt: string;
  model: string;
  params: Record<string, unknown>;
  favorite: boolean;
  tags: string[];
  title: string;
  notes: string;
  createdAt: string;
}

export interface TaskRecord {
  id: string;
  remoteTaskId?: string;
  type: AssetType;
  model: string;
  prompt: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  progress: number;
  error?: string;
  assetIds: string[];
  createdAt: string;
}

export interface DesignedVoice {
  id: string;
  name: string;
  prompt: string;
  targetModel: string;
  designModel: string;
  createdAt: string;
  previewAssetId?: string;
}

export type ComfyMode = "prompt" | "http";
export type FeatureId = "image" | "video" | "music" | "tts" | "sfx" | "voiceDesign" | "model3d" | "anim3d";
export type StationEngine = "comfyui" | "qwen";

export interface StationWorkflowRef {
  id: string;
  name: string;
  source?: string;
  enabled?: boolean;
}

export interface ComfyFeatureConfig {
  mode: ComfyMode;
  url: string;
  model: string;
  workflow: string;
  workflowSource?: string;
  workflows?: StationWorkflowRef[];
  activeWorkflowId?: string;
  extraHeaders: Record<string, string>;
  timeoutMs: number;
}

export interface AppSettingsView {
  dataDir: string;
  host: string;
  port: number;
  managerUrl: string;
  comfy: {
    baseUrl: string;
    apiKey: string;
  };
  qwen: {
    enabled?: boolean;
    apiKey: string;
    workspaceId: string;
    baseUrl: string;
    configured?: boolean;
  };
  engines: Record<FeatureId, StationEngine>;
  features: Record<FeatureId, ComfyFeatureConfig>;
}

export interface OpenModel {
  id: string;
  name: string;
  family: string;
  description: string;
  folder: string;
  filename: string;
  url: string;
  sizeBytes?: number;
  features: string[];
  license?: string;
  installed?: boolean;
  dest?: string;
}

export interface DownloadJob {
  id: string;
  modelId: string;
  filename: string;
  dest: string;
  status: string;
  progress: number;
  bytes: number;
  total: number;
  error?: string;
}

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

export interface Catalog {
  image: ModelDef[];
  video: ModelDef[];
  music: ModelDef[];
  tts: ModelDef[];
  sfx: ModelDef[];
  model3d: ModelDef[];
  anim3d: ModelDef[];
  voiceDesign: ModelDef[];
  related?: Partial<Record<FeatureId, ModelDef[]>>;
  imageSizes: { id: string; label: string }[];
  ttsVoices: string[];
  cosyVoices: { id: string; label: string }[];
  languages: string[];
  openModels?: OpenModel[];
  catalogFile?: string;
  activeModels?: Partial<Record<FeatureId, string>>;
  features?: Partial<Record<FeatureId, ComfyFeatureConfig>>;
  managerUrl?: string;
  loadError?: string;
  platform?: string;
  protocol?: string;
}
