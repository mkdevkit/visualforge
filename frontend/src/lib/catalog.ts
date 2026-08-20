import { useEffect, useState } from "react";
import { api, uploadFile } from "./api";
import type { Catalog, FeatureId, ModelDef, ProviderId, StationProviders } from "./types";
import { QWEN_CATALOG } from "./qwen-catalog";
import { MESHY_CATALOG, MESHY_IMAGE_SIZES, MIDJOURNEY_CATALOG, TRIPO_CATALOG, VOLCENGINE_CATALOG, VOLC_IMAGE_SIZES } from "./cloud-catalogs";
import { providersForStation } from "./providers";

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

function looksLikeLegacyCloudCatalog(raw: Catalog & { priceDisclaimer?: unknown }) {
  if (raw.priceDisclaimer) return true;
  return (raw.image || []).some((item) => /qwen-image-3|wan2\.7|fun-music|cosyvoice|Tripo-H3/i.test(item.id || ""));
}

export async function fetchStudioCatalog(): Promise<Catalog> {
  const json = await api.models();
  if (looksLikeLegacyCloudCatalog(json) || !json.catalogFile) {
    throw new Error("当前连上的不是 ComfyManager 模型目录。请在设置里填写管理端地址（默认 http://127.0.0.1:18788）并确认 npm run manager 已启动。");
  }
  return {
    ...EMPTY_CATALOG,
    ...json,
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

export function useQwenCatalog(): Catalog {
  return {
    ...EMPTY_CATALOG,
    ...QWEN_CATALOG,
    loadError: "",
  };
}

export function modelsForEngine(engine: ProviderId, feature: FeatureId, catalog: Catalog): ModelDef[] {
  if (engine === "qwen") return (QWEN_CATALOG[feature as keyof typeof QWEN_CATALOG] as ModelDef[] | undefined) || [];
  if (engine === "meshy") return (MESHY_CATALOG[feature as keyof typeof MESHY_CATALOG] as ModelDef[] | undefined) || [];
  if (engine === "midjourney") return (MIDJOURNEY_CATALOG[feature as keyof typeof MIDJOURNEY_CATALOG] as ModelDef[] | undefined) || [];
  if (engine === "tripo") return (TRIPO_CATALOG[feature as keyof typeof TRIPO_CATALOG] as ModelDef[] | undefined) || [];
  if (engine === "volcengine") return (VOLCENGINE_CATALOG[feature as keyof typeof VOLCENGINE_CATALOG] as ModelDef[] | undefined) || [];
  return catalog[feature] || [];
}

export function sizesForEngine(engine: ProviderId, catalog: Catalog) {
  if (engine === "qwen") return QWEN_CATALOG.imageSizes;
  if (engine === "meshy") return MESHY_IMAGE_SIZES;
  if (engine === "midjourney") return MIDJOURNEY_CATALOG.imageSizes;
  if (engine === "volcengine") return VOLC_IMAGE_SIZES;
  return catalog.imageSizes || [];
}

export function useStationEngine(feature: FeatureId | FeatureId[]) {
  const features = Array.isArray(feature) ? feature : [feature];
  const [engine, setEngineState] = useState<ProviderId>("comfyui");
  const [providers, setProviders] = useState<ProviderId[]>(["comfyui"]);
  useEffect(() => {
    api
      .settings()
      .then((r) => {
        const engines = (r.settings.engines || {}) as Record<string, StationProviders | ProviderId>;
        const enabled: ProviderId[] = [];
        for (const id of features) {
          const raw = engines[id];
          const list = raw && typeof raw === "object" && Array.isArray(raw.enabled)
            ? raw.enabled
            : raw === "qwen"
              ? (["comfyui", "qwen"] as ProviderId[])
              : (["comfyui"] as ProviderId[]);
          for (const p of list) {
            if (providersForStation(id).some((d) => d.id === p) && !enabled.includes(p)) enabled.push(p);
          }
        }
        if (!enabled.length) enabled.push("comfyui");
        const first = engines[features[0]];
        const def = first && typeof first === "object" && first.default && enabled.includes(first.default)
          ? first.default
          : first === "qwen" && enabled.includes("qwen")
            ? "qwen"
            : enabled[0];
        setProviders(enabled);
        setEngineState(def);
      })
      .catch(() => undefined);
  }, [features[0]]);
  return { engine, setEngine: setEngineState, providers };
}

export async function uploadAll(files: File[]) {
  const out: string[] = [];
  for (const f of files) out.push((await uploadFile(f)).relPath);
  return out;
}
