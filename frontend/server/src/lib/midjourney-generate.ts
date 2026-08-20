import { loadSettings } from "../config.js";
import type { GenerateImageBody } from "../types.js";
import { CloudError } from "./cloud-http.js";

export async function generateImageMidjourney(_body: GenerateImageBody): Promise<never> {
  const s = loadSettings().midjourney;
  const gateway = (s.baseUrl || "").trim();
  if (!gateway) {
    throw new CloudError(
      "Midjourney 没有官方公开 API，视铸不会走 Discord 或非官方爬站。请到设置页填写兼容网关地址和 Key，或改用 Meshy / 千问 / ComfyUI 生图。官网：https://www.midjourney.com/",
      400,
      "NO_OFFICIAL_API",
    );
  }
  throw new CloudError(
    `已填写 Midjourney 网关 ${gateway}，但视铸尚未接入任何非官方协议（不会调用 PiAPI / ImagineAPI 等）。请改用 Meshy / 千问 / ComfyUI，或之后再指定兼容协议。`,
    400,
    "GATEWAY_NOT_WIRED",
  );
}
