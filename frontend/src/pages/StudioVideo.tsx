import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { TaskRecord } from "../lib/types";
import { Button, Dropzone, ErrorBox, Field, Input, Select, Spinner, Textarea } from "../components/ui";
import { ResultStrip } from "../components/AssetCard";
import { PageHead } from "../components/PageHead";
import { modelLabel, pickDefault, relatedHint, uploadAll, useCatalog, useQwenCatalog, useStationEngine } from "../lib/catalog";
import { ProviderHint } from "../components/ProviderHint";
import { WorkflowSelect } from "../components/WorkflowSelect";
import { EngineSwitch } from "../components/EngineSwitch";
import { QwenHint } from "../components/QwenHint";
import { useTaskPoll } from "../lib/useTaskPoll";

export function StudioVideo() {
  const catalog = useCatalog();
  const qwen = useQwenCatalog();
  const { engine, setEngine, providers } = useStationEngine("video");
  const qwenMode = engine === "qwen";
  const models = qwenMode ? qwen.video : catalog.video;
  const [model, setModel] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [prompt, setPrompt] = useState("第1个镜头[0-3秒] 雨夜巷口，铜灯摇晃。第2个镜头[3-6秒] 机械狐狸抬头看向镜头，耳尖滴水。");
  const [resolution, setResolution] = useState("720P");
  const [ratio, setRatio] = useState("16:9");
  const [duration, setDuration] = useState(5);
  const [promptExtend, setPromptExtend] = useState(true);
  const [watermark, setWatermark] = useState(false);
  const [first, setFirst] = useState<File[]>([]);
  const [last, setLast] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [task, setTask] = useState<TaskRecord | null>(null);
  const { assets } = useTaskPoll(task, setTask, setError);

  useEffect(() => {
    const next = qwenMode
      ? pickDefault(qwen.video)
      : pickDefault(catalog.video, catalog.activeModels?.video);
    if (!models.some((m) => m.id === model)) setModel(next);
  }, [catalog, qwen, qwenMode, model, models]);

  const selected = models.find((m) => m.id === model);
  const hasFrames = first.length > 0 || last.length > 0;

  return (
    <section className="mx-auto max-w-5xl px-8 py-10">
      <EngineSwitch value={engine} onChange={setEngine} providers={providers} />
      <PageHead
        tone={qwenMode ? "qwen" : "comfy"}
        kicker={qwenMode ? "千问云 · qianwenai.com" : "ComfyUI"}
        title="生视频工位"
        desc={
          qwenMode
            ? "Wan 2.7/2.6、Wan-Video、HappyHorse 云端生视频，成品写入 data/videos/。有首帧时会自动改走图生视频模型。"
            : "通过 ComfyUI 工作流生视频。Wan 2.2 做文生/图生视频；Wan Animate 2 做角色动画（参考图 + 驱动视频）。"
        }
      />
      <div className="grid items-start gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <Field label="分镜 / 提示词">
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="min-h-40" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Dropzone accept="image/*" label="首帧（可选）" files={first} onPicked={setFirst} multiple={false} />
            <Dropzone accept="image/*" label="尾帧（可选，需同时有首帧）" files={last} onPicked={setLast} multiple={false} />
          </div>
          {qwenMode ? (
            <div className="flex flex-wrap gap-4 text-sm text-mute">
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={promptExtend} onChange={(e) => setPromptExtend(e.target.checked)} />
                智能扩写提示词
              </label>
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={watermark} onChange={(e) => setWatermark(e.target.checked)} />
                加水印
              </label>
            </div>
          ) : null}
          <ErrorBox error={error || (task?.status === "failed" ? task.error : "")} />
          <Button
            disabled={busy || !prompt.trim() || (last.length > 0 && first.length === 0)}
            onClick={async () => {
              setBusy(true);
              setError("");
              setTask(null);
              try {
                const firstIds = await uploadAll(first);
                const lastIds = await uploadAll(last);
                const r = await api.generateVideo({
                  engine,
                  model, workflowId, prompt, resolution, ratio, duration,
                  firstFrame: firstIds[0],
                  lastFrame: lastIds[0],
                  promptExtend: qwenMode ? promptExtend : undefined,
                  watermark: qwenMode ? watermark : undefined,
                });
                if (r.task) setTask(r.task);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "提交中…" : "提交视频任务"}
          </Button>
          {task ? (
            <div className="rounded-2xl border border-line bg-panel p-4 text-sm">
              <div>任务 {task.id} · {task.status} · {task.progress}%</div>
              {task.error ? <div className="mt-2 text-red-300">{task.error}</div> : null}
              {task.status === "succeeded" ? (
                <div className={`mt-2 ${qwenMode ? "text-qwen" : "text-brass"}`}>已写入成品。</div>
              ) : (
                <Spinner tone={qwenMode ? "qwen" : "comfy"} label={qwenMode ? "千问渲染中，将自动轮询" : "ComfyUI 渲染中，将自动轮询"} />
              )}
            </div>
          ) : null}
          <ResultStrip assets={assets} />
        </div>
        {qwenMode ? (
          <aside className="space-y-4 rounded-2xl border border-qwen/40 bg-qwen/5 p-5">
            <div className="text-[11px] tracking-[0.18em] uppercase text-qwen">千问云 · 生视频</div>
            <Field label="模型">
              <Select value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.family} · {m.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="分辨率">
              <Select value={resolution} onChange={(e) => setResolution(e.target.value)}>
                <option>480P</option>
                <option>720P</option>
                <option>1080P</option>
              </Select>
            </Field>
            <Field label="画幅">
              <Select value={ratio} onChange={(e) => setRatio(e.target.value)}>
                <option>16:9</option>
                <option>9:16</option>
                <option>1:1</option>
                <option>4:3</option>
                <option>3:4</option>
              </Select>
            </Field>
            <Field label="时长（秒）">
              <Input type="number" min={2} max={15} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </Field>
            <p className="text-xs leading-relaxed text-mute">{selected?.description}</p>
            {hasFrames ? (
              <p className="text-xs leading-relaxed text-qwen">已选参考帧：提交时会改走对应的图生 / 首尾帧模型。</p>
            ) : null}
            <QwenHint extra="落盘目录 data/videos/。视频链接约 24 小时失效，视铸会立刻下载。" error={qwen.loadError} />
          </aside>
        ) : (
          <aside className="space-y-4 rounded-2xl border border-line bg-panel p-5">
            <WorkflowSelect feature="video" value={workflowId} onChange={setWorkflowId} />
            <Field label="模型">
              <Select value={model} onChange={(e) => setModel(e.target.value)}>
                {(catalog.video || []).map((m) => (
                  <option key={m.id} value={m.id}>{m.family} · {modelLabel(m)}</option>
                ))}
              </Select>
            </Field>
            <Field label="分辨率">
              <Select value={resolution} onChange={(e) => setResolution(e.target.value)}>
                <option>480P</option>
                <option>720P</option>
                <option>1080P</option>
              </Select>
            </Field>
            <Field label="画幅">
              <Select value={ratio} onChange={(e) => setRatio(e.target.value)}>
                <option>16:9</option>
                <option>9:16</option>
                <option>1:1</option>
                <option>4:3</option>
                <option>3:4</option>
              </Select>
            </Field>
            <Field label="时长（秒）">
              <Input type="number" min={2} max={15} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
            </Field>
            <p className="text-xs leading-relaxed text-mute">{selected?.description}</p>
            {relatedHint(catalog, "video", model) ? (
              <p className="text-xs leading-relaxed text-mute">{relatedHint(catalog, "video", model)}</p>
            ) : null}
            {hasFrames ? (
              <p className="text-xs leading-relaxed text-brass">
                参考帧将作为工作流输入。请确认视频工位已配置含 LoadImage 的工作流。
              </p>
            ) : null}
            <ProviderHint feature="video" />
          </aside>
        )}
      </div>
    </section>
  );
}
