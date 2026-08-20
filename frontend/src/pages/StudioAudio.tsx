import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { modelLabel, pickDefault, useCatalog, useQwenCatalog, useStationEngine } from "../lib/catalog";
import type { DesignedVoice, TaskRecord } from "../lib/types";
import { Button, ErrorBox, Field, Input, Select, Spinner, Textarea } from "../components/ui";
import { ResultStrip } from "../components/AssetCard";
import { PageHead } from "../components/PageHead";
import { ProviderHint } from "../components/ProviderHint";
import { WorkflowSelect } from "../components/WorkflowSelect";
import { EngineSwitch } from "../components/EngineSwitch";
import { QwenHint } from "../components/QwenHint";
import { useTaskPoll } from "../lib/useTaskPoll";

type Tab = "tts" | "design" | "sfx";

export function StudioAudio() {
  const catalog = useCatalog();
  const qwen = useQwenCatalog();
  const { engine, setEngine, qwenOffered } = useStationEngine(["tts", "sfx", "voiceDesign"]);
  const qwenMode = engine === "qwen";
  const [tab, setTab] = useState<Tab>("tts");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [designed, setDesigned] = useState<DesignedVoice[]>([]);
  const [task, setTask] = useState<TaskRecord | null>(null);
  const pendingTab = useRef<Tab>("tts");
  const designMeta = useRef({ preferredName: "", targetModel: "", designModel: "", voicePrompt: "" });

  const ttsList = qwenMode ? qwen.tts : catalog.tts;
  const designList = qwenMode
    ? (qwen.voiceDesign.length ? qwen.voiceDesign : qwen.tts)
    : (catalog.voiceDesign.length ? catalog.voiceDesign : catalog.tts);
  const sfxList = qwenMode ? qwen.sfx : catalog.sfx;

  const [ttsModel, setTtsModel] = useState("");
  const [ttsWorkflowId, setTtsWorkflowId] = useState("");
  const [text, setText] = useState("雨停了。铜灯还亮着，巷子里只剩下水滴敲打石板的声音。");
  const [voice, setVoice] = useState(qwenMode ? "Cherry" : "default");
  const [lang, setLang] = useState("Chinese");
  const [instructions, setInstructions] = useState("沉稳、略带故事感，语速偏慢。");

  const [designModel, setDesignModel] = useState("");
  const [designWorkflowId, setDesignWorkflowId] = useState("");
  const [voicePrompt, setVoicePrompt] = useState("三十岁左右的女铸剑师，声线低、干燥、带着金属余韵，不甜美，吐字干净。");
  const [preferredName, setPreferredName] = useState("forge");
  const [targetModel, setTargetModel] = useState("");

  const [sfxModel, setSfxModel] = useState("");
  const [sfxWorkflowId, setSfxWorkflowId] = useState("");
  const [sfx, setSfx] = useState("暴雨敲打铸铁屋顶，远处一声低雷，近处有水滴落入铜盆。");
  const [duration, setDuration] = useState(6);

  const selectedDesign = designed.find((v) => v.id === voice);
  const systemVoices = qwenMode
    ? (qwen.ttsVoices?.length ? qwen.ttsVoices : ["Cherry"])
    : (catalog.ttsVoices?.length ? catalog.ttsVoices : ["default"]);
  const languages = qwenMode ? (qwen.languages || []) : (catalog.languages || []);

  useEffect(() => {
    const nextTts = pickDefault(ttsList, qwenMode ? undefined : catalog.activeModels?.tts);
    const nextDesign = pickDefault(designList, qwenMode ? undefined : catalog.activeModels?.voiceDesign);
    const nextTarget = pickDefault(ttsList, qwenMode ? undefined : catalog.activeModels?.tts);
    const nextSfx = pickDefault(sfxList, qwenMode ? undefined : catalog.activeModels?.sfx);
    if (!ttsList.some((m) => m.id === ttsModel)) setTtsModel(nextTts);
    if (!designList.some((m) => m.id === designModel)) setDesignModel(nextDesign);
    if (!ttsList.some((m) => m.id === targetModel)) setTargetModel(nextTarget);
    if (!sfxList.some((m) => m.id === sfxModel)) setSfxModel(nextSfx);
    if (qwenMode && (voice === "default" || !voice)) setVoice("Cherry");
    if (!qwenMode && voice === "Cherry") setVoice("default");
  }, [catalog, qwen, qwenMode, ttsList, designList, sfxList, ttsModel, designModel, targetModel, sfxModel, voice]);

  useEffect(() => {
    api.voices().then((r) => setDesigned(r.voices || [])).catch(() => undefined);
  }, []);

  function applyDesignedVoice(v: DesignedVoice) {
    setVoice(v.id);
    if (v.targetModel) setTtsModel(v.targetModel);
    setTab("tts");
  }

  const { assets, setAssets } = useTaskPoll(task, setTask, setError, () => {
    if (pendingTab.current !== "design") return;
    api.voices().then((r) => {
      setDesigned(r.voices || []);
      const meta = designMeta.current;
      const hit = (r.voices || []).find((v) => v.id === meta.preferredName || v.name === meta.preferredName);
      if (hit) applyDesignedVoice(hit);
    }).catch(() => undefined);
  });

  const tabs: { id: Tab; label: string }[] = [
    { id: "tts", label: "配音" },
    { id: "design", label: "音色设计" },
    { id: "sfx", label: "音效" },
  ];

  return (
    <section className="mx-auto max-w-5xl px-8 py-10">
      <EngineSwitch value={engine} onChange={setEngine} showQwen={qwenOffered} />
      <PageHead
        tone={qwenMode ? "qwen" : "comfy"}
        kicker={qwenMode ? "千问云 · qianwenai.com" : "ComfyUI"}
        title="音频工位"
        desc={
          qwenMode
            ? "Qwen-Audio-TTS、Qwen3-TTS、CosyVoice、Omni。成品写入 data/audio/。"
            : "配音、音色设计与音效均走 ComfyUI 工作流。成品写入 data/audio。"
        }
      />
      <div className="mb-6 flex gap-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-full px-4 py-1.5 text-sm ${tab === t.id ? (qwenMode ? "bg-qwen text-ink" : "bg-ember text-foam") : "border border-line text-mute"}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="grid items-start gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          {tab === "tts" ? (
            <>
              <Field label="台词">
                <Textarea value={text} onChange={(e) => setText(e.target.value)} />
              </Field>
              <Field label="演绎指令" hint={qwenMode ? "Qwen3-TTS Instruct 可用" : "对应工作流中的 {{instructions}}"}>
                <Input value={instructions} onChange={(e) => setInstructions(e.target.value)} />
              </Field>
              {selectedDesign ? (
                <p className={`text-xs leading-relaxed ${qwenMode ? "text-qwen" : "text-brass"}`}>
                  当前角色「{selectedDesign.name}」，音色 ID {selectedDesign.id}。
                </p>
              ) : (
                <p className="text-xs text-mute">可在「音色设计」中创建本机角色，之后会出现在音色下拉中。</p>
              )}
            </>
          ) : null}
          {tab === "design" ? (
            <>
              <Field label="音色描述">
                <Textarea value={voicePrompt} onChange={(e) => setVoicePrompt(e.target.value)} />
              </Field>
              <Field label="角色名称">
                <Input value={preferredName} onChange={(e) => setPreferredName(e.target.value)} />
              </Field>
              {designed.length ? (
                <div className="rounded-xl border border-line bg-ink-2/50 p-3 text-sm">
                  <div className={`mb-2 text-[11px] tracking-[0.16em] uppercase ${qwenMode ? "text-qwen" : "text-brass"}`}>已保存角色</div>
                  <ul className="space-y-2">
                    {designed.map((v) => (
                      <li key={v.id} className="flex items-center justify-between gap-2">
                        <span className="truncate text-foam">{v.name} · {v.id}</span>
                        <Button className="!px-3 !py-1 text-xs" tone="ghost" onClick={() => applyDesignedVoice(v)}>
                          用于配音
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-mute">本机还没有角色。生成后会写入 data/voices.json。</p>
              )}
            </>
          ) : null}
          {tab === "sfx" ? (
            <Field label="音效描述">
              <Textarea value={sfx} onChange={(e) => setSfx(e.target.value)} />
            </Field>
          ) : null}
          <ErrorBox error={error || (task?.status === "failed" ? task.error : "")} />
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              setTask(null);
              pendingTab.current = tab;
              try {
                if (tab === "tts") {
                  const r = await api.tts({ engine, model: ttsModel, workflowId: ttsWorkflowId, text, voice, languageType: lang, instructions });
                  if (r.assets?.length) setAssets(r.assets);
                  if (r.task) setTask(r.task);
                } else if (tab === "design") {
                  designMeta.current = { preferredName, targetModel, designModel, voicePrompt };
                  const r = await api.designVoice({
                    engine,
                    model: designModel,
                    workflowId: designWorkflowId,
                    voicePrompt,
                    preferredName,
                    prefix: preferredName,
                    targetModel,
                  });
                  if (r.voices) setDesigned(r.voices);
                  if (r.preview) setAssets([r.preview]);
                  if (r.assets?.length) setAssets(r.assets);
                  if (r.task) setTask(r.task);
                } else {
                  const r = await api.sfx({ engine, model: sfxModel, workflowId: sfxWorkflowId, prompt: sfx, duration });
                  if (r.assets?.length) setAssets(r.assets);
                  if (r.task) setTask(r.task);
                }
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "提交中…" : tab === "design" ? "创建并用于配音" : "开始生成"}
          </Button>
          {busy ? <Spinner tone={qwenMode ? "qwen" : "comfy"} label={qwenMode ? "正在提交到千问云" : "正在提交到 ComfyUI"} /> : null}
          {task && task.status !== "succeeded" && task.status !== "failed" ? (
            <Spinner tone={qwenMode ? "qwen" : "comfy"} label={qwenMode ? "千问音频合成中，将自动刷新" : "ComfyUI 音频合成中，将自动刷新"} />
          ) : null}
          <ResultStrip assets={assets} />
        </div>
        {qwenMode ? (
          <aside className="space-y-4 rounded-2xl border border-qwen/40 bg-qwen/5 p-5">
            <div className="text-[11px] tracking-[0.18em] uppercase text-qwen">千问云 · 音频</div>
            {tab === "tts" ? (
              <>
                <Field label="模型">
                  <Select value={ttsModel} onChange={(e) => setTtsModel(e.target.value)}>
                    {ttsList.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </Select>
                </Field>
                <Field label="音色">
                  <Select
                    value={voice}
                    onChange={(e) => {
                      const id = e.target.value;
                      const dv = designed.find((v) => v.id === id);
                      if (dv) applyDesignedVoice(dv);
                      else setVoice(id);
                    }}
                  >
                    {designed.length ? (
                      <optgroup label="设计角色">
                        {designed.map((v) => (
                          <option key={v.id} value={v.id}>{v.name} ({v.id})</option>
                        ))}
                      </optgroup>
                    ) : null}
                    <optgroup label="系统音色">
                      {systemVoices.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </optgroup>
                    {qwen.cosyVoices?.length ? (
                      <optgroup label="CosyVoice">
                        {qwen.cosyVoices.map((v) => (
                          <option key={v.id} value={v.id}>{v.label}</option>
                        ))}
                      </optgroup>
                    ) : null}
                  </Select>
                </Field>
                <Field label="自定义音色 ID" hint="也可手动粘贴">
                  <Input value={voice} onChange={(e) => setVoice(e.target.value)} />
                </Field>
                <Field label="语言">
                  <Select value={lang} onChange={(e) => setLang(e.target.value)}>
                    {languages.map((l) => <option key={l}>{l}</option>)}
                  </Select>
                </Field>
                <QwenHint extra="落盘目录 data/audio/" error={qwen.loadError} />
              </>
            ) : null}
            {tab === "design" ? (
              <>
                <Field label="设计模型">
                  <Select value={designModel} onChange={(e) => setDesignModel(e.target.value)}>
                    {designList.map((m) => (
                      <option key={m.id} value={m.id}>{m.label}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="后续合成模型">
                  <Select value={targetModel} onChange={(e) => setTargetModel(e.target.value)}>
                    {ttsList.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </Select>
                </Field>
                <p className="text-xs leading-relaxed text-mute">角色保存在本机 data/voices.json，之后配音可选用。</p>
                <QwenHint extra="走千问音色设计接口，不是 ComfyUI 工作流。" error={qwen.loadError} />
              </>
            ) : null}
            {tab === "sfx" ? (
              <>
                <Field label="模型">
                  <Select value={sfxModel} onChange={(e) => setSfxModel(e.target.value)}>
                    {sfxList.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </Select>
                </Field>
                <Field label="时长约（秒）">
                  <Input type="number" min={1} max={30} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
                </Field>
                <QwenHint extra="氛围音效走 Fun-Music 无人声；也可选 Omni。" error={qwen.loadError} />
              </>
            ) : null}
          </aside>
        ) : (
          <aside className="space-y-4 rounded-2xl border border-line bg-panel p-5">
            {tab === "tts" ? (
              <>
                <WorkflowSelect feature="tts" value={ttsWorkflowId} onChange={setTtsWorkflowId} />
                <Field label="模型">
                  <Select value={ttsModel} onChange={(e) => setTtsModel(e.target.value)}>
                    {(catalog.tts || []).map((m) => <option key={m.id} value={m.id}>{modelLabel(m)}</option>)}
                  </Select>
                </Field>
                <Field label="音色">
                  <Select
                    value={voice}
                    onChange={(e) => {
                      const id = e.target.value;
                      const dv = designed.find((v) => v.id === id);
                      if (dv) applyDesignedVoice(dv);
                      else setVoice(id);
                    }}
                  >
                    {designed.length ? (
                      <optgroup label="设计角色">
                        {designed.map((v) => (
                          <option key={v.id} value={v.id}>{v.name} ({v.id})</option>
                        ))}
                      </optgroup>
                    ) : null}
                    <optgroup label="系统音色">
                      {systemVoices.map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </optgroup>
                  </Select>
                </Field>
                <Field label="自定义音色 ID" hint="也可手动粘贴">
                  <Input value={voice} onChange={(e) => setVoice(e.target.value)} />
                </Field>
                <Field label="语言">
                  <Select value={lang} onChange={(e) => setLang(e.target.value)}>
                    {(catalog.languages || []).map((l) => <option key={l}>{l}</option>)}
                  </Select>
                </Field>
                <ProviderHint feature="tts" />
              </>
            ) : null}
            {tab === "design" ? (
              <>
                <WorkflowSelect feature="voiceDesign" value={designWorkflowId} onChange={setDesignWorkflowId} />
                <Field label="设计模型">
                  <Select value={designModel} onChange={(e) => setDesignModel(e.target.value)}>
                    {(catalog.voiceDesign.length ? catalog.voiceDesign : catalog.tts).map((m) => (
                      <option key={m.id} value={m.id}>{modelLabel(m)}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="后续合成模型">
                  <Select value={targetModel} onChange={(e) => setTargetModel(e.target.value)}>
                    {(catalog.tts || []).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </Select>
                </Field>
                <p className="text-xs leading-relaxed text-mute">
                  角色保存在本机。工作流可用 {"{{prompt}}"}、{"{{name}}"}、{"{{voice}}"}。
                </p>
                <ProviderHint feature="voiceDesign" />
              </>
            ) : null}
            {tab === "sfx" ? (
              <>
                <WorkflowSelect feature="sfx" value={sfxWorkflowId} onChange={setSfxWorkflowId} />
                <Field label="模型">
                  <Select value={sfxModel} onChange={(e) => setSfxModel(e.target.value)}>
                    {(catalog.sfx || []).map((m) => <option key={m.id} value={m.id}>{modelLabel(m)}</option>)}
                  </Select>
                </Field>
                <Field label="时长约（秒）">
                  <Input type="number" min={1} max={30} value={duration} onChange={(e) => setDuration(Number(e.target.value))} />
                </Field>
                <ProviderHint feature="sfx" />
              </>
            ) : null}
          </aside>
        )}
      </div>
    </section>
  );
}
