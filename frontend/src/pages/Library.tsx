import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AssetRecord, AssetType } from "../lib/types";
import { AssetCard } from "../components/AssetCard";
import { Field, Input, Select } from "../components/ui";
import { PageHead } from "../components/PageHead";

const types: { id: "" | AssetType; label: string }[] = [
  { id: "", label: "全部" },
  { id: "image", label: "图像" },
  { id: "video", label: "视频" },
  { id: "music", label: "音乐" },
  { id: "audio", label: "音频" },
  { id: "model3d", label: "3D" },
];

export function Library() {
  const [type, setType] = useState<"" | AssetType>("");
  const [q, setQ] = useState("");
  const [fav, setFav] = useState(false);
  const [assets, setAssets] = useState<AssetRecord[]>([]);

  const load = () => {
    const params = new URLSearchParams();
    if (type) params.set("type", type);
    if (q) params.set("q", q);
    if (fav) params.set("favorite", "true");
    const qs = params.toString();
    api.assets(qs ? `?${qs}` : "").then((r) => setAssets(r.assets)).catch(() => undefined);
  };

  useEffect(() => {
    load();
  }, [type, fav]);

  return (
    <section className="mx-auto max-w-6xl px-8 py-10">
      <PageHead kicker="Library" title="资源库" desc="3D 可旋转预览；GLB 自带动画时可切换播放。分类目录：images / videos / music / audio / models3d。" />
      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <Field label="分类">
          <Select value={type} onChange={(e) => setType(e.target.value as "" | AssetType)}>
            {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
        </Field>
        <Field label="搜索">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="标题 / 提示词 / 模型 / 标签"
          />
        </Field>
        <Field label="筛选">
          <Select value={fav ? "1" : "0"} onChange={(e) => setFav(e.target.value === "1")}>
            <option value="0">全部</option>
            <option value="1">仅收藏</option>
          </Select>
        </Field>
      </div>
      {assets.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-line px-6 py-16 text-center text-mute">还没有资源。去各工位生成后会自动归档。</div>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {assets.map((a) => <AssetCard key={a.id} asset={a} onChange={load} />)}
        </div>
      )}
    </section>
  );
}
