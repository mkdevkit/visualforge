import { existsSync, mkdirSync, readdirSync, unlinkSync, writeFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { nanoid } from "nanoid";
import type { AssetRecord, AssetType } from "../types.js";
import { loadSettings, ensureDataLayout } from "../config.js";
import { loadJson, saveJson } from "./json.js";

const TYPE_DIR: Record<AssetType, string> = {
  image: "images",
  video: "videos",
  music: "music",
  audio: "audio",
  model3d: "models3d",
};

export function libraryPath() {
  return join(loadSettings().dataDir, "library.json");
}

export function loadLibrary(): AssetRecord[] {
  ensureDataLayout(loadSettings().dataDir);
  return loadJson<AssetRecord[]>(libraryPath(), []);
}

export function saveLibrary(list: AssetRecord[]) {
  saveJson(libraryPath(), list);
}

export function getAsset(id: string) {
  return loadLibrary().find((a) => a.id === id);
}

export function updateAsset(id: string, patch: Partial<AssetRecord>) {
  const list = loadLibrary();
  const idx = list.findIndex((a) => a.id === id);
  if (idx < 0) return undefined;
  list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() };
  saveLibrary(list);
  return list[idx];
}

export function deleteAsset(id: string) {
  const list = loadLibrary();
  const asset = list.find((a) => a.id === id);
  if (!asset) return false;
  const abs = join(loadSettings().dataDir, asset.relPath);
  if (existsSync(abs)) unlinkSync(abs);
  for (const extra of asset.extraFiles || []) {
    const p = join(loadSettings().dataDir, extra.relPath);
    if (existsSync(p)) unlinkSync(p);
  }
  saveLibrary(list.filter((a) => a.id !== id));
  return true;
}

export function absPath(rel: string) {
  return join(loadSettings().dataDir, rel);
}

export function saveBuffer(opts: {
  type: AssetType;
  buffer: Buffer;
  ext: string;
  mime: string;
  prompt: string;
  model: string;
  params?: Record<string, unknown>;
  title?: string;
  tags?: string[];
  kind?: AssetRecord["kind"];
  remoteUrl?: string;
  extra?: Partial<AssetRecord>;
}): AssetRecord {
  const settings = loadSettings();
  ensureDataLayout(settings.dataDir);
  const id = `${TYPE_DIR[opts.type].slice(0, 3)}_${nanoid(10)}`;
  const filename = `${id}.${opts.ext.replace(/^\./, "")}`;
  const dir = TYPE_DIR[opts.type];
  const relPath = `${dir}/${filename}`;
  const full = join(settings.dataDir, relPath);
  mkdirSync(join(settings.dataDir, dir), { recursive: true });
  writeFileSync(full, opts.buffer);
  const now = new Date().toISOString();
  const record: AssetRecord = {
    id,
    type: opts.type,
    kind: opts.kind,
    filename,
    relPath,
    mime: opts.mime,
    size: opts.buffer.length,
    prompt: opts.prompt,
    model: opts.model,
    params: opts.params || {},
    favorite: false,
    tags: opts.tags || [],
    title: opts.title || opts.prompt.slice(0, 40) || id,
    notes: "",
    createdAt: now,
    updatedAt: now,
    remoteUrl: opts.remoteUrl,
    ...opts.extra,
  };
  const list = loadLibrary();
  list.unshift(record);
  saveLibrary(list);
  return record;
}

export function saveUpload(buffer: Buffer, originalName: string) {
  const settings = loadSettings();
  ensureDataLayout(settings.dataDir);
  const ext = extname(originalName).replace(".", "") || "bin";
  const id = `upl_${nanoid(10)}`;
  const filename = `${id}.${ext}`;
  const relPath = `uploads/${filename}`;
  writeFileSync(join(settings.dataDir, relPath), buffer);
  return { id, filename, relPath, size: buffer.length, mimeGuess: ext };
}

export function scanOrphans() {
  const settings = loadSettings();
  const known = new Set(loadLibrary().map((a) => a.relPath.replace(/\\/g, "/")));
  const orphans: string[] = [];
  for (const dir of Object.values(TYPE_DIR)) {
    const full = join(settings.dataDir, dir);
    if (!existsSync(full)) continue;
    for (const name of readdirSync(full)) {
      const rel = `${dir}/${name}`;
      const st = statSync(join(full, name));
      if (st.isFile() && !known.has(rel)) orphans.push(rel);
    }
  }
  return orphans;
}
