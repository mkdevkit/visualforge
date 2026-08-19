import { useEffect, useState } from "react";
import { api, fileUrl } from "../lib/api";
import type { AssetRecord, TaskRecord } from "../lib/types";
import { Button, Dropzone, ErrorBox, Field, Select, Spinner, Textarea } from "../components/ui";
import { PageHead } from "../components/PageHead";
import { modelLabel, pickDefault, relatedHint, uploadAll, useCatalog } from "../lib/catalog";
import { ProviderHint } from "../components/ProviderHint";
import { WorkflowSelect } from "../components/WorkflowSelect";
import { ModelPreview } from "../components/ModelPreview";
import { MOTION_DEMO, MOTION_LIBRARIES } from "../lib/motions";
import { useTaskPoll } from "../lib/useTaskPoll";

type RigEngine = "auto" | "unirig" | "mixamo" | "bbox";

export function Studio3D() {
  const catalog = useCatalog();
  const [model, setModel] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [prompt, setPrompt] = useState("一只坐着的机械狐狸，铜与黑铁拼接，可直接用于游戏资产");
  const [files, setFiles] = useState<File[]>([]);
  const [quality, setQuality] = useState("standard");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [task, setTask] = useState<TaskRecord | null>(null);
  const [preview, setPreview] = useState<AssetRecord | null>(null);
  const { assets } = useTaskPoll(task, setTask, setError);
  const [rigBusy, setRigBusy] = useState(false);
  const [engine, setEngine] = useState<RigEngine>("auto");
  const [motionFiles, setMotionFiles] = useState<File[]>([]);
  const [rigInfo, setRigInfo] = useState<{ unirig?: { installed?: boolean }; mixamo?: { clips?: string[]; blender?: boolean } } | null>(null);

  useEffect(() => {
    if (!model) setModel(pickDefault(catalog.model3d, catalog.activeModels?.model3d));
  }, [catalog, model]);

  useEffect(() => {
    api.rigStatus().then(setRigInfo).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (assets[0]) setPreview(assets[0]);
  }, [assets]);

  return (
    <section className="mx-auto max-w-5xl px-8 py-10">
      <PageHead kicker="ComfyUI" title="生 3D 工位" desc="文生 / 图生 3D。成品可绑骨：UniRig、Mixamo 命名骨骼 + 你自己的 Mixamo 动作，或快速几何估骨。" />
      <div className="grid items-start gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-4">
          <Field label="描述（文生 3D）">
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          </Field>
          <Dropzone accept="image/*" label="单图或多角度图（2-4 张）" files={files} onPicked={setFiles} />
          <ErrorBox error={error || (task?.status === "failed" ? task.error : "")} />
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              setPreview(null);
              setTask(null);
              try {
                const images = await uploadAll(files);
                const r = await api.generate3d({
                  model,
                  workflowId,
                  prompt: images.length ? undefined : prompt,
                  image: images.length === 1 ? images[0] : undefined,
                  images: images.length >= 2 ? images : undefined,
                  textureQuality: quality,
                  geometryQuality: quality,
                });
                if (r.task) setTask(r.task);
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "提交中…" : "生成 3D"}
          </Button>
          {task ? (
            <div className="rounded-2xl border border-line bg-panel p-4 text-sm">
              <div>任务 {task.id} · {task.status}</div>
              {task.error ? <div className="mt-2 text-red-300">{task.error}</div> : null}
              {task.status === "succeeded" ? "已保存成品。" : <Spinner label="ComfyUI 重建中" />}
            </div>
          ) : null}
          {preview ? (
            <div className="space-y-3">
              <div className="overflow-hidden rounded-2xl border border-line">
                <ModelPreview src={fileUrl(preview.relPath)} alt={preview.title} className="h-80" />
              </div>
              {!preview.params?.rigged ? (
                <div className="space-y-3">
                  <Field label="绑骨引擎" hint={rigInfo?.unirig?.installed ? "UniRig 已就绪" : "UniRig 未安装"}>
                    <Select value={engine} onChange={(e) => setEngine(e.target.value as RigEngine)}>
                      <option value="auto">自动（优先 UniRig，否则 Mixamo 估骨）</option>
                      <option value="unirig">UniRig（ComfyManager 子进程）</option>
                      <option value="mixamo">Mixamo 骨骼 + 动作</option>
                      <option value="bbox">快速几何估骨</option>
                    </Select>
                  </Field>
                  {engine === "mixamo" || engine === "auto" ? (
                    <Dropzone
                      accept=".glb,.gltf,.fbx,.dae,model/gltf-binary"
                      label="Mixamo 动作（可选，GLB / FBX）"
                      files={motionFiles}
                      onPicked={setMotionFiles}
                    />
                  ) : null}
                  <Button
                    disabled={rigBusy}
                    onClick={async () => {
                      setRigBusy(true);
                      setError("");
                      try {
                        const animationRelPaths = motionFiles.length ? await uploadAll(motionFiles) : [];
                        const r = await api.rig3d(preview.id, { engine, animationRelPaths });
                        setPreview(r.asset);
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setRigBusy(false);
                      }
                    }}
                  >
                    {rigBusy ? (engine === "unirig" || engine === "auto" ? "绑骨中（UniRig 可能要数分钟）…" : "绑骨中…") : "绑骨并导出动画 GLB"}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-mute">
                  已绑骨。预览里可切换片段后下载 GLB。
                  {Array.isArray(preview.params?.clips) ? ` 片段：${(preview.params.clips as string[]).join(" / ")}` : ""}
                </p>
              )}
            </div>
          ) : null}
        </div>
        <aside className="space-y-4 rounded-2xl border border-line bg-panel p-5">
          <WorkflowSelect feature="model3d" value={workflowId} onChange={setWorkflowId} />
          <Field label="模型">
            <Select value={model} onChange={(e) => setModel(e.target.value)}>
              {(catalog.model3d || []).map((m) => <option key={m.id} value={m.id}>{modelLabel(m)}</option>)}
            </Select>
          </Field>
          <Field label="贴图 / 几何质量">
            <Select value={quality} onChange={(e) => setQuality(e.target.value)}>
              <option value="standard">standard</option>
              <option value="detailed">detailed（贴图）</option>
              <option value="ultra">ultra</option>
            </Select>
          </Field>
          {relatedHint(catalog, "model3d", model) ? (
            <p className="text-xs leading-relaxed text-mute">{relatedHint(catalog, "model3d", model)}</p>
          ) : null}
          <ProviderHint feature="model3d" />

          <div className="space-y-2 border-t border-line pt-4">
            <div className="text-[11px] tracking-[0.18em] uppercase text-brass">动作预览</div>
            <p className="text-xs leading-relaxed text-mute">
              下面是 CC0 演示角色。UniRig 由 ComfyManager 起 Python 子进程；Mixamo 没有官方绑骨 API，视铸用 mixamorig 骨骼名并合并你自己从 mixamo.com 下载的动作（不内置、不爬站）。FBX 转 GLB 需要本机 Blender
              {rigInfo?.mixamo?.blender ? "（已检测到）" : "（未检测到，可设 BLENDER_BIN）"}。
            </p>
            <div className="overflow-hidden rounded-xl border border-line">
              <ModelPreview
                src={MOTION_DEMO.src}
                alt={MOTION_DEMO.label}
                defaultClip={MOTION_DEMO.defaultClip}
                className="h-64"
              />
            </div>
            <ul className="space-y-2 text-xs leading-relaxed text-mute">
              {MOTION_LIBRARIES.map((lib) => (
                <li key={lib.name}>
                  <a className="text-brass underline" href={lib.url} target="_blank" rel="noreferrer">
                    {lib.name}
                  </a>
                  {" · "}
                  {lib.license}
                  <div>{lib.note}</div>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </section>
  );
}
