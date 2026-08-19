import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { modelLabel, pickDefault, relatedHint, uploadAll, useCatalog } from "../lib/catalog";
import type { AssetRecord } from "../lib/types";
import { Button, Dropzone, ErrorBox, Field, Input, Select, Spinner, Textarea } from "../components/ui";
import { ResultStrip } from "../components/AssetCard";
import { PageHead } from "../components/PageHead";
import { ProviderHint } from "../components/ProviderHint";

export function StudioImage() {
  const catalog = useCatalog();
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("一只铜锈质感的机械狐狸蹲在雨后的石板巷，暖黄窗光，胶片颗粒，竖构图");
  const [negative, setNegative] = useState("");
  const [size, setSize] = useState("1024*1024");
  const [n, setN] = useState(1);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [assets, setAssets] = useState<AssetRecord[]>([]);

  useEffect(() => {
    if (!model) setModel(pickDefault(catalog.image, catalog.activeModels?.image));
  }, [catalog, model]);

  return (
    <section className="mx-auto max-w-5xl px-8 py-10">
      <PageHead kicker="ComfyUI" title="生图工位" desc="模型列表和工作流来自 ComfyManager。请先在管理端下载权重并保存该工位 API 工作流。" />
      <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <Field label="提示词">
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </Field>
          <Field label="反向提示词" hint="可选">
            <Input value={negative} onChange={(e) => setNegative(e.target.value)} />
          </Field>
          <Dropzone accept="image/*" label="参考图" files={files} onPicked={setFiles} />
          <ErrorBox error={error} />
          <Button
            disabled={busy || !prompt.trim()}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const images = await uploadAll(files);
                const r = await api.generateImage({
                  model, prompt, negativePrompt: negative || undefined, size, n, images,
                });
                setAssets(r.assets);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "生成中…" : "开始生图"}
          </Button>
          {busy ? <Spinner label="正在调用 ComfyUI" /> : null}
        </div>
        <aside className="space-y-4 rounded-2xl border border-line bg-panel p-5">
          <Field label="模型">
            <Select value={model} onChange={(e) => setModel(e.target.value)}>
              {(catalog.image || []).map((m) => (
                <option key={m.id} value={m.id}>{modelLabel(m)}</option>
              ))}
            </Select>
          </Field>
          <Field label="尺寸">
            <Select value={size} onChange={(e) => setSize(e.target.value)}>
              {(catalog.imageSizes || []).map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="张数">
            <Input type="number" min={1} max={6} value={n} onChange={(e) => setN(Number(e.target.value))} />
          </Field>
          <p className="text-xs leading-relaxed text-mute">{catalog.image.find((m) => m.id === model)?.description}</p>
          {relatedHint(catalog, "image", model) ? (
            <p className="text-xs leading-relaxed text-mute">{relatedHint(catalog, "image", model)}</p>
          ) : null}
          <ProviderHint feature="image" />
        </aside>
      </div>
      <div className="mt-10"><ResultStrip assets={assets} /></div>
    </section>
  );
}
