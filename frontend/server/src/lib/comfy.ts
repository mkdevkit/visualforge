import { readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { loadSettings } from "../config.js";
import type { ComfyFeatureConfig, FeatureId } from "../types.js";
import { HTTP_BODY_TEMPLATES } from "./features.js";

export class ComfyError extends Error {
  status: number;
  code?: string;
  raw?: unknown;
  constructor(message: string, status = 502, code?: string, raw?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.raw = raw;
  }
}

export interface ComfyFile {
  buffer: Buffer;
  mime: string;
  ext: string;
  filename?: string;
}

export interface ComfyRunResult {
  files: ComfyFile[];
  raw: unknown;
  promptId?: string;
  voice?: string;
}

function trimSlash(url: string) {
  return url.replace(/\/+$/, "");
}

export function comfyBase(cfg: ComfyFeatureConfig) {
  const settings = loadSettings();
  const raw = (cfg.url || settings.comfy.baseUrl || "http://127.0.0.1:8188").trim();
  return trimSlash(raw);
}

function comfyHeaders(extra: Record<string, string> = {}) {
  const { comfy } = loadSettings();
  const headers: Record<string, string> = { ...extra };
  if (comfy.apiKey) headers.Authorization = `Bearer ${comfy.apiKey}`;
  return headers;
}

export async function comfyFetch(url: string, init: RequestInit = {}, extraHeaders: Record<string, string> = {}) {
  const headers = {
    ...comfyHeaders(extraHeaders),
    ...(init.headers as Record<string, string> | undefined),
  };
  if (typeof FormData !== "undefined" && init.body instanceof FormData) {
    delete headers["Content-Type"];
    delete headers["content-type"];
  }
  const res = await fetch(url, { ...init, headers });
  const text = await res.text();
  let json: unknown = text;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const obj = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    throw new ComfyError(String(obj.error || obj.message || text || `HTTP ${res.status}`), res.status, "COMFY_HTTP", json);
  }
  return { json, text, res };
}

export async function pingComfy(baseUrl?: string) {
  const base = trimSlash(baseUrl || loadSettings().comfy.baseUrl || "http://127.0.0.1:8188");
  try {
    const { json, res } = await comfyFetch(`${base}/system_stats`);
    return { ok: true, baseUrl: base, status: res.status, stats: json };
  } catch (err) {
    return { ok: false, baseUrl: base, error: err instanceof Error ? err.message : String(err) };
  }
}

export function applyVars(value: unknown, vars: Record<string, unknown>): unknown {
  if (typeof value === "string") {
    const exact = value.match(/^\{\{(\w+)\}\}$/);
    if (exact && Object.prototype.hasOwnProperty.call(vars, exact[1])) {
      const v = vars[exact[1]];
      return v === undefined ? "" : v;
    }
    return value.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      const v = vars[key];
      if (v === undefined || v === null) return "";
      return typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v);
    });
  }
  if (Array.isArray(value)) return value.map((item) => applyVars(item, vars));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = applyVars(v, vars);
    return out;
  }
  return value;
}

function parseJsonTemplate(raw: string, feature: FeatureId, mode: ComfyFeatureConfig["mode"]) {
  const text = raw.trim() || (mode === "http" ? HTTP_BODY_TEMPLATES[feature] : "");
  if (!text) {
    throw new ComfyError(
      "请先在 ComfyManager「工作流」页粘贴该工位的 ComfyUI API 格式工作流，并使用 {{prompt}}、{{model}} 等占位符。",
      400,
      "NO_WORKFLOW",
    );
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ComfyError("工作流 / 请求体不是合法 JSON", 400, "BAD_WORKFLOW");
  }
}

function guessMime(name: string, fallback: string) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    gif: "image/gif",
    mp4: "video/mp4",
    webm: "video/webm",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    flac: "audio/flac",
    glb: "model/gltf-binary",
    gltf: "model/gltf+json",
  };
  return map[ext] || fallback;
}

function extFromName(name: string, fallback: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  return ext || fallback;
}

export async function uploadComfyImage(base: string, filePath: string, extraHeaders: Record<string, string>) {
  const buf = readFileSync(filePath);
  const filename = basename(filePath);
  const form = new FormData();
  const mime = guessMime(filename, "image/png");
  form.set("image", new Blob([new Uint8Array(buf)], { type: mime }), filename);
  form.set("overwrite", "true");
  const { json } = await comfyFetch(`${base}/upload/image`, { method: "POST", body: form }, extraHeaders);
  const rec = json as Record<string, string>;
  return rec.name || rec.filename || filename;
}

function collectViewRefs(value: unknown, acc: Array<{ filename: string; subfolder?: string; type?: string }> = []) {
  if (Array.isArray(value)) {
    for (const item of value) collectViewRefs(item, acc);
    return acc;
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec.filename === "string") {
      acc.push({
        filename: rec.filename,
        subfolder: typeof rec.subfolder === "string" ? rec.subfolder : "",
        type: typeof rec.type === "string" ? rec.type : "output",
      });
    }
    for (const v of Object.values(rec)) collectViewRefs(v, acc);
  }
  return acc;
}

async function downloadView(
  base: string,
  ref: { filename: string; subfolder?: string; type?: string },
  extraHeaders: Record<string, string>,
): Promise<ComfyFile> {
  const qs = new URLSearchParams({
    filename: ref.filename,
    subfolder: ref.subfolder || "",
    type: ref.type || "output",
  });
  const res = await fetch(`${base}/view?${qs}`, { headers: comfyHeaders(extraHeaders) });
  if (!res.ok) throw new ComfyError(`下载 ComfyUI 成品失败 ${res.status}: ${ref.filename}`, res.status);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get("content-type") || guessMime(ref.filename, "application/octet-stream");
  return { buffer, mime, ext: extFromName(ref.filename, "bin"), filename: ref.filename };
}

async function waitHistory(base: string, promptId: string, timeoutMs: number, extraHeaders: Record<string, string>) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const peeked = await peekHistory(base, promptId, extraHeaders);
    if (peeked.error) throw new ComfyError(peeked.error, 502, "COMFY_FAILED", peeked.raw);
    if (peeked.ready && peeked.entry) return peeked.entry;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new ComfyError("等待 ComfyUI 完成超时", 504, "COMFY_TIMEOUT");
}

async function peekHistory(base: string, promptId: string, extraHeaders: Record<string, string>) {
  const { json } = await comfyFetch(`${base}/history/${encodeURIComponent(promptId)}`, {}, extraHeaders);
  const rec = json as Record<string, unknown>;
  const entry = (rec[promptId] || rec) as Record<string, unknown>;
  const status = entry.status as Record<string, unknown> | undefined;
  const outputs = entry.outputs;
  const messages = JSON.stringify(status?.messages || []);
  if (status?.status_str === "error" || messages.includes("execution_error")) {
    return { ready: false, error: "ComfyUI 工作流执行失败", raw: json, entry };
  }
  if (outputs && typeof outputs === "object" && Object.keys(outputs as object).length) {
    if (!status || status.completed || status.status_str === "success") {
      return { ready: true, entry, raw: json };
    }
  }
  return { ready: false, raw: json, entry };
}

export async function peekComfy(cfg: ComfyFeatureConfig, promptId: string) {
  return peekHistory(comfyBase(cfg), promptId, cfg.extraHeaders);
}

function decodeDataUrl(value: string): ComfyFile | undefined {
  const m = value.match(/^data:([^;]+);base64,(.+)$/);
  if (!m) return undefined;
  const mime = m[1];
  const buffer = Buffer.from(m[2], "base64");
  const ext = mime.split("/")[1]?.replace("jpeg", "jpg") || "bin";
  return { buffer, mime, ext };
}

function collectHttpFiles(value: unknown, acc: Array<string | ComfyFile> = []) {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) || value.startsWith("data:")) acc.push(value);
    else if (/^[A-Za-z0-9+/]+=*$/.test(value) && value.length > 200) acc.push(`data:application/octet-stream;base64,${value}`);
    return acc;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectHttpFiles(item, acc);
    return acc;
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    for (const key of ["url", "image", "video", "audio", "file", "b64_json", "images", "urls", "files", "output"]) {
      if (key in rec) collectHttpFiles(rec[key], acc);
    }
    for (const v of Object.values(rec)) collectHttpFiles(v, acc);
  }
  return acc;
}

async function materializeHttpFiles(items: Array<string | ComfyFile>, extraHeaders: Record<string, string>): Promise<ComfyFile[]> {
  const files: ComfyFile[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (typeof item !== "string") {
      files.push(item);
      continue;
    }
    if (seen.has(item)) continue;
    seen.add(item);
    const data = decodeDataUrl(item);
    if (data) {
      files.push(data);
      continue;
    }
    if (/^https?:\/\//i.test(item)) {
      const res = await fetch(item, { headers: comfyHeaders(extraHeaders) });
      if (!res.ok) continue;
      const buffer = Buffer.from(await res.arrayBuffer());
      const mime = res.headers.get("content-type") || guessMime(item, "application/octet-stream");
      files.push({ buffer, mime, ext: extFromName(item, "bin") });
    }
  }
  return files;
}

export async function runComfyHttp(cfg: ComfyFeatureConfig, feature: FeatureId, vars: Record<string, unknown>): Promise<ComfyRunResult> {
  const settings = loadSettings();
  const url = cfg.url?.startsWith("http") ? cfg.url : `${trimSlash(cfg.url || settings.comfy.baseUrl)}`;
  if (!url) throw new ComfyError("请填写该功能的 ComfyUI / 自定义接口 URL", 400, "NO_URL");
  const template = parseJsonTemplate(cfg.workflow, feature, "http");
  const body = applyVars(template, vars);
  const { json } = await comfyFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    cfg.extraHeaders,
  );
  const voice =
    json && typeof json === "object"
      ? String((json as Record<string, unknown>).voice || (json as Record<string, unknown>).voice_id || "")
      : "";
  const files = await materializeHttpFiles(collectHttpFiles(json), cfg.extraHeaders);
  return { files, raw: json, voice: voice || undefined };
}

export async function queueComfyPrompt(
  cfg: ComfyFeatureConfig,
  feature: FeatureId,
  vars: Record<string, unknown>,
  uploads: string[],
) {
  const base = comfyBase(cfg);
  const filledVars = { ...vars };
  for (let i = 0; i < uploads.length; i++) {
    const name = await uploadComfyImage(base, uploads[i], cfg.extraHeaders);
    if (i === 0) filledVars.image = name;
    filledVars[`image${i + 1}`] = name;
  }
  const parsed = parseJsonTemplate(cfg.workflow, feature, "prompt");
  const rec = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const graph = rec.prompt && typeof rec.prompt === "object" ? rec.prompt : parsed;
  const workflow = applyVars(graph, filledVars);
  const { json } = await comfyFetch(
    `${base}/prompt`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: "visualforge" }),
    },
    cfg.extraHeaders,
  );
  const promptId = String((json as Record<string, unknown>).prompt_id || "");
  if (!promptId) throw new ComfyError("ComfyUI 未返回 prompt_id", 502, "NO_PROMPT_ID", json);
  return { promptId, raw: json, base };
}

export async function harvestComfy(cfg: ComfyFeatureConfig, promptId: string): Promise<ComfyFile[]> {
  const base = comfyBase(cfg);
  const peeked = await peekHistory(base, promptId, cfg.extraHeaders);
  if (peeked.error) throw new ComfyError(peeked.error, 502, "COMFY_FAILED", peeked.raw);
  if (!peeked.ready || !peeked.entry) return [];
  const refs = collectViewRefs(peeked.entry.outputs);
  const unique = [...new Map(refs.map((r) => [r.filename + r.subfolder, r])).values()];
  const files: ComfyFile[] = [];
  for (const ref of unique) files.push(await downloadView(base, ref, cfg.extraHeaders));
  return files;
}

export async function runComfyPrompt(
  cfg: ComfyFeatureConfig,
  feature: FeatureId,
  vars: Record<string, unknown>,
  uploads: string[],
): Promise<ComfyRunResult> {
  const queued = await queueComfyPrompt(cfg, feature, vars, uploads);
  const files = await harvestComfy(cfg, queued.promptId);
  if (!files.length) {
    const waited = await waitForFiles(cfg, queued.promptId);
    return { files: waited, raw: queued.raw, promptId: queued.promptId };
  }
  return { files, raw: queued.raw, promptId: queued.promptId };
}

async function waitForFiles(cfg: ComfyFeatureConfig, promptId: string) {
  const start = Date.now();
  const timeoutMs = cfg.timeoutMs || 300000;
  while (Date.now() - start < timeoutMs) {
    const files = await harvestComfy(cfg, promptId);
    if (files.length) return files;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new ComfyError("等待 ComfyUI 完成超时", 504, "COMFY_TIMEOUT");
}

export function localUploadPath(value?: string) {
  if (!value) return undefined;
  if (/^(https?:\/\/|data:|oss:\/\/)/i.test(value)) return undefined;
  return value;
}
