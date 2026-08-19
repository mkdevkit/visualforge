import { loadSettings } from "./config.ts";
import { FEATURE_IDS } from "./types.ts";
import type { FeatureId } from "./types.ts";
import { applyStationWorkflow } from "./features.ts";
import type { ComfyFeatureConfig } from "./features.ts";
import { resolveModelName } from "./catalog.ts";
import { fetchObjectInfo, hydrateFeatures } from "./comfy-workflows.ts";
import { remapMissingNodeClasses, unwrapApiGraph } from "./workflow-convert.ts";

export type GenerateFile = { name: string; mime: string; ext: string; data: string };

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

function comfyBase(cfg: ComfyFeatureConfig) {
  return (cfg.url || loadSettings().comfy.baseUrl || "http://127.0.0.1:8188").replace(/\/+$/, "");
}

function comfyHeaders(extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { ...extra };
  const key = loadSettings().comfy.apiKey;
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function comfyFetch(url: string, init: RequestInit = {}, extra: Record<string, string> = {}) {
  const headers = { ...comfyHeaders(extra), ...(init.headers as Record<string, string> | undefined) };
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
    throw new Error(String(obj.error || obj.message || text || `ComfyUI HTTP ${res.status}`));
  }
  return { json, text, res };
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
  return name.split(".").pop()?.toLowerCase() || fallback;
}

function parseGraph(raw: string) {
  const text = raw.trim();
  if (!text) throw new Error("该工位没有可用工作流 JSON");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("工作流不是合法 JSON");
  }
  const rec = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  return rec.prompt && typeof rec.prompt === "object" ? rec.prompt : parsed;
}

export async function resolveFeatureConfig(feature: FeatureId, workflowId?: string) {
  const s = loadSettings();
  const hydrated = await hydrateFeatures(s.features);
  const cfg = applyStationWorkflow(hydrated[feature], workflowId);
  if (!cfg.url) cfg.url = s.comfy.baseUrl;
  if (!cfg.model) cfg.model = s.activeModels[feature] || "";
  return cfg;
}

async function uploadImage(base: string, file: File, extra: Record<string, string>) {
  const form = new FormData();
  form.set("image", file, file.name || "upload.png");
  form.set("overwrite", "true");
  const { json } = await comfyFetch(`${base}/upload/image`, { method: "POST", body: form }, extra);
  const rec = json as Record<string, string>;
  return rec.name || rec.filename || file.name || "upload.png";
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

async function downloadView(base: string, ref: { filename: string; subfolder?: string; type?: string }, extra: Record<string, string>): Promise<GenerateFile> {
  const qs = new URLSearchParams({
    filename: ref.filename,
    subfolder: ref.subfolder || "",
    type: ref.type || "output",
  });
  const res = await fetch(`${base}/view?${qs}`, { headers: comfyHeaders(extra) });
  if (!res.ok) throw new Error(`下载 ComfyUI 成品失败 ${res.status}: ${ref.filename}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get("content-type") || guessMime(ref.filename, "application/octet-stream");
  return { name: ref.filename, mime, ext: extFromName(ref.filename, "bin"), data: buffer.toString("base64") };
}

async function peekHistory(base: string, promptId: string, extra: Record<string, string>) {
  const { json } = await comfyFetch(`${base}/history/${encodeURIComponent(promptId)}`, {}, extra);
  const rec = json as Record<string, unknown>;
  const entry = (rec[promptId] || rec) as Record<string, unknown>;
  const status = entry.status as Record<string, unknown> | undefined;
  const outputs = entry.outputs;
  const messages = JSON.stringify(status?.messages || []);
  if (status?.status_str === "error" || messages.includes("execution_error")) {
    return { ready: false as const, error: "ComfyUI 工作流执行失败", raw: json, entry };
  }
  if (outputs && typeof outputs === "object" && Object.keys(outputs as object).length) {
    if (!status || status.completed || status.status_str === "success") {
      return { ready: true as const, entry, raw: json };
    }
  }
  return { ready: false as const, raw: json, entry };
}

export async function harvestPrompt(promptId: string) {
  const s = loadSettings();
  const cfg: ComfyFeatureConfig = {
    mode: "prompt",
    url: s.comfy.baseUrl,
    model: "",
    workflow: "",
    workflowSource: "",
    workflows: [],
    activeWorkflowId: "",
    extraHeaders: {},
    timeoutMs: 300000,
  };
  const base = comfyBase(cfg);
  const peeked = await peekHistory(base, promptId, cfg.extraHeaders);
  if (peeked.error) throw new Error(peeked.error);
  if (!peeked.ready || !peeked.entry) return { ok: true, ready: false, promptId, files: [] as GenerateFile[] };
  const refs = collectViewRefs(peeked.entry.outputs);
  const unique = [...new Map(refs.map((r) => [r.filename + r.subfolder, r])).values()];
  const files: GenerateFile[] = [];
  for (const ref of unique) files.push(await downloadView(base, ref, cfg.extraHeaders));
  return { ok: true, ready: true, promptId, files };
}

async function waitFiles(promptId: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const out = await harvestPrompt(promptId);
    if (out.files.length) return out.files;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error("等待 ComfyUI 完成超时");
}

function collectHttpFiles(value: unknown, acc: string[] = []) {
  if (typeof value === "string") {
    if (/^https?:\/\//i.test(value) || value.startsWith("data:")) acc.push(value);
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

async function materializeHttp(items: string[]): Promise<GenerateFile[]> {
  const files: GenerateFile[] = [];
  for (const item of items) {
    const dataUrl = item.match(/^data:([^;]+);base64,(.+)$/);
    if (dataUrl) {
      files.push({
        name: "output",
        mime: dataUrl[1],
        ext: dataUrl[1].split("/")[1]?.replace("jpeg", "jpg") || "bin",
        data: dataUrl[2],
      });
      continue;
    }
    if (/^https?:\/\//i.test(item)) {
      const res = await fetch(item);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const mime = res.headers.get("content-type") || "application/octet-stream";
      files.push({ name: "output", mime, ext: extFromName(item, "bin"), data: buf.toString("base64") });
    }
  }
  return files;
}

export async function runGenerate(opts: {
  feature: string;
  workflowId?: string;
  model?: string;
  wait?: boolean;
  vars?: Record<string, unknown>;
  images?: File[];
}) {
  if (!FEATURE_IDS.includes(opts.feature as FeatureId)) throw new Error("未知工位");
  const feature = opts.feature as FeatureId;
  const cfg = await resolveFeatureConfig(feature, opts.workflowId);
  const model = resolveModelName(opts.model, cfg.model) || "comfyui";
  const vars: Record<string, unknown> = { ...(opts.vars || {}), model, feature };
  const extra = cfg.extraHeaders || {};

  if (cfg.mode === "http") {
    const url = cfg.url?.startsWith("http") ? cfg.url : "";
    if (!url) throw new Error("自定义 HTTP 模式请填写接口 URL");
    let template: unknown = {};
    try {
      template = JSON.parse(cfg.workflow || "{}");
    } catch {
      throw new Error("自定义 HTTP 请求体不是合法 JSON");
    }
    const body = applyVars(template, vars);
    const { json } = await comfyFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }, extra);
    const rec = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
    const files = await materializeHttp(collectHttpFiles(json));
    return {
      ok: true,
      mode: "http" as const,
      model,
      promptId: "",
      files,
      voice: String(rec.voice || rec.voice_id || "") || undefined,
      raw: json,
    };
  }

  const base = comfyBase(cfg);
  const images = opts.images || [];
  for (let i = 0; i < images.length; i++) {
    const name = await uploadImage(base, images[i], extra);
    if (i === 0) vars.image = name;
    vars[`image${i + 1}`] = name;
  }
  const rawGraph = applyVars(parseGraph(cfg.workflow), vars);
  const graph = remapMissingNodeClasses(
    unwrapApiGraph(rawGraph),
    await fetchObjectInfo(),
  );
  const { json } = await comfyFetch(
    `${base}/prompt`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: graph, client_id: "visualforge" }),
    },
    extra,
  );
  const promptId = String((json as Record<string, unknown>).prompt_id || "");
  if (!promptId) throw new Error("ComfyUI 未返回 prompt_id");
  let files: GenerateFile[] = [];
  if (opts.wait !== false) files = await waitFiles(promptId, cfg.timeoutMs || 300000);
  return {
    ok: true,
    mode: "prompt" as const,
    model,
    promptId,
    files,
    raw: json,
  };
}

export async function parseGenerateRequest(c: { req: { header: (n: string) => string | undefined; json: () => Promise<unknown>; formData: () => Promise<FormData> } }) {
  const ct = c.req.header("content-type") || "";
  if (ct.includes("application/json")) {
    const body = (await c.req.json()) as Record<string, unknown>;
    return {
      feature: String(body.feature || ""),
      workflowId: typeof body.workflowId === "string" ? body.workflowId : undefined,
      model: typeof body.model === "string" ? body.model : undefined,
      wait: body.wait !== false,
      vars: (body.vars && typeof body.vars === "object" ? body.vars : body) as Record<string, unknown>,
      images: [] as File[],
    };
  }
  const form = await c.req.formData();
  let vars: Record<string, unknown> = {};
  const rawVars = form.get("vars");
  if (typeof rawVars === "string" && rawVars.trim()) vars = JSON.parse(rawVars) as Record<string, unknown>;
  const images: File[] = [];
  for (const [key, value] of form.entries()) {
    if (value && typeof value === "object" && typeof (value as File).arrayBuffer === "function") {
      if (key === "file" || key === "image" || key === "images" || key.startsWith("image")) images.push(value as File);
    }
  }
  const waitRaw = String(form.get("wait") || "true");
  return {
    feature: String(form.get("feature") || ""),
    workflowId: String(form.get("workflowId") || "") || undefined,
    model: String(form.get("model") || "") || undefined,
    wait: waitRaw !== "0" && waitRaw !== "false",
    vars,
    images,
  };
}
