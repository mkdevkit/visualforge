import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { TaskRecord } from "../lib/types";
import { Button, ErrorBox, Field, Select, Spinner, Textarea } from "../components/ui";
import { ResultStrip } from "../components/AssetCard";
import { PageHead } from "../components/PageHead";
import { modelLabel, pickDefault, useCatalog, useQwenCatalog, useStationEngine } from "../lib/catalog";
import { ProviderHint } from "../components/ProviderHint";
import { WorkflowSelect } from "../components/WorkflowSelect";
import { EngineSwitch } from "../components/EngineSwitch";
import { QwenHint } from "../components/QwenHint";
import { useTaskPoll } from "../lib/useTaskPoll";

export function StudioMusic() {
  const catalog = useCatalog();
  const qwen = useQwenCatalog();
  const { engine, setEngine, providers } = useStationEngine("music");
  const qwenMode = engine === "qwen";
  const models = qwenMode ? qwen.music : catalog.music;
  const [model, setModel] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [prompt, setPrompt] = useState("雨夜铜灯下的民谣，木吉他与低音提琴，缓慢、温暖、带着一点锈蚀感");
  const [lyrics, setLyrics] = useState("");
  const [gender, setGender] = useState("female");
  const [instrumental, setInstrumental] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [task, setTask] = useState<TaskRecord | null>(null);
  const { assets, setAssets } = useTaskPoll(task, setTask, setError);

  useEffect(() => {
    const next = qwenMode ? pickDefault(qwen.music) : pickDefault(catalog.music, catalog.activeModels?.music);
    if (!models.some((m) => m.id === model)) setModel(next);
  }, [catalog, qwen, qwenMode, model, models]);

  return (
    <section className="mx-auto max-w-5xl px-8 py-10">
      <EngineSwitch value={engine} onChange={setEngine} providers={providers} />
      <PageHead
        tone={qwenMode ? "qwen" : "comfy"}
        kicker={qwenMode ? "千问云 · qianwenai.com" : "ComfyUI"}
        title="生音乐工位"
        desc={
          qwenMode
            ? "Fun-Music 云端谱曲，成品写入 data/music/。"
            : "通过 ComfyUI 音乐工作流生成歌曲或纯音乐。成品写入 data/music。"
        }
      />
      <div className="grid items-start gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <Field label="风格提示词">
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </Field>
          <Field label="自定义歌词" hint="与提示词二选一，同时填写时歌词优先">
            <Textarea value={lyrics} onChange={(e) => setLyrics(e.target.value)} className="min-h-28" />
          </Field>
          <label className="flex items-center gap-2 text-sm text-mute">
            <input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} />
            纯音乐（无人声）
          </label>
          <ErrorBox error={error || (task?.status === "failed" ? task.error : "")} />
          <Button
            disabled={busy || (!prompt.trim() && !lyrics.trim())}
            onClick={async () => {
              setBusy(true);
              setError("");
              setTask(null);
              try {
                const r = await api.generateMusic({
                  engine,
                  model,
                  workflowId,
                  prompt: prompt || undefined,
                  lyrics: lyrics || undefined,
                  gender,
                  isInstrumental: instrumental,
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
            {busy ? "提交中…" : "开始生成"}
          </Button>
          {busy ? <Spinner tone={qwenMode ? "qwen" : "comfy"} label={qwenMode ? "正在提交到千问云" : "正在提交到 ComfyUI"} /> : null}
          {task && task.status !== "succeeded" && task.status !== "failed" ? (
            <Spinner tone={qwenMode ? "qwen" : "comfy"} label={qwenMode ? "千问谱曲中，将自动刷新" : "ComfyUI 谱曲中，将自动刷新"} />
          ) : null}
          <ResultStrip assets={assets} />
        </div>
        {qwenMode ? (
          <aside className="space-y-4 rounded-2xl border border-qwen/40 bg-qwen/5 p-5">
            <div className="text-[11px] tracking-[0.18em] uppercase text-qwen">千问云 · 生音乐</div>
            <Field label="模型">
              <Select value={model} onChange={(e) => setModel(e.target.value)}>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="人声">
              <Select value={gender} onChange={(e) => setGender(e.target.value)} disabled={instrumental || model === "fun-music-preview"}>
                <option value="female">女声</option>
                <option value="male">男声</option>
              </Select>
            </Field>
            <p className="text-xs leading-relaxed text-mute">{models.find((m) => m.id === model)?.description}</p>
            <QwenHint extra="落盘目录 data/music/" error={qwen.loadError} />
          </aside>
        ) : (
          <aside className="space-y-4 rounded-2xl border border-line bg-panel p-5">
            <WorkflowSelect feature="music" value={workflowId} onChange={setWorkflowId} />
            <Field label="模型">
              <Select value={model} onChange={(e) => setModel(e.target.value)}>
                {(catalog.music || []).map((m) => (
                  <option key={m.id} value={m.id}>{modelLabel(m)}</option>
                ))}
              </Select>
            </Field>
            <Field label="人声">
              <Select value={gender} onChange={(e) => setGender(e.target.value)} disabled={instrumental}>
                <option value="female">女声</option>
                <option value="male">男声</option>
              </Select>
            </Field>
            <p className="text-xs leading-relaxed text-mute">使用 ComfyUI 音乐工作流。未下载的模型请到 ComfyManager「模型」页获取。</p>
            <ProviderHint feature="music" />
          </aside>
        )}
      </div>
    </section>
  );
}
