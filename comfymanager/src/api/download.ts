import { createWriteStream, existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { nanoid } from "nanoid";
import { loadSettings } from "./config.ts";
import { findOpenModel, modelDest } from "./catalog.ts";
import { loadJson, saveJson } from "./json.ts";

export interface DownloadJob {
  id: string;
  modelId: string;
  filename: string;
  dest: string;
  status: "queued" | "running" | "succeeded" | "failed" | "canceled";
  progress: number;
  bytes: number;
  total: number;
  error?: string;
  createdAt: string;
}

function jobsFile() {
  return join(loadSettings().dataDir, "downloads.json");
}

export function loadDownloads(): DownloadJob[] {
  return loadJson<DownloadJob[]>(jobsFile(), []);
}

function saveDownloads(list: DownloadJob[]) {
  saveJson(jobsFile(), list);
}

function patchJob(id: string, patch: Partial<DownloadJob>) {
  const list = loadDownloads();
  const idx = list.findIndex((j) => j.id === id);
  if (idx < 0) return undefined;
  list[idx] = { ...list[idx], ...patch };
  saveDownloads(list);
  return list[idx];
}

const running = new Map<string, AbortController>();

export function startDownload(modelId: string) {
  const model = findOpenModel(modelId);
  if (!model) throw new Error(`未知模型 ${modelId}`);
  const dest = modelDest(model);
  if (existsSync(dest)) throw new Error("该模型已在本地");
  const job: DownloadJob = {
    id: `dl_${nanoid(8)}`,
    modelId: model.id,
    filename: model.filename,
    dest,
    status: "queued",
    progress: 0,
    bytes: 0,
    total: model.sizeBytes || 0,
    createdAt: new Date().toISOString(),
  };
  const list = loadDownloads();
  list.unshift(job);
  saveDownloads(list);
  void runDownload(job.id);
  return job;
}

async function runDownload(id: string) {
  const job = loadDownloads().find((j) => j.id === id);
  if (!job) return;
  const model = findOpenModel(job.modelId);
  if (!model) {
    patchJob(id, { status: "failed", error: "模型配置已删除" });
    return;
  }
  const ac = new AbortController();
  running.set(id, ac);
  patchJob(id, { status: "running" });
  const tmp = `${job.dest}.part`;
  mkdirSync(dirname(job.dest), { recursive: true });
  const token = loadSettings().comfy.hfToken;
  try {
    const res = await fetch(model.url, {
      signal: ac.signal,
      redirect: "follow",
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`);
    const total = Number(res.headers.get("content-length") || job.total || 0);
    let bytes = 0;
    const file = createWriteStream(tmp);
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        bytes += chunk.length;
        const progress = total ? Math.min(99, Math.round((bytes / total) * 100)) : Math.min(90, Math.round(bytes / 1_000_000));
        patchJob(id, { bytes, total, progress });
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body as never), counter, file);
    renameSync(tmp, job.dest);
    patchJob(id, { status: "succeeded", progress: 100, bytes, total: total || bytes });
  } catch (err) {
    if (existsSync(tmp)) {
      try {
        unlinkSync(tmp);
      } catch {
        /* ignore */
      }
    }
    const msg = err instanceof Error ? err.message : String(err);
    patchJob(id, {
      status: ac.signal.aborted ? "canceled" : "failed",
      error: ac.signal.aborted ? "已取消" : msg,
    });
  } finally {
    running.delete(id);
  }
}

export function cancelDownload(id: string) {
  running.get(id)?.abort();
  return patchJob(id, { status: "canceled", error: "已取消" });
}
