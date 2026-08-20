import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { modelLabel, modelsForEngine, pickDefault, relatedHint, sizesForEngine, uploadAll, useCatalog, useStationEngine } from "../lib/catalog";
import type { TaskRecord } from "../lib/types";
import { Button, Dropzone, ErrorBox, Field, Input, Select, Spinner, Textarea } from "../components/ui";
import { ResultStrip } from "../components/AssetCard";
import { PageHead } from "../components/PageHead";
import { ProviderHint } from "../components/ProviderHint";
import { WorkflowSelect } from "../components/WorkflowSelect";
import { EngineSwitch } from "../components/EngineSwitch";
import { CloudHint } from "../components/CloudHint";
import { useTaskPoll } from "../lib/useTaskPoll";
import { providerById, providerKickerClass } from "../lib/providers";

export function StudioImage() {
  const catalog = useCatalog();
  const { engine, setEngine, providers } = useStationEngine("image");
  const info = providerById(engine);
  const cloud = engine !== "comfyui";
  const tone = info?.tone || "comfy";
  const models = modelsForEngine(engine, "image", catalog);
  const sizes = sizesForEngine(engine, catalog);
  const [model, setModel] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [prompt, setPrompt] = useState("一只铜锈质感的机械狐狸蹲在雨后的石板巷，暖黄窗光，胶片颗粒，竖构图");
  const [negative, setNegative] = useState("");
  const [size, setSize] = useState("1024*1024");
  const [n, setN] = useState(1);
  const [promptExtend, setPromptExtend] = useState(true);
  const [watermark, setWatermark] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [task, setTask] = useState<TaskRecord | null>(null);
  const { assets, setAssets } = useTaskPoll(task, setTask, setError);

  useEffect(() => {
    const next = pickDefault(models, cloud ? undefined : catalog.activeModels?.image);
    if (!models.some((m) => m.id === model)) setModel(next);
  }, [catalog, cloud, model, models]);

  useEffect(() => {
    if (sizes.length && !sizes.some((s) => s.id === size)) setSize(sizes[0].id);
  }, [sizes, size]);

  const kicker = info?.docsUrl
    ? `${info.label} · ${info.docsUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}`
    : (info?.label || "ComfyUI");
  const desc =
    engine === "qwen" ? "走千问 Image 云端模型，成品写入 data/images/。不使用 ComfyUI 工作流。"
    : engine === "meshy" ? "走 Meshy 官方 OpenAPI 生图 / 图生图，成品写入 data/images/。不使用 ComfyUI 工作流。"
    : engine === "midjourney" ? "官方没有公开 API。未填兼容网关时无法出图；视铸不会走 Discord 或非官方爬站。"
    : engine === "volcengine" ? "走火山方舟 Seedream 文生图 / 图生图，成品写入 data/images/。不使用 ComfyUI 工作流。"
    : "在本页指定工作流和模型。列表来自 ComfyManager，请先下载权重并给工位配上生效工作流。";
  const spinning = engine === "comfyui" ? "ComfyUI" : (info?.label || "云端");
  const asideClass = tone === "qwen"
    ? "border-qwen/40 bg-qwen/5"
    : tone === "cloud"
      ? "border-cloud/40 bg-cloud/5"
      : "border-line bg-panel";

  return (
    <section className="mx-auto max-w-5xl px-8 py-10">
      <EngineSwitch value={engine} onChange={setEngine} providers={providers} />
      <PageHead tone={tone} kicker={kicker} title="生图工位" desc={desc} />
      <div className="grid items-start gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <Field label="提示词">
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </Field>
          <Field label="反向提示词" hint="可选">
            <Input value={negative} onChange={(e) => setNegative(e.target.value)} />
          </Field>
          <Dropzone accept="image/*" label="参考图" files={files} onPicked={setFiles} />
          {engine === "qwen" || engine === "volcengine" ? (
            <div className="flex flex-wrap gap-4 text-sm text-mute">
              {engine === "qwen" ? (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={promptExtend} onChange={(e) => setPromptExtend(e.target.checked)} />
                  智能扩写提示词
                </label>
              ) : null}
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} />
                加水印
              </label>
            </div>
          ) : null}
          <ErrorBox error={error || (task?.status === "failed" ? task.error : "")} />
          <Button
            disabled={busy || !prompt.trim()}
            onClick={async () => {
              setBusy(true);
              setError("");
              setTask(null);
              try {
                const images = await uploadAll(files);
                const r = await api.generateImage({
                  engine,
                  model, workflowId, prompt, negativePrompt: negative || undefined, size, n, images,
                  promptExtend: engine === "qwen" ? promptExtend : undefined,
                  watermark: engine === "qwen" || engine === "volcengine" ? watermark : undefined,
                });
                if (r.assets?.length) setAssets(r.assets);
                if (r.task) setTask(r.task);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "提交中…" : "开始生图"}
          </Button>
          {busy ? <Spinner tone={tone} label={`正在提交到 ${spinning}`} /> : null}
          {task && task.status !== "succeeded" && task.status !== "failed" ? (
            <Spinner tone={tone} label={`${spinning} 出图中，将自动刷新`} />
          ) : null}
          <ResultStrip assets={assets} />
        </div>
        {cloud ? (
          <aside className={`space-y-4 rounded-2xl border p-5 ${asideClass}`}>
            <div className={`text-[11px] tracking-[0.18em] uppercase ${providerKickerClass(tone)}`}>{info?.label} · 生图</div>
            <Field label="模型">
              <Select value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.family} · {m.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="尺寸">
              <Select value={size} onChange={(e) => setSize(e.target.value)}>
                {sizes.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="张数">
              <Input type="number" min={1} max={6} value={n} onChange={(e) => setN(Number(e.target.value))} />
            </Field>
            <p className="text-xs leading-relaxed text-mute">{models.find((m) => m.id === model)?.description}</p>
            <CloudHint
              provider={engine}
              extra={
                engine === "meshy" ? "落盘目录 data/images/。Meshy 尺寸用宽高比，不是千问的 1024*1024。"
                : engine === "volcengine" ? "落盘目录 data/images/。方舟尺寸用 2K / 4K 或宽x高，不是千问的 1024*1024。"
                : "落盘目录 data/images/"
              }
            />
          </aside>
        ) : (
          <aside className="space-y-4 rounded-2xl border border-line bg-panel p-5">
            <WorkflowSelect feature="image" value={workflowId} onChange={setWorkflowId} />
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
        )}
      </div>
    </section>
  );
}
