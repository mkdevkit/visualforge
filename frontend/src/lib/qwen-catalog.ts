import type { ModelDef } from "./types";

function m(
  id: string,
  label: string,
  family: string,
  description: string,
  modes: string[],
  async = true,
): ModelDef {
  return { id, label, family, category: family, description, modes, async, installed: true };
}

export const QWEN_TTS_VOICES = [
  "Cherry",
  "Serena",
  "Ethan",
  "Chelsie",
  "Momo",
  "Vivian",
  "Moon",
  "Maia",
  "Kai",
  "Nofish",
  "Bella",
  "Jennifer",
  "Ryan",
  "Katerina",
  "Aiden",
];

export const QWEN_COSY_VOICES = [
  { id: "longanyang", label: "龙安阳" },
  { id: "longxiaochun", label: "龙小淳" },
  { id: "longxiaoxia", label: "龙小夏" },
  { id: "longjielidou", label: "龙杰力豆" },
];

export const QWEN_IMAGE_SIZES = [
  { id: "1024*1024", label: "1:1 · 1024" },
  { id: "1280*1280", label: "1:1 · 1280" },
  { id: "1328*1328", label: "1:1 · 1328" },
  { id: "1664*928", label: "16:9" },
  { id: "1472*1104", label: "4:3" },
  { id: "1104*1472", label: "3:4" },
  { id: "928*1664", label: "9:16" },
  { id: "2048*2048", label: "1:1 · 2048（2.0）" },
];

export const QWEN_CATALOG = {
  image: [
    m("qwen-image-3.0-pro", "Qwen-Image 3.0 Pro", "Qwen-Image", "旗舰生图，支持文生图 / 图生图，异步出图。", ["t2i", "i2i"]),
    m("qwen-image-3.0", "Qwen-Image 3.0", "Qwen-Image", "3.0 标准版，质量与速度折中。", ["t2i", "i2i"]),
    m("qwen-image-2.0-pro", "Qwen-Image 2.0 Pro", "Qwen-Image", "2.0 Pro，同步或短时出图。", ["t2i", "i2i"], false),
    m("qwen-image-2.0", "Qwen-Image 2.0", "Qwen-Image", "2.0 基础版。", ["t2i", "i2i"], false),
  ],
  video: [
    m("wan2.7-t2v", "Wan 2.7 文生视频", "Wan 2.7", "多镜头叙事，可配音画同步。有参考图时请改选 i2v / r2v。", ["t2v"]),
    m("wan2.7-i2v", "Wan 2.7 图生视频", "Wan 2.7", "首帧驱动，可加音频对口型。", ["i2v"]),
    m("wan2.7-r2v", "Wan 2.7 参考生视频", "Wan 2.7", "1–5 张参考图/视频，保持主体。", ["r2v"]),
    m("wan2.6-t2v", "Wan 2.6 文生视频", "Wan 2.6", "2–15 秒，720P / 1080P。", ["t2v"]),
    m("wan2.6-i2v", "Wan 2.6 图生视频", "Wan 2.6", "首帧图生视频。", ["i2v"]),
    m("wan2.5-t2v-preview", "Wan-Video 2.5 文生", "Wan-Video", "带音频预览版，5 / 10 秒。", ["t2v"]),
    m("wan2.5-i2v-preview", "Wan-Video 2.5 图生", "Wan-Video", "图生视频预览版。", ["i2v"]),
    m("wan2.2-t2v-plus", "Wan-Video 2.2 Plus 文生", "Wan-Video", "无声，5 秒，480P / 1080P。", ["t2v"]),
    m("wan2.2-i2v-plus", "Wan-Video 2.2 Plus 图生", "Wan-Video", "无声图生视频。", ["i2v"]),
    m("wan2.2-kf2v-flash", "Wan-Video 2.2 首尾帧", "Wan-Video", "首帧 + 尾帧过渡。", ["kf2v"]),
    m("wan2.1-t2v-turbo", "Wan-Video 2.1 Turbo 文生", "Wan-Video", "更快的 2.1 文生。", ["t2v"]),
    m("wan2.1-t2v-plus", "Wan-Video 2.1 Plus 文生", "Wan-Video", "2.1 高质量文生。", ["t2v"]),
    m("wan2.1-i2v-plus", "Wan-Video 2.1 Plus 图生", "Wan-Video", "2.1 图生视频。", ["i2v"]),
    m("wan2.1-kf2v-plus", "Wan-Video 2.1 首尾帧", "Wan-Video", "2.1 首尾帧。", ["kf2v"]),
    m("happyhorse-1.1-t2v", "HappyHorse 1.1 文生", "HappyHorse", "短视频文生。", ["t2v"]),
    m("happyhorse-1.1-i2v", "HappyHorse 1.1 图生", "HappyHorse", "首帧图生视频。", ["i2v"]),
    m("happyhorse-1.1-r2v", "HappyHorse 1.1 参考生", "HappyHorse", "多参考图保持主体。", ["r2v"]),
  ],
  music: [
    m("fun-music-v1", "Fun-Music v1", "Fun-Music", "完整歌曲或纯音乐；支持歌词与男女声。", ["song"], false),
    m("fun-music-preview", "Fun-Music Preview", "Fun-Music", "预览版，风格描述即可。", ["song"], false),
  ],
  tts: [
    m("qwen-audio-3.0-tts-plus", "Qwen-Audio-TTS Plus", "Qwen-Audio-TTS", "高品质多语种配音，可跟指令。", ["tts"], false),
    m("qwen-audio-3.0-tts-flash", "Qwen-Audio-TTS Flash", "Qwen-Audio-TTS", "低延迟配音。", ["tts"], false),
    m("qwen3-tts-flash", "Qwen3-TTS Flash", "Qwen3-TTS", "常用配音模型，系统音色如 Cherry。", ["tts"], false),
    m("qwen3-tts-instruct-flash", "Qwen3-TTS Instruct Flash", "Qwen3-TTS", "可用自然语言控制语速、情绪。", ["tts"], false),
    m("cosyvoice-v3-plus", "CosyVoice v3 Plus", "CosyVoice", "丰富音色库。", ["tts"], false),
    m("cosyvoice-v3-flash", "CosyVoice v3 Flash", "CosyVoice", "更快的 CosyVoice。", ["tts"], false),
    m("qwen3-omni-flash", "Qwen3-Omni Flash", "Omni", "多模态语音输出。", ["tts"], false),
  ],
  voiceDesign: [
    m("qwen-voice-design", "Qwen 音色设计", "Qwen3-TTS", "用文字描述创建可复用音色，预览写入 data/audio。", ["design"], false),
  ],
  sfx: [
    m("fun-music-v1", "Fun-Music（氛围音效）", "Fun-Music", "按描述生成无人声氛围/拟音。", ["sfx"], false),
    m("qwen3-omni-flash", "Qwen3-Omni（音效描述）", "Omni", "用多模态模型按文字生成音频。", ["sfx"], false),
  ],
  model3d: [
    m("Tripo/Tripo-H3.1", "Tripo H3.1", "Tripo", "高模，最多约 200 万面。须在千问模型市场开通后再调用。", ["t23d", "i23d"]),
    m("Tripo/Tripo-P1.0", "Tripo P1.0", "Tripo", "更快预览，约 2 万面。须在千问模型市场开通后再调用。", ["t23d", "i23d"]),
  ],
  imageSizes: QWEN_IMAGE_SIZES,
  ttsVoices: QWEN_TTS_VOICES,
  cosyVoices: QWEN_COSY_VOICES,
  languages: ["Auto", "Chinese", "English", "Japanese", "Korean", "French", "German", "Spanish"],
  platform: "https://www.qianwenai.com/",
};
