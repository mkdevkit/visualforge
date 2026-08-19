import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { TaskRecord } from "../lib/types";
import { Button, Dropzone, ErrorBox, Field, Input, Select, Spinner, Textarea } from "../components/ui";
import { PageHead } from "../components/PageHead";
import { modelLabel, pickDefault, relatedHint, uploadAll, useCatalog } from "../lib/catalog";
import { ProviderHint } from "../components/ProviderHint";

export function StudioVideo() {
  const catalog = useCatalog();
  const [model, setModel] = useState("");
  const [prompt, setPrompt] = useState("第1个镜头[0-3秒] 雨夜巷口，铜灯摇晃。第2个镜头[3-6秒] 机械狐狸抬头看向镜头，耳尖滴水。");
  const [resolution, setResolution] = useState("720P");
  const [ratio, setRatio] = useState("16:9");
  const [duration, setDuration] = useState(5);
  const [first, setFirst] = useState<File[]>([]);
  const [last, setLast] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [task, setTask] = useState<TaskRecord | null>(null);

  useEffect(() => {
    if (!model) setModel(pickDefault(catalog.video, catalog.activeModels?.video));
  }, [catalog, model]);

  useEffect(() => {
    if (!task || task.status === "succeeded" || task.status === "failed") return;
    const t = setInterval(async () => {
      const r = await api.task(task.id);
      setTask(r.task);
    }, 4000);
    return () => clearInterval(t);
  }, [task]);

  const selected = catalog.video.find((m) => m.id === model);
  const hasFrames = first.length > 0 || last.length > 0;

  return (
    <section className="mx-auto max-w-5xl px-8 py-10">
      <PageHead kicker="ComfyUI" title="生视频工位" desc="通过 ComfyUI 工作流生视频。Wan 2.2 做文生/图生视频；Wan Animate 2 做角色动画（参考图 + 驱动视频）。" />
      <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <Field label="分镜 / 提示词">
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="min-h-40" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Dropzone accept="image/*" label="首帧（可选）" files={first} onPicked={setFirst} multiple={false} />
            <Dropzone accept="image/*" label="尾帧（可选，需同时有首帧）" files={last} onPicked={setLast} multiple={false} />
          </div>
          <ErrorBox error={error} />
          <Button
            disabled={busy || !prompt.trim() || (last.length > 0 && first.length === 0)}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const firstIds = await uploadAll(first);
                const lastIds = await uploadAll(last);
                const r = await api.generateVideo({
                  model, prompt, resolution, ratio, duration,
                  firstFrame: firstIds[0],
                  lastFrame: lastIds[0],
                });
                setTask(r.task);
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
              {task.status === "succeeded" ? <div className="mt-2 text-brass">已写入资源库，前往「资源库」查看。</div> : <Spinner label="ComfyUI 渲染中，将自动轮询" />}
            </div>
          ) : null}
        </div>
        <aside className="space-y-4 rounded-2xl border border-line bg-panel p-5">
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
      </div>
    </section>
  );
}
