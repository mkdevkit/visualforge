import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button, ErrorBox, Field, Input, Select, Textarea } from "../components/ui";
import { PageHead } from "../components/PageHead";
import { FEATURE_IDS, FEATURE_LABELS } from "../api/types";
import type { FeatureId } from "../api/types";

type FeatureCfg = {
  mode: "prompt" | "http";
  url: string;
  model: string;
  workflow: string;
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

function empty(): FeatureCfg {
  return { mode: "prompt", url: "", model: "", workflow: "", extraHeaders: {}, timeoutMs: 300000 };
}

export function Workflows() {
  const [features, setFeatures] = useState<Record<FeatureId, FeatureCfg>>(
    Object.fromEntries(FEATURE_IDS.map((id) => [id, empty()])) as Record<FeatureId, FeatureCfg>,
  );
  const [related, setRelated] = useState<Record<string, Related[]>>({});
  const [active, setActive] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<FeatureId | "">("image");
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  const refresh = async () => {
    const [f, m] = await Promise.all([api.features(), api.models()]);
    const next = Object.fromEntries(FEATURE_IDS.map((id) => [id, empty()])) as Record<FeatureId, FeatureCfg>;
    for (const id of FEATURE_IDS) {
      const cur = (f.features as Record<string, FeatureCfg> | undefined)?.[id];
      if (cur) next[id] = { ...empty(), ...cur };
    }
    setFeatures(next);
    setActive((m.activeModels || {}) as Record<string, string>);
    setRelated(((m as { related?: Record<string, Related[]> }).related || {}) as Record<string, Related[]>);
  };

  useEffect(() => {
    refresh().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  function patch(id: FeatureId, part: Partial<FeatureCfg>) {
    setFeatures((prev) => ({ ...prev, [id]: { ...prev[id], ...part } }));
  }

  return (
    <section className="mx-auto max-w-4xl px-8 py-10">
      <PageHead
        kicker="Workflows"
        title="工位工作流"
        desc="视铸只配 ComfyManager 地址。各工位模型选项与 API 工作流都由本页提供。"
      />
      <p className="mb-6 text-sm text-mute">
        粘贴 ComfyUI「Save (API Format)」JSON。占位符：{"{{prompt}} {{model}} {{negative}} {{image}} {{image2}} {{width}} {{height}} {{text}} {{voice}} {{duration}} {{lyrics}}"}
      </p>
      <ErrorBox error={error} />
      {ok ? <div className="mb-4 text-sm text-brass">{ok}</div> : null}
      <div className="space-y-3">
        {FEATURE_IDS.map((id) => {
          const f = features[id];
          const open = openId === id;
          const models = related[id] || [];
          const primary = models.filter((m) => m.primary);
          return (
            <div key={id} className="rounded-2xl border border-line bg-panel">
              <button className="flex w-full items-center justify-between px-5 py-4 text-left" onClick={() => setOpenId(open ? "" : id)}>
                <span>{FEATURE_LABELS[id]}</span>
                <span className="text-sm text-brass">
                  {f.workflow ? "已配置工作流" : "未配置"} · {primary.filter((m) => m.installed).length}/{primary.length} 主模型
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
                  <Field label="当前生效模型" hint="视铸工位下拉的默认值">
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
                  <Field label="调用方式">
                    <Select value={f.mode} onChange={(e) => patch(id, { mode: e.target.value as FeatureCfg["mode"] })}>
                      <option value="prompt">官方 /prompt</option>
                      <option value="http">自定义 HTTP</option>
                    </Select>
                  </Field>
                  <Field label={f.mode === "http" ? "接口 URL" : "地址覆盖（可空，默认用本机 Comfy）"}>
                    <Input value={f.url} onChange={(e) => patch(id, { url: e.target.value })} />
                  </Field>
                  <Field label={f.mode === "http" ? "JSON 请求体" : "API 工作流"}>
                    <Textarea className="min-h-48 font-mono text-xs" value={f.workflow} onChange={(e) => patch(id, { workflow: e.target.value })} />
                  </Field>
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
              setOk("已保存，视铸刷新后即可使用");
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
