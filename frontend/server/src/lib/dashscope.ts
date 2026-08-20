import { existsSync, readFileSync } from "node:fs";
import { basename, extname } from "node:path";
import { loadSettings } from "../config.js";
import type { QwenSettings } from "../types.js";

export class DashScopeError extends Error {
  status: number;
  code?: string;
  raw?: unknown;
  constructor(message: string, status = 500, code?: string, raw?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.raw = raw;
  }
}

type DashJson = {
  code?: string;
  message?: string;
  request_id?: string;
  output?: Record<string, unknown>;
  data?: Record<string, unknown>;
  usage?: unknown;
};

function qwen(): QwenSettings {
  return loadSettings().qwen;
}

function authHeaders(extra: Record<string, string> = {}) {
  const s = qwen();
  if (!s.apiKey) {
    throw new DashScopeError(
      "未配置千问 API Key。请到设置页填写，或在 .env 里设置 DASHSCOPE_API_KEY。Key 在 https://www.qianwenai.com/ 申请。",
      400,
      "NO_API_KEY",
    );
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${s.apiKey}`,
    "Content-Type": "application/json",
    ...extra,
  };
  if (s.workspaceId) headers["X-DashScope-WorkSpace"] = s.workspaceId;
  return headers;
}

export function dashBase() {
  return qwen().baseUrl.replace(/\/+$/, "") || "https://dashscope.aliyuncs.com/api/v1";
}

function causeOf(err: unknown): Record<string, unknown> {
  const cause = (err as { cause?: unknown })?.cause;
  if (!cause || typeof cause !== "object") {
    return typeof cause === "string" ? { message: cause } : {};
  }
  const c = cause as { code?: string; message?: string; errno?: number; syscall?: string; address?: string; port?: number; name?: string };
  return {
    name: c.name,
    code: c.code,
    message: c.message,
    errno: c.errno,
    syscall: c.syscall,
    address: c.address,
    port: c.port,
  };
}

function hintForNetwork(code: string, url: string) {
  if (/ENOTFOUND|EAI_AGAIN/i.test(code)) return `DNS 解析失败，本机解析不了 ${new URL(url).hostname}`;
  if (/ECONNREFUSED/i.test(code)) return "连接被拒绝，对端没开或被防火墙拦截";
  if (/ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT|TIMEOUT/i.test(code)) return "连接超时，检查网络、代理或能否访问 dashscope.aliyuncs.com";
  if (/ECONNRESET|UND_ERR_SOCKET/i.test(code)) return "连接被重置，可能是代理或 TLS 中断";
  if (/CERT|UNABLE_TO_VERIFY|ERR_TLS/i.test(code)) return "TLS 证书校验失败";
  return "网络层失败，没有拿到 HTTP 响应";
}

/** Map common DashScope/qianwenai messages to an actionable Chinese hint. */
export function explainDashMessage(message?: string, code?: string, url?: string) {
  const blob = `${code || ""} ${message || ""} ${url || ""}`;
  if (/product is not activated|Unpurchased|not been activated/i.test(blob)) {
    if (/3d-generation|Tripo/i.test(blob)) {
      return "Tripo 生 3D 要在千问模型市场单独开通（生图 Key 不能自动带上）。打开模型页点开通后再试：https://www.qianwenai.com/models/Tripo/Tripo-H3.1 或 https://www.qianwenai.com/models/Tripo/Tripo-P1.0";
    }
    return "当前模型还没在千问AI平台开通。打开 https://www.qianwenai.com/ 模型市场，找到对应模型点开通后再试。";
  }
  return "";
}

function formatApiError(opts: {
  method: string;
  url: string;
  status?: number;
  code?: string;
  requestId?: string;
  body?: string;
  network?: Record<string, unknown>;
  message?: string;
}) {
  const lines = [
    `${opts.method} ${opts.url}`,
    opts.status ? `HTTP ${opts.status}` : "未建立 HTTP 连接",
  ];
  if (opts.code) lines.push(`code: ${opts.code}`);
  if (opts.requestId) lines.push(`request_id: ${opts.requestId}`);
  if (opts.message) lines.push(`message: ${opts.message}`);
  const business = explainDashMessage(opts.message, opts.code, opts.url);
  if (business) lines.push(business);
  if (opts.network && Object.keys(opts.network).length) {
    const bits = Object.entries(opts.network)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${k}=${v}`);
    if (bits.length) lines.push(`network: ${bits.join(" ")}`);
    const hint = hintForNetwork(String(opts.network.code || opts.network.message || ""), opts.url);
    if (hint) lines.push(hint);
  }
  if (opts.body) lines.push(`body: ${opts.body.slice(0, 800)}`);
  return lines.join("\n");
}

function wrapNetworkError(err: unknown, method: string, url: string): DashScopeError {
  const network = causeOf(err);
  const message = err instanceof Error ? err.message : String(err);
  return new DashScopeError(
    formatApiError({
      method,
      url,
      code: String(network.code || "FETCH_FAILED"),
      message,
      network: { ...network, error: message },
    }),
    502,
    String(network.code || "FETCH_FAILED"),
    { method, url, network, error: message },
  );
}

async function dashFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw wrapNetworkError(err, String(init.method || "GET"), url);
  }
}

async function parseResponse(res: Response, method: string, url: string): Promise<DashJson> {
  const text = await res.text();
  let json: DashJson = {};
  try {
    json = text ? (JSON.parse(text) as DashJson) : {};
  } catch {
    throw new DashScopeError(
      formatApiError({ method, url, status: res.status, body: text || "(空响应)" }),
      res.status || 502,
      "NON_JSON",
      { method, url, status: res.status, body: text.slice(0, 800) },
    );
  }
  const failed = !res.ok || Boolean(json.code && json.code !== "Success" && json.message);
  if (failed) {
    throw new DashScopeError(
      formatApiError({
        method,
        url,
        status: res.status,
        code: json.code,
        requestId: json.request_id,
        message: json.message,
        body: text.slice(0, 800),
      }),
      res.ok ? 400 : res.status >= 400 && res.status < 600 ? res.status : 502,
      json.code,
      json,
    );
  }
  return json;
}

export async function dashPost(
  path: string,
  body: unknown,
  opts?: { async?: boolean; oss?: boolean; extraHeaders?: Record<string, string> },
): Promise<DashJson> {
  const headers = authHeaders({
    ...(opts?.async ? { "X-DashScope-Async": "enable" } : {}),
    ...(opts?.oss ? { "X-DashScope-OssResourceResolve": "enable" } : {}),
    ...(opts?.extraHeaders || {}),
  });
  const url = path.startsWith("http") ? path : `${dashBase()}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await dashFetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  return parseResponse(res, "POST", url);
}

export async function dashGet(path: string): Promise<DashJson> {
  const url = path.startsWith("http") ? path : `${dashBase()}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await dashFetch(url, { method: "GET", headers: authHeaders() });
  return parseResponse(res, "GET", url);
}

export async function getDashTask(taskId: string): Promise<DashJson> {
  return dashGet(`/tasks/${encodeURIComponent(taskId)}`);
}

export function taskIdOf(json: DashJson): string {
  const out = json.output || {};
  return String(out.task_id || out.taskId || "");
}

export function taskStatusOf(json: DashJson): string {
  const out = json.output || {};
  return String(out.task_status || out.taskStatus || "").toUpperCase();
}

function pushUrl(out: string[], value: unknown) {
  if (typeof value === "string" && /^https?:\/\//i.test(value)) out.push(value);
}

export function collectResultUrls(output: unknown): string[] {
  const urls: string[] = [];
  if (!output || typeof output !== "object") return urls;
  const o = output as Record<string, unknown>;
  pushUrl(urls, o.video_url);
  pushUrl(urls, o.audio_url);
  pushUrl(urls, o.pbr_model_url);
  pushUrl(urls, o.model_url);
  pushUrl(urls, o.base_model_url);
  pushUrl(urls, o.orig_url);
  pushUrl(urls, o.rendered_image);
  if (o.audio && typeof o.audio === "object") pushUrl(urls, (o.audio as Record<string, unknown>).url);
  if (Array.isArray(o.results)) {
    for (const item of o.results) {
      if (!item || typeof item !== "object") continue;
      const r = item as Record<string, unknown>;
      pushUrl(urls, r.url);
      pushUrl(urls, r.video_url);
      pushUrl(urls, r.image);
      pushUrl(urls, r.pbr_model_url);
      pushUrl(urls, r.base_model_url);
      pushUrl(urls, r.model_url);
      pushUrl(urls, r.rendered_image_url);
    }
  }
  if (Array.isArray(o.choices)) {
    for (const choice of o.choices) {
      const content = (choice as { message?: { content?: unknown } })?.message?.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (!part || typeof part !== "object") continue;
        const p = part as Record<string, unknown>;
        pushUrl(urls, p.image);
        pushUrl(urls, p.url);
        pushUrl(urls, p.video);
        pushUrl(urls, p.audio);
      }
    }
  }
  return [...new Set(urls)];
}

export function audioBase64Of(output: unknown): string {
  if (!output || typeof output !== "object") return "";
  const audio = (output as { audio?: { data?: string } }).audio;
  return typeof audio?.data === "string" ? audio.data : "";
}

export async function downloadUrl(url: string): Promise<{ buffer: Buffer; ext: string; mime: string }> {
  const res = await dashFetch(url, { method: "GET" });
  if (!res.ok) {
    const text = await res.text();
    throw new DashScopeError(
      formatApiError({ method: "GET", url, status: res.status, body: text.slice(0, 400) || "下载成品失败" }),
      502,
    );
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get("content-type") || "application/octet-stream";
  const path = url.split("?")[0];
  const fromUrl = extname(path).replace(".", "").toLowerCase();
  const fromMime =
    mime.includes("png") ? "png"
    : mime.includes("jpeg") || mime.includes("jpg") ? "jpg"
    : mime.includes("webp") ? "webp"
    : mime.includes("mp4") ? "mp4"
    : mime.includes("webm") ? "webm"
    : mime.includes("mpeg") || mime.includes("mp3") ? "mp3"
    : mime.includes("wav") ? "wav"
    : mime.includes("gltf-binary") || mime.includes("octet-stream") && /glb/i.test(path) ? "glb"
    : mime.includes("gltf") ? "gltf"
    : "";
  return { buffer, ext: fromUrl || fromMime || "bin", mime };
}

async function getUploadPolicy(model: string) {
  const s = qwen();
  const url = `${dashBase()}/uploads?action=getPolicy&model=${encodeURIComponent(model)}`;
  const res = await dashFetch(url, { method: "GET", headers: authHeaders() });
  const json = await parseResponse(res, "GET", url);
  const data = (json.data || json.output || {}) as Record<string, string>;
  if (!data.upload_host || !data.policy) {
    throw new DashScopeError("千问临时上传凭证不完整", 502, "UPLOAD_POLICY");
  }
  return data;
}

export async function uploadLocalFile(absPath: string, model: string): Promise<string> {
  if (!existsSync(absPath)) throw new DashScopeError(`找不到本地文件：${absPath}`, 400);
  const policy = await getUploadPolicy(model);
  const filename = basename(absPath);
  const key = `${policy.upload_dir.replace(/\/+$/, "")}/${filename}`;
  const buf = readFileSync(absPath);
  const form = new FormData();
  form.set("OSSAccessKeyId", policy.oss_access_key_id);
  form.set("Signature", policy.signature);
  form.set("policy", policy.policy);
  form.set("key", key);
  form.set("x-oss-object-acl", policy.x_oss_object_acl || "private");
  form.set("x-oss-forbid-overwrite", policy.x_oss_forbid_overwrite || "true");
  form.set("success_action_status", "200");
  form.set("file", new Blob([new Uint8Array(buf)]), filename);
  const res = await dashFetch(policy.upload_host, { method: "POST", body: form });
  if (!res.ok) {
    const text = await res.text();
    throw new DashScopeError(
      formatApiError({ method: "POST", url: policy.upload_host, status: res.status, body: text.slice(0, 400) || "上传到千问临时存储失败" }),
      res.status || 502,
    );
  }
  return `oss://${key}`;
}

export function usesOss(url?: string) {
  return Boolean(url && url.startsWith("oss://"));
}
