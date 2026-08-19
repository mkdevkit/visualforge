import type { FeatureId } from "../lib/types";
import { useCatalog } from "../lib/catalog";

export function ProviderHint({ feature }: { feature: FeatureId }) {
  const catalog = useCatalog();
  const cfg = catalog.features?.[feature];
  const active = catalog.activeModels?.[feature];
  const ready = Boolean(cfg?.workflow);
  const options = catalog[feature] || [];
  return (
    <div className="rounded-xl border border-brass/40 bg-brass/10 px-3 py-3 text-xs leading-relaxed">
      <div className="text-[11px] tracking-[0.16em] uppercase text-brass">引擎</div>
      <div className="mt-1 font-serif text-lg text-foam">ComfyUI</div>
      {catalog.loadError ? (
        <p className="mt-1 text-red-300">{catalog.loadError}</p>
      ) : (
        <>
          <p className="mt-1 text-mute">
            {cfg?.mode === "http" ? "自定义 HTTP" : "官方 /prompt"}
            {active ? ` · ${active}` : cfg?.model ? ` · ${cfg.model}` : ""}
          </p>
          <p className="mt-1 text-mute">
            模型选项来自 ComfyManager{options.length ? ` · ${options.length} 个` : ""}。
          </p>
          {ready ? (
            <p className="mt-1 text-mute">工作流来自 ComfyManager。</p>
          ) : (
            <p className="mt-1 text-mute">请在 ComfyManager「工作流」页粘贴该工位的 API JSON。</p>
          )}
        </>
      )}
    </div>
  );
}
