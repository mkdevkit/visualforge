import { useEffect, useRef, useState } from "react";
import { api, downloadWorkflowZip, importWorkflows, importWorkflowText } from "../lib/api";
import { Button, ErrorBox, Field, Input, Select, Textarea } from "../components/ui";
import { PageHead } from "../components/PageHead";
import { FEATURE_IDS, FEATURE_LABELS } from "../api/types";
import type { FeatureId } from "../api/types";

type StationWorkflow = {
  id: string;
  name: string;
  source: string;
  workflow: string;
  enabled: boolean;
};

type FeatureCfg = {
  mode: "prompt" | "http";
  url: string;
  model: string;
  workflow: string;
  workflowSource: string;
  workflows: StationWorkflow[];
  activeWorkflowId: string;
  extraHeaders: Record<string, string>;
  timeoutMs: number;
};

type Related = {
  id: string;
  label: string;
  filename: string;
  installed?: boolean;
  primary?: boolean;
  license?: string;
};

type WfItem = {
  path: string;
  name: string;
  size: number;
  mtime: string;
  format: "api" | "ui" | "unknown";
  assignedTo: string[];
};

function empty(): FeatureCfg {
  return {
    mode: "prompt",
    url: "",
    model: "",
    workflow: "",
    workflowSource: "",
    workflows: [],
    activeWorkflowId: "",
    extraHeaders: {},
    timeoutMs: 300000,
  };
}

function formatLabel(f: WfItem["format"]) {
  if (f === "api") return "API";
  if (f === "ui") return "画布";
  return "未知";
}

function stationList(f: FeatureCfg): StationWorkflow[] {
  if (f.workflows?.length) return f.workflows;
  if (!f.workflow) return [];
  return [
    {
      id: f.activeWorkflowId || "legacy",
      name: f.workflowSource ? f.workflowSource.split(/[/\\]/).pop() || "工作流" : "手动粘贴",
      source: f.workflowSource || "manual",
      workflow: f.workflow,
      enabled: true,
    },
  ];
}

function isLibrary(source?: string) {
  return Boolean(source) && source !== "manual";
}

const PLACEHOLDERS: Array<{ token: string; meaning: string; where: string }> = [
  { token: "{{prompt}}", meaning: "描述 / 音色描述", where: "几乎全部" },
  { token: "{{model}}", meaning: "所选主模型文件名，与工作流独立", where: "几乎全部" },
  { token: "{{negative}}", meaning: "负向提示", where: "生图" },
  { token: "{{image}}", meaning: "第一张参考图在 Comfy 里的文件名", where: "图生图、视频、3D" },
  { token: "{{image2}}", meaning: "第二张 / 尾帧", where: "视频、3D 动画" },
  { token: "{{width}} {{height}}", meaning: "分辨率；单独写成该占位符时替换成数字", where: "生图" },
  { token: "{{n}} {{seed}}", meaning: "张数、种子（未填则随机）", where: "生图" },
  { token: "{{duration}}", meaning: "时长，默认 5", where: "视频、音效" },
  { token: "{{resolution}} {{ratio}}", meaning: "默认 720P、16:9", where: "视频" },
  { token: "{{lyrics}} {{instrumental}}", meaning: "歌词、是否伴奏", where: "音乐" },
  { token: "{{text}} {{voice}} {{instructions}}", meaning: "台词、音色、指示", where: "配音" },
  { token: "{{name}}", meaning: "音色名", where: "音色设计" },
];

const AUTO_INJECT: Array<{ match: string; token: string }> = [
  { match: "第一个 ckpt_name / unet_name / model_name", token: "{{model}}" },
  { match: "第一个 CLIPTextEncode 的 text", token: "{{prompt}}" },
  { match: "第二个 CLIPTextEncode 的 text", token: "{{negative}}" },
  { match: "第一个 LoadImage 的 image", token: "{{image}}" },
  { match: "第二个 LoadImage 的 image", token: "{{image2}}" },
  { match: "已有的 width / height / seed 等控件", token: "{{width}} 等" },
];

export function Workflows() {
  const [features, setFeatures] = useState<Record<FeatureId, FeatureCfg>>(
    Object.fromEntries(FEATURE_IDS.map((id) => [id, empty()])) as Record<FeatureId, FeatureCfg>,
  );
  const [related, setRelated] = useState<Record<string, Related[]>>({});
  const [active, setActive] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<FeatureId | "">("image");
  const [editWf, setEditWf] = useState<Partial<Record<FeatureId, string>>>({});
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [items, setItems] = useState<WfItem[]>([]);
  const [root, setRoot] = useState("");
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [assignFor, setAssignFor] = useState<Record<string, FeatureId | "">>({});
  const [libPick, setLibPick] = useState<Partial<Record<FeatureId, string>>>({});
  const [pasteName, setPasteName] = useState("");
  const [pasteText, setPasteText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = async () => {
    const [f, m, w] = await Promise.all([api.features(), api.models(), api.workflows()]);
    const next = Object.fromEntries(FEATURE_IDS.map((id) => [id, empty()])) as Record<FeatureId, FeatureCfg>;
    for (const id of FEATURE_IDS) {
      const cur = (f.features as Record<string, FeatureCfg> | undefined)?.[id];
      if (cur) next[id] = { ...empty(), ...cur, workflows: cur.workflows || [] };
    }
    setFeatures(next);
    setActive((m.activeModels || {}) as Record<string, string>);
    setRelated(((m as { related?: Record<string, Related[]> }).related || {}) as Record<string, Related[]>);
    setItems(w.items || []);
    setRoot(w.root || "");
  };

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  function patch(id: FeatureId, part: Partial<FeatureCfg>) {
    setFeatures((prev) => ({ ...prev, [id]: { ...prev[id], ...part } }));
  }

  function patchList(id: FeatureId, list: StationWorkflow[], extra?: Partial<FeatureCfg>) {
    setFeatures((prev) => {
      const cur = prev[id];
      const activeId = extra?.activeWorkflowId ?? cur.activeWorkflowId;
      const current = list.find((w) => w.id === activeId) || list.find((w) => w.enabled) || list[0];
      return {
        ...prev,
        [id]: {
          ...cur,
          ...extra,
          workflows: list,
          activeWorkflowId: current?.id || "",
          workflow: current?.workflow || "",
          workflowSource: current?.source || "",
        },
      };
    });
  }

  async function joinLibrary(path: string, featureId: FeatureId) {
    setError("");
    setOk("");
    const r = await api.assignWorkflow(path, featureId) as { notes?: string[]; count?: number };
    setOk(`已用库文件加入${FEATURE_LABELS[featureId]}（现有 ${r.count ?? "?"} 份）${r.notes?.length ? `：${r.notes.slice(0, 4).join("；")}` : ""}`);
    await refresh();
  }

  const selected = items.filter((i) => picked[i.path]);

  return (
    <section className="mx-auto max-w-5xl px-8 py-10">
      <PageHead
        kicker="Workflows"
        title="工作流"
        desc="直接用上方 ComfyUI 工作流库里的 json：选工位后点加入。生成时会读这份文件（画布格式会转成 /prompt）。没有文件时可以粘贴 JSON，效果和上传一样。"
      />

      <div className="mb-8 rounded-2xl border border-line bg-panel p-5">
        <div className="text-[11px] tracking-[0.18em] uppercase text-brass">支持的占位符</div>
        <p className="mt-1 max-w-3xl text-xs leading-relaxed text-mute">
          占位符是节点里某个控件值的模板（API 写在{" "}
          <code className="font-mono text-foam/80">inputs</code>，画布写在{" "}
          <code className="font-mono text-foam/80">widgets_values</code>），连线不会动。上传原样 ComfyUI json 即可；生成时先注入还没写的槽，再用视铸参数替换。字段里已有{" "}
          <code className="font-mono text-foam/80">{"{{"}</code> 的一律跳过，不会覆盖。ComfyUI 收到的已经是填好的值。
        </p>
        <div className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {PLACEHOLDERS.map((row) => (
            <div key={row.token} className="min-w-0">
              <code className="font-mono text-[12px] text-brass">{row.token}</code>
              <p className="mt-0.5 text-xs text-mute">
                {row.meaning}
                <span className="text-foam/40"> · {row.where}</span>
              </p>
            </div>
          ))}
        </div>
        <div className="mt-4 border-t border-line pt-3">
          <div className="text-[11px] tracking-[0.16em] uppercase text-brass">json 没写时自动注入</div>
          <ul className="mt-2 grid gap-x-8 gap-y-1 text-xs text-mute sm:grid-cols-2">
            {AUTO_INJECT.map((row) => (
              <li key={row.token + row.match}>
                {row.match}
                <span className="text-foam/50"> → </span>
                <code className="font-mono text-brass">{row.token}</code>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs leading-relaxed text-mute">
            按转换后的 API 图遍历，不看节点标题。两个 CLIP 顺序反了会把提示词和负向填反；LoRA / CLIP 编码器 / VAE 默认不注入。
            <code className="mx-1 font-mono text-foam/80">{"{{image}}"}</code>
            填的是 Comfy 里的文件名，参考图会先上传。要避免猜错，在 json 里自己写占位符。
          </p>
        </div>
      </div>

      <div className="mb-8 space-y-4 rounded-2xl border border-line bg-panel p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[11px] tracking-[0.18em] uppercase text-brass">ComfyUI 工作流库</div>
            <p className="mt-1 text-xs text-mute">扫描 user/default/workflows、user/workflows、workflows。点「加入」即配到工位，之后以库文件为准，ComfyUI 里改完保存就会用新的。</p>
            {root ? <p className="mt-1 break-all font-mono text-[11px] text-mute">{root}</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".json,.zip,application/json,application/zip"
              multiple
              className="hidden"
              onChange={async (e) => {
                const files = Array.from(e.target.files || []);
                e.target.value = "";
                if (!files.length) return;
                setError("");
                setOk("");
                try {
                  const r = await importWorkflows(files);
                  setOk(`已导入 ${r.imported.length} 个${r.skipped.length ? `，跳过 ${r.skipped.length}` : ""}`);
                  await refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            />
            <Button tone="ghost" onClick={() => fileRef.current?.click()}>上传 JSON / ZIP</Button>
            <Button
              tone="ghost"
              disabled={!selected.length && !items.length}
              onClick={async () => {
                setError("");
                try {
                  await downloadWorkflowZip(selected.length ? selected.map((i) => i.path) : undefined);
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            >
              {selected.length ? `下载选中 ZIP（${selected.length}）` : "全部下载 ZIP"}
            </Button>
            <Button
              tone="ghost"
              disabled={!selected.length}
              onClick={async () => {
                if (!confirm(`删除选中的 ${selected.length} 个工作流文件？已加入工位的也会从工位里拿掉。`)) return;
                setError("");
                setOk("");
                try {
                  const r = await api.deleteWorkflows(selected.map((i) => i.path));
                  setOk(`已删除 ${r.deleted.length} 个`);
                  setPicked({});
                  await refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            >
              {selected.length ? `删除选中（${selected.length}）` : "删除选中"}
            </Button>
            <Button tone="ghost" onClick={() => refresh().catch((e) => setError(e.message))}>刷新</Button>
          </div>
        </div>

        <div className="space-y-2 rounded-xl border border-line bg-ink-2/50 p-3">
          <div className="text-[11px] tracking-[0.16em] uppercase text-brass">粘贴 JSON</div>
          <p className="text-xs text-mute">写入 ComfyUI 的 user/default/workflows/，和上传文件相同。画布或 API 格式都可以。同名会覆盖。</p>
          <Field label="文件名" hint="会自动补 .json">
            <Input
              className="font-mono text-sm"
              placeholder="qwen-image.json"
              value={pasteName}
              onChange={(e) => setPasteName(e.target.value)}
            />
          </Field>
          <Textarea
            className="min-h-36 font-mono text-xs"
            placeholder="{ ... }"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
          />
          <Button
            tone="ghost"
            className="py-1.5 text-xs"
            disabled={!pasteText.trim()}
            onClick={async () => {
              setError("");
              setOk("");
              try {
                const raw = pasteName.trim() || "pasted.json";
                const name = raw.toLowerCase().endsWith(".json") ? raw : `${raw}.json`;
                const exists = items.some((i) => i.path.replace(/\\/g, "/").split("/").pop()?.toLowerCase() === name.toLowerCase());
                if (exists && !confirm(`库里已有 ${name}，覆盖？`)) return;
                const r = await importWorkflowText(name, pasteText);
                setOk(`已写入 ${r.imported.join("、")}`);
                setPasteText("");
                await refresh();
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }}
          >
            写入工作流库
          </Button>
        </div>

        {!items.length ? (
          <p className="text-sm text-mute">还没有工作流。在 ComfyUI 里保存，或上传 / 粘贴 JSON。</p>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-2 text-[11px] uppercase tracking-wide text-mute">
                <tr>
                  <th className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={items.length > 0 && items.every((i) => picked[i.path])}
                      onChange={(e) => {
                        const on = e.target.checked;
                        setPicked(Object.fromEntries(items.map((i) => [i.path, on])));
                      }}
                    />
                  </th>
                  <th className="px-3 py-2">文件</th>
                  <th className="px-3 py-2">格式</th>
                  <th className="px-3 py-2">工位</th>
                  <th className="px-3 py-2">配到工位</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.path} className="border-t border-line">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        checked={Boolean(picked[item.path])}
                        onChange={(e) => setPicked((prev) => ({ ...prev, [item.path]: e.target.checked }))}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{item.name}</div>
                      <div className="break-all font-mono text-[11px] text-mute">{item.path}</div>
                    </td>
                    <td className="px-3 py-2 text-mute">{formatLabel(item.format)}</td>
                    <td className="px-3 py-2 text-xs text-brass">
                      {item.assignedTo.length ? item.assignedTo.map((id) => FEATURE_LABELS[id as FeatureId] || id).join("、") : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-2">
                        <Select
                          className="min-w-28 py-1.5 text-xs"
                          value={assignFor[item.path] || ""}
                          onChange={(e) => setAssignFor((prev) => ({ ...prev, [item.path]: e.target.value as FeatureId | "" }))}
                        >
                          <option value="">选择工位</option>
                          {FEATURE_IDS.map((id) => (
                            <option key={id} value={id}>{FEATURE_LABELS[id]}</option>
                          ))}
                        </Select>
                        <Button
                          tone="ghost"
                          className="py-1.5 text-xs"
                          disabled={!assignFor[item.path]}
                          onClick={async () => {
                            const featureId = assignFor[item.path];
                            if (!featureId) return;
                            setError("");
                            setOk("");
                            try {
                              await joinLibrary(item.path, featureId);
                            } catch (err) {
                              setError(err instanceof Error ? err.message : String(err));
                            }
                          }}
                        >
                          加入
                        </Button>
                        <Button
                          tone="danger"
                          className="py-1.5 text-xs"
                          onClick={async () => {
                            const used = item.assignedTo.map((id) => FEATURE_LABELS[id as FeatureId] || id).join("、");
                            if (!confirm(used ? `删除 ${item.name}？会从工位（${used}）里拿掉。` : `删除 ${item.name}？`)) return;
                            setError("");
                            setOk("");
                            try {
                              await api.deleteWorkflows([item.path]);
                              setOk(`已删除 ${item.name}`);
                              setPicked((prev) => {
                                const next = { ...prev };
                                delete next[item.path];
                                return next;
                              });
                              await refresh();
                            } catch (err) {
                              setError(err instanceof Error ? err.message : String(err));
                            }
                          }}
                        >
                          删除
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mb-4 text-sm text-mute">
        推荐路径：ComfyUI 保存或上传/粘贴 json → 本页库里加入工位 → 视铸指定工作流和模型。
      </p>
      <ErrorBox error={error} />
      {ok ? <div className="mb-4 text-sm text-brass">{ok}</div> : null}
      <div className="space-y-3">
        {FEATURE_IDS.map((id) => {
          const f = features[id];
          const open = openId === id;
          const models = related[id] || [];
          const primary = models.filter((m) => m.primary);
          const list = stationList(f);
          const enabledCount = list.filter((w) => w.enabled).length;
          const editingId = editWf[id] || f.activeWorkflowId || list[0]?.id || "";
          const editing = list.find((w) => w.id === editingId) || list[0];
          return (
            <div key={id} className="rounded-2xl border border-line bg-panel">
              <button className="flex w-full items-center justify-between px-5 py-4 text-left" onClick={() => setOpenId(open ? "" : id)}>
                <span>{FEATURE_LABELS[id]}</span>
                <span className="text-sm text-brass">
                  {list.length ? `${enabledCount}/${list.length} 份生效` : "未配置"}
                  {" · "}
                  {primary.filter((m) => m.installed).length}/{primary.length} 主模型
                </span>
              </button>
              {open ? (
                <div className="space-y-4 border-t border-line px-5 py-4">
                  <div>
                    <div className="mb-2 text-[11px] tracking-[0.16em] uppercase text-brass">本工位模型</div>
                    <ul className="space-y-1 text-sm">
                      {models.length ? models.map((m) => (
                        <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-mute">
                          <span>
                            {m.primary ? "主模型" : "配套"} · {m.label}
                            <span className="ml-2 font-mono text-xs">{m.filename}</span>
                          </span>
                          <span className={m.installed ? "text-brass" : ""}>{m.installed ? "已下载" : "未下载"}</span>
                        </li>
                      )) : <li className="text-mute">目录里没有该工位的模型</li>}
                    </ul>
                  </div>
                  <Field label="默认模型" hint="视铸工位下拉的默认值。生成时仍可另选；会替换工作流里的 {{model}}。">
                    <Select
                      value={active[id] || ""}
                      onChange={async (e) => {
                        const next = { ...active, [id]: e.target.value };
                        setActive(next);
                        try {
                          await api.saveActive(next);
                        } catch (err) {
                          setError(err instanceof Error ? err.message : String(err));
                        }
                      }}
                    >
                      <option value="">未指定</option>
                      {primary.filter((m) => m.installed).map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </Select>
                  </Field>
                  <div>
                    <div className="mb-2 text-[11px] tracking-[0.16em] uppercase text-brass">本工位工作流</div>
                    <div className="mb-3 flex flex-wrap gap-2">
                      <Select
                        className="min-w-48 flex-1 py-1.5 text-xs"
                        value={libPick[id] || ""}
                        onChange={(e) => setLibPick((prev) => ({ ...prev, [id]: e.target.value }))}
                      >
                        <option value="">{items.length ? "从工作流库选择 json" : "库是空的，请先在 ComfyUI 保存"}</option>
                        {items.map((item) => (
                          <option key={item.path} value={item.path}>
                            {item.name}{item.assignedTo.includes(id) ? "（已加入）" : ""} · {formatLabel(item.format)}
                          </option>
                        ))}
                      </Select>
                      <Button
                        tone="ghost"
                        className="py-1.5 text-xs"
                        disabled={!libPick[id]}
                        onClick={async () => {
                          const path = libPick[id];
                          if (!path) return;
                          try {
                            await joinLibrary(path, id);
                          } catch (err) {
                            setError(err instanceof Error ? err.message : String(err));
                          }
                        }}
                      >
                        加入
                      </Button>
                    </div>
                    {!list.length ? (
                      <p className="text-sm text-mute">还没有工作流。选库里的 json 点加入即可。</p>
                    ) : (
                      <ul className="space-y-2">
                        {list.map((w) => (
                          <li key={w.id} className={`rounded-xl border px-3 py-2 text-sm ${editing?.id === w.id ? "border-brass/60 bg-brass/5" : "border-line"}`}>
                            <div className="flex flex-wrap items-center gap-2">
                              <label className="flex items-center gap-1.5 text-xs text-mute">
                                <input
                                  type="checkbox"
                                  checked={w.enabled}
                                  onChange={(e) => {
                                    const next = list.map((x) => (x.id === w.id ? { ...x, enabled: e.target.checked } : x));
                                    patchList(id, next);
                                  }}
                                />
                                生效
                              </label>
                              <Input
                                className="min-w-32 flex-1 py-1 text-sm"
                                value={w.name}
                                onChange={(e) => {
                                  const next = list.map((x) => (x.id === w.id ? { ...x, name: e.target.value } : x));
                                  patchList(id, next);
                                }}
                              />
                              {f.activeWorkflowId === w.id ? (
                                <span className="text-[11px] text-brass">默认</span>
                              ) : (
                                <Button
                                  tone="ghost"
                                  className="py-1 text-xs"
                                  onClick={() => patchList(id, list, { activeWorkflowId: w.id })}
                                >
                                  设为默认
                                </Button>
                              )}
                              {isLibrary(w.source) ? null : (
                                <Button
                                  tone="ghost"
                                  className="py-1 text-xs"
                                  onClick={() => {
                                    setEditWf((prev) => ({ ...prev, [id]: w.id }));
                                  }}
                                >
                                  编辑
                                </Button>
                              )}
                              <Button
                                tone="ghost"
                                className="py-1 text-xs"
                                onClick={() => {
                                  const next = list.filter((x) => x.id !== w.id);
                                  patchList(id, next);
                                  if (editingId === w.id) setEditWf((prev) => ({ ...prev, [id]: next[0]?.id || "" }));
                                }}
                              >
                                移除
                              </Button>
                            </div>
                            {w.source && w.source !== "manual" ? (
                              <p className="mt-1 break-all font-mono text-[11px] text-mute">库文件 · {w.source}</p>
                            ) : (
                              <p className="mt-1 text-[11px] text-mute">手动粘贴</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <Field label="调用方式">
                    <Select value={f.mode} onChange={(e) => patch(id, { mode: e.target.value as FeatureCfg["mode"] })}>
                      <option value="prompt">官方 /prompt</option>
                      <option value="http">自定义 HTTP</option>
                    </Select>
                  </Field>
                  <Field label={f.mode === "http" ? "接口 URL" : "地址覆盖（可空，默认用本机 Comfy）"}>
                    <Input value={f.url} onChange={(e) => patch(id, { url: e.target.value })} />
                  </Field>
                  {f.mode === "http" || (editing && !isLibrary(editing.source)) ? (
                    <Field label={f.mode === "http" ? `JSON 请求体 · ${editing?.name || ""}` : `API 工作流 · ${editing?.name || ""}`}>
                      <Textarea
                        className="min-h-48 font-mono text-xs"
                        value={editing?.workflow || f.workflow}
                        onChange={(e) => {
                          if (editing) {
                            const next = list.map((x) => (x.id === editing.id ? { ...x, workflow: e.target.value } : x));
                            patchList(id, next);
                          } else {
                            patch(id, { workflow: e.target.value, workflowSource: f.workflowSource || "manual" });
                          }
                        }}
                      />
                    </Field>
                  ) : editing && isLibrary(editing.source) ? (
                    <p className="text-xs leading-relaxed text-mute">
                      正在用库文件 {editing.source}。请在 ComfyUI 里改图并保存，视铸生成时会重新读取并转换。
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-6">
        <Button
          onClick={async () => {
            setError("");
            setOk("");
            try {
              await api.saveFeatures(features);
              setOk("已保存，视铸刷新后即可指定工作流和模型");
              await refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          保存工作流
        </Button>
      </div>
    </section>
  );
}
