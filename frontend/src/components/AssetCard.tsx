import { useState } from "react";
import { fileUrl, api } from "../lib/api";
import type { AssetRecord } from "../lib/types";
import { Button } from "./ui";
import { ModelPreview } from "./ModelPreview";

export function AssetCard({
  asset,
  onChange,
}: {
  asset: AssetRecord;
  onChange?: () => void;
}) {
  const src = fileUrl(asset.relPath);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rigged = Boolean(asset.params?.rigged);
  return (
    <article className="overflow-hidden rounded-2xl border border-line bg-panel">
      <div className="aspect-square bg-ink-2">
        {asset.type === "image" ? (
          <img src={src} alt={asset.title} className="size-full object-cover" />
        ) : asset.type === "video" ? (
          <video src={src} controls className="size-full object-cover" />
        ) : asset.type === "model3d" ? (
          <ModelPreview src={src} alt={asset.title} className="size-full" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-3 p-4">
            <audio src={src} controls className="w-full" />
            <span className="text-xs text-mute">{asset.kind || asset.type}</span>
          </div>
        )}
      </div>
      <div className="space-y-2 p-3">
        <div className="truncate font-medium">{asset.title}</div>
        <div className="truncate text-xs text-mute">{asset.model}</div>
        <p className="line-clamp-2 text-xs text-mute">{asset.prompt}</p>
        {error ? <p className="text-xs text-red-300">{error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            tone="ghost"
            className="flex-1 py-1.5 text-xs"
            onClick={async () => {
              await api.patchAsset(asset.id, { favorite: !asset.favorite });
              onChange?.();
            }}
          >
            {asset.favorite ? "已收藏" : "收藏"}
          </Button>
          <a href={src} download={asset.filename} className="flex-1">
            <Button tone="ghost" className="w-full py-1.5 text-xs">下载</Button>
          </a>
          {asset.type === "model3d" && !rigged ? (
            <Button
              tone="ghost"
              disabled={busy}
              className="flex-1 py-1.5 text-xs"
              onClick={async () => {
                setBusy(true);
                setError("");
                try {
                  await api.rig3d(asset.id);
                  onChange?.();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? "绑骨中…" : "绑骨导出"}
            </Button>
          ) : null}
          <Button
            tone="danger"
            className="py-1.5 text-xs"
            onClick={async () => {
              if (!confirm("删除该资源？")) return;
              await api.deleteAsset(asset.id);
              onChange?.();
            }}
          >
            删
          </Button>
        </div>
      </div>
    </article>
  );
}

export function ResultStrip({ assets, onChange }: { assets: AssetRecord[]; onChange?: () => void }) {
  if (!assets.length) return null;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
      {assets.map((a) => (
        <AssetCard key={a.id} asset={a} onChange={onChange} />
      ))}
    </div>
  );
}
