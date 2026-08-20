import type { ModelDef } from "../types.js";

function m(id: string, label: string, family: string, description: string, modes: string[]): ModelDef {
  return { id, label, family, category: family, description, modes, async: true, installed: true };
}

export const MESHY_IMAGE_SIZES = [
  { id: "1:1", label: "1:1" },
  { id: "16:9", label: "16:9" },
  { id: "9:16", label: "9:16" },
  { id: "4:3", label: "4:3" },
  { id: "3:4", label: "3:4" },
  { id: "3:2", label: "3:2（GPT Image 2）" },
  { id: "2:3", label: "2:3（GPT Image 2）" },
];

export const MESHY_CATALOG = {
  image: [
    m("nano-banana", "Nano Banana", "Meshy Image", "标准生图，3 积分/张。", ["t2i", "i2i"]),
    m("nano-banana-2", "Nano Banana 2", "Meshy Image", "能力更强的平衡版，6 积分/张。", ["t2i", "i2i"]),
    m("nano-banana-pro", "Nano Banana Pro", "Meshy Image", "更高质量，9 积分/张。", ["t2i", "i2i"]),
    m("gpt-image-2", "GPT Image 2", "Meshy Image", "高保真，仅支持 1:1 / 3:2 / 2:3。", ["t2i", "i2i"]),
  ],
  model3d: [
    m("latest", "Meshy 7（latest）", "Meshy 3D", "当前默认，等同 meshy-7。文生 3D 先 preview 再 refine。", ["t23d", "i23d"]),
    m("meshy-7", "Meshy 7", "Meshy 3D", "最新高模，支持 Ultra。", ["t23d", "i23d"]),
    m("meshy-6", "Meshy 6", "Meshy 3D", "上一代标准模型。", ["t23d", "i23d"]),
    m("meshy-5", "Meshy 5", "Meshy 3D", "更省积分的旧模型。", ["t23d", "i23d"]),
  ],
};

export const MIDJOURNEY_CATALOG = {
  image: [
    m("v7", "Midjourney V7", "Midjourney", "官方没有公开 API。未填兼容网关时无法真正出图。", ["t2i"]),
    m("niji-7", "Niji 7", "Midjourney", "二次元风格。同样需要兼容网关。", ["t2i"]),
  ],
  imageSizes: [
    { id: "1:1", label: "1:1" },
    { id: "16:9", label: "16:9" },
    { id: "9:16", label: "9:16" },
  ],
};

export const TRIPO_CATALOG = {
  model3d: [
    m("v3.1-20260211", "Tripo v3.1", "Tripo", "官方 OpenAPI 最新高质量。与千问云里的 Tripo 不是同一条线路。", ["t23d", "i23d"]),
    m("v3.0-20250812", "Tripo v3.0", "Tripo", "稳定版。", ["t23d", "i23d"]),
    m("v2.5-20250123", "Tripo v2.5", "Tripo", "速度与质量折中。", ["t23d", "i23d"]),
    m("P1-20260311", "Tripo P1", "Tripo", "更快预览。", ["t23d", "i23d"]),
  ],
};

export const VOLC_IMAGE_SIZES = [
  { id: "2K", label: "2K" },
  { id: "4K", label: "4K" },
  { id: "2048x2048", label: "1:1 · 2048" },
  { id: "2560x1440", label: "16:9 · 2K" },
  { id: "1440x2560", label: "9:16 · 2K" },
  { id: "2304x1728", label: "4:3 · 2K" },
  { id: "1728x2304", label: "3:4 · 2K" },
];

export const VOLCENGINE_CATALOG = {
  image: [
    m("doubao-seedream-5-0-260128", "Seedream 5.0", "豆包图像", "方舟最新图像创作，文生图 / 图生图。", ["t2i", "i2i"]),
    m("doubao-seedream-4-0-250828", "Seedream 4.0", "豆包图像", "成熟稳定的 4K 生图。", ["t2i", "i2i"]),
  ],
  video: [
    m("doubao-seedance-1-5-pro-251215", "Seedance 1.5 Pro", "豆包视频", "文生 / 图生 / 首尾帧。建议 5–12 秒。", ["t2v", "i2v"]),
    m("doubao-seedance-1-0-pro-250528", "Seedance 1.0 Pro", "豆包视频", "高质量标准版。", ["t2v", "i2v"]),
    m("doubao-seedance-1-0-pro-fast-251015", "Seedance 1.0 Pro Fast", "豆包视频", "更快、更省。", ["t2v", "i2v"]),
    m("doubao-seedance-2-0-260128", "Seedance 2.0", "豆包视频", "多模态参考生视频。需账号已开通该模型。", ["t2v", "i2v"]),
  ],
  music: [
    m("gen-song", "海绵音乐 · 人声歌曲", "豆包音乐", "GenSongV4。需火山引擎 Access Key（不是方舟 API Key）。", ["song"]),
    m("gen-bgm", "海绵音乐 · 纯音乐", "豆包音乐", "GenBGM。需火山引擎 Access Key。", ["instrumental"]),
  ],
};

export function pickCatalogModel(list: ModelDef[], requested?: string) {
  if (requested && list.some((item) => item.id === requested)) return requested;
  return list[0]?.id || requested || "";
}
