import { basename, extname, join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { AssetRecord } from "../types.js";
import { absPath, saveBuffer } from "./storage.js";
import { downloadUrl } from "./dashscope.js";

export function resolveLocal(value?: string) {
  if (!value || /^(https?:\/\/|data:|oss:\/\/)/i.test(value)) return undefined;
  return absPath(value.startsWith("uploads/") || value.includes("/") ? value : join("uploads", value));
}

export function toDataUri(value: string): string {
  if (/^(https?:\/\/|data:)/i.test(value)) return value;
  const local = resolveLocal(value);
  if (!local || !existsSync(local)) {
    throw new Error(`找不到本地参考文件：${value}`);
  }
  const buf = readFileSync(local);
  const ext = extname(local).replace(".", "").toLowerCase();
  const mime =
    ext === "png" ? "image/png"
    : ext === "webp" ? "image/webp"
    : ext === "gif" ? "image/gif"
    : "image/jpeg";
  return `data:${mime};base64,${buf.toString("base64")}`;
}

export function localFile(value: string) {
  if (/^(https?:\/\/|data:)/i.test(value)) return undefined;
  const local = resolveLocal(value);
  if (!local || !existsSync(local)) throw new Error(`找不到本地参考文件：${value}`);
  return { path: local, name: basename(local), buffer: readFileSync(local) };
}

function mimeOf(ext: string, type: AssetRecord["type"]) {
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "mp4") return "video/mp4";
  if (ext === "glb") return "model/gltf-binary";
  if (ext === "gltf") return "model/gltf+json";
  if (type === "image") return "image/png";
  if (type === "model3d") return "model/gltf-binary";
  return "application/octet-stream";
}

function fallbackExt(type: AssetRecord["type"]) {
  if (type === "image") return "png";
  if (type === "model3d") return "glb";
  if (type === "video") return "mp4";
  if (type === "music" || type === "audio") return "mp3";
  return "bin";
}

function pickUrls(urls: string[], type: AssetRecord["type"]) {
  if (type === "model3d") {
    const meshes = urls.filter((u) => !/\.(png|jpe?g|webp|gif)(\?|$)/i.test(u));
    return meshes.length ? meshes : urls;
  }
  if (type === "image") {
    const imgs = urls.filter((u) => !/\.(mp4|webm|mp3|wav|glb|gltf)(\?|$)/i.test(u));
    return imgs.length ? imgs : urls;
  }
  return urls;
}

export async function persistRemoteUrls(opts: {
  urls: string[];
  type: AssetRecord["type"];
  prompt: string;
  model: string;
  provider: string;
  params?: Record<string, unknown>;
  title?: string;
  tags?: string[];
  kind?: AssetRecord["kind"];
}): Promise<AssetRecord[]> {
  const urls = pickUrls(opts.urls.filter(Boolean), opts.type);
  const assets: AssetRecord[] = [];
  for (const url of urls) {
    const file = await downloadUrl(url);
    const ext = file.ext && file.ext !== "bin" ? file.ext : fallbackExt(opts.type);
    assets.push(
      saveBuffer({
        type: opts.type,
        buffer: file.buffer,
        ext,
        mime: file.mime && file.mime !== "application/octet-stream" ? file.mime : mimeOf(ext, opts.type),
        prompt: opts.prompt,
        model: opts.model,
        params: { provider: opts.provider, ...(opts.params || {}) },
        title: opts.title,
        tags: opts.tags,
        kind: opts.kind,
        remoteUrl: url,
      }),
    );
  }
  return assets;
}
