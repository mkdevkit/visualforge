import { useEffect, useState } from "react";
import { uploadFile } from "./api";
import { managerBase } from "./manager";
import type { Catalog, FeatureId, ModelDef } from "./types";

const EMPTY_CATALOG: Catalog = {
  image: [],
  video: [],
  music: [],
  tts: [],
  sfx: [],
  model3d: [],
  anim3d: [],
  voiceDesign: [],
  related: {},
  imageSizes: [
    { id: "512*512", label: "1:1 · 512" },
    { id: "768*768", label: "1:1 · 768" },
    { id: "1024*1024", label: "1:1 · 1024" },
    { id: "1280*720", label: "16:9 · 720P" },
    { id: "720*1280", label: "9:16 · 竖版" },
  ],
  ttsVoices: ["default"],
  cosyVoices: [],
  languages: ["Chinese", "English", "Japanese", "Auto"],
  activeModels: {},
};

function looksLikeLegacyCloudCatalog(raw: Record<string, unknown>) {
  if (raw.priceDisclaimer) return true;
  const image = Array.isArray(raw.image) ? raw.image : [];
  return image.some((item) => {
    const id = String((item as { id?: string }).id || "");
    return /qwen-image-3|wan2\.7|fun-music|cosyvoice|Tripo-H3/i.test(id);
  });
}

export async function fetchStudioCatalog(): Promise<Catalog> {
  const base = managerBase();
  const res = await fetch(`${base}/api/models`);
  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) as Record<string, unknown>;
  } catch {
    throw new Error(`ComfyManager ${base} 返回了无法解析的内容`);
  }
  if (!res.ok || json.ok === false) {
    throw new Error(String(json.error || `无法读取 ComfyManager 模型目录 (${res.status})`));
  }
  if (looksLikeLegacyCloudCatalog(json) || !json.catalogFile) {
    throw new Error(`地址 ${base} 不是当前 ComfyManager。请确认管理端已启动（默认 http://127.0.0.1:18788）`);
  }
  return {
    ...EMPTY_CATALOG,
    ...json,
    managerUrl: base,
    catalogFile: String(json.catalogFile || ""),
    loadError: "",
  } as Catalog;
}

let catalogPromise: Promise<Catalog> | null = null;

export function invalidateCatalog() {
  catalogPromise = null;
}

function loadCatalogOnce() {
  if (!catalogPromise) catalogPromise = fetchStudioCatalog();
  return catalogPromise;
}

export function modelLabel(m: ModelDef) {
  return m.installed === false ? `${m.label}（未下载）` : m.label;
}

export function pickDefault(list: ModelDef[] | undefined, activeId?: string) {
  const items = list || [];
  const hit = items.find((m) => m.id === activeId && m.installed !== false);
  if (hit) return hit.id;
  const inst = items.find((m) => m.installed !== false);
  return inst?.id || items[0]?.id || "";
}

export function stationWorkflows(catalog: Catalog, feature: FeatureId) {
  const cfg = catalog.features?.[feature];
  const list = cfg?.workflows || [];
  const enabled = list.filter((w) => w.enabled !== false);
  return enabled.length ? enabled : list;
}

export function pickDefaultWorkflow(catalog: Catalog, feature: FeatureId, current?: string) {
  const list = stationWorkflows(catalog, feature);
  if (current && list.some((w) => w.id === current)) return current;
  const active = catalog.features?.[feature]?.activeWorkflowId;
  if (active && list.some((w) => w.id === active)) return active;
  return list[0]?.id || "";
}

export function relatedHint(catalog: Catalog, feature: FeatureId, selectedId?: string) {
  const all = catalog.related?.[feature] || [];
  const extras = all.filter((m) => m.id !== selectedId && !m.primary);
  if (!extras.length) return "";
  const missing = extras.filter((m) => m.installed === false).map((m) => m.label);
  const ready = extras.filter((m) => m.installed !== false).map((m) => m.label);
  const bits = [];
  if (ready.length) bits.push(`配套已下载：${ready.join("、")}`);
  if (missing.length) bits.push(`还缺：${missing.join("、")}`);
  return bits.join("。");
}

export function useCatalog() {
  const [catalog, setCatalog] = useState<Catalog>(EMPTY_CATALOG);
  useEffect(() => {
    let cancelled = false;
    loadCatalogOnce()
      .then((c) => {
        if (!cancelled) setCatalog({ ...EMPTY_CATALOG, ...c, loadError: "" });
      })
      .catch((err) => {
        if (cancelled) return;
        catalogPromise = null;
        setCatalog({
          ...EMPTY_CATALOG,
          loadError: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return catalog;
}

export async function uploadAll(files: File[]) {
  const out: string[] = [];
  for (const f of files) out.push((await uploadFile(f)).relPath);
  return out;
}
