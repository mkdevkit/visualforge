import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AssetRecord } from "../lib/types";
import { Button, ErrorBox, Field, Select, Spinner, Textarea } from "../components/ui";
import { ResultStrip } from "../components/AssetCard";
import { PageHead } from "../components/PageHead";
import { modelLabel, pickDefault, useCatalog } from "../lib/catalog";
import { ProviderHint } from "../components/ProviderHint";
import { WorkflowSelect } from "../components/WorkflowSelect";

export function StudioMusic() {
  const catalog = useCatalog();
  const [model, setModel] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [prompt, setPrompt] = useState("雨夜铜灯下的民谣，木吉他与低音提琴，缓慢、温暖、带着一点锈蚀感");
  const [lyrics, setLyrics] = useState("");
  const [gender, setGender] = useState("female");
  const [instrumental, setInstrumental] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [assets, setAssets] = useState<AssetRecord[]>([]);

  useEffect(() => {
    if (!model) setModel(pickDefault(catalog.music, catalog.activeModels?.music));
  }, [catalog, model]);

  return (
    <section className="mx-auto max-w-5xl px-8 py-10">
      <PageHead kicker="ComfyUI" title="生音乐工位" desc="通过 ComfyUI 音乐工作流生成歌曲或纯音乐。成品写入 data/music。" />
      <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
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
          <ErrorBox error={error} />
          <Button
            disabled={busy || (!prompt.trim() && !lyrics.trim())}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const r = await api.generateMusic({
                  model,
                  workflowId,
                  prompt: prompt || undefined,
                  lyrics: lyrics || undefined,
                  gender,
                  isInstrumental: instrumental,
                });
                setAssets(r.assets);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "谱曲中…" : "开始生成"}
          </Button>
          {busy ? <Spinner label="ComfyUI 正在生成" /> : null}
        </div>
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
      </div>
      <div className="mt-10"><ResultStrip assets={assets} /></div>
    </section>
  );
}
