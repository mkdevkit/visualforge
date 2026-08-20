import { useEffect, useState } from "react";
import { api, restartApi } from "../lib/api";
import { invalidateCatalog } from "../lib/catalog";
import { managerBase, setManagerBase } from "../lib/manager";
import { readQwenPrefs, writeQwenPrefs } from "../lib/qwen-prefs";
import type { FeatureId, ProviderId, StationProviders } from "../lib/types";
import { FEATURE_IDS, FEATURE_LABELS } from "../lib/types";
import { PROVIDERS, PROVIDER_STATION_IDS, emptyStations, normalizeStation, providerIdsForStation, providerKickerClass } from "../lib/providers";
import { Button, ErrorBox, Field, Input, Select } from "../components/ui";
import { PageHead } from "../components/PageHead";

function qwenConfigured(qwen?: { apiKey?: string; configured?: boolean }) {
  return Boolean(qwen?.configured || qwen?.apiKey);
}

type CloudId = "meshy" | "midjourney" | "tripo" | "volcengine";

const CLOUD_META: Record<CloudId, { placeholder: string; defaultBase: string; keyHint: string }> = {
  meshy: { placeholder: "msy_…", defaultBase: "https://api.meshy.ai", keyHint: "在 meshy.ai 申请，形如 msy_…" },
  midjourney: { placeholder: "兼容网关 Key", defaultBase: "", keyHint: "官方没有公开 API，可填兼容网关 Key（当前不会真正出图）" },
  tripo: { placeholder: "Bearer Token", defaultBase: "https://openapi.tripo3d.ai", keyHint: "Tripo 官方 Key，不是千问云里的 Tripo" },
  volcengine: { placeholder: "Ark API Key", defaultBase: "https://ark.cn-beijing.volces.com/api/v3", keyHint: "火山方舟控制台申请，用于生图 / 生视频" },
};

type CloudForm = {
  apiKey: string;
  baseUrl: string;
  saved: boolean;
  hint: string;
  note: string;
  accessKeyId?: string;
  secretKey?: string;
  musicSaved?: boolean;
};

function emptyCloudForms(): Record<CloudId, CloudForm> {
  return {
    meshy: { apiKey: "", baseUrl: CLOUD_META.meshy.defaultBase, saved: false, hint: "", note: "" },
    midjourney: { apiKey: "", baseUrl: "", saved: false, hint: "", note: "" },
    tripo: { apiKey: "", baseUrl: CLOUD_META.tripo.defaultBase, saved: false, hint: "", note: "" },
    volcengine: { apiKey: "", baseUrl: CLOUD_META.volcengine.defaultBase, saved: false, hint: "", note: "", accessKeyId: "", secretKey: "", musicSaved: false },
  };
}

function toggleProvider(cur: StationProviders, feature: FeatureId, id: ProviderId, on: boolean): StationProviders {
  const allowed = providerIdsForStation(feature);
  let enabled = cur.enabled.filter((p) => allowed.includes(p));
  if (on && allowed.includes(id) && !enabled.includes(id)) enabled = [...enabled, id];
  if (!on) enabled = enabled.filter((p) => p !== id);
  if (!enabled.length) enabled = [allowed.includes("comfyui") ? "comfyui" : allowed[0]];
  const def = enabled.includes(cur.default) ? cur.default : enabled[0];
  return { enabled, default: def };
}

export function Settings() {
  const [tab, setTab] = useState<ProviderId>("comfyui");
  const [dataDir, setDataDir] = useState("");
  const [configDir, setConfigDir] = useState("");
  const [managerUrl, setManagerUrl] = useState(managerBase());
  const [qwenKey, setQwenKey] = useState("");
  const [qwenWorkspace, setQwenWorkspace] = useState("");
  const [qwenBase, setQwenBase] = useState("https://dashscope.aliyuncs.com/api/v1");
  const [keyHint, setKeyHint] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [engines, setEngines] = useState<Record<FeatureId, StationProviders>>(emptyStations);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [mgrNote, setMgrNote] = useState("");
  const [qwenNote, setQwenNote] = useState("");
  const [cloudForms, setCloudForms] = useState<Record<CloudId, CloudForm>>(emptyCloudForms);
  const [apiNote, setApiNote] = useState("");
  const [apiRestarting, setApiRestarting] = useState(false);

  const refresh = async () => {
    const prefs = readQwenPrefs();
    try {
      const r = await api.settings();
      const s = r.settings as {
        dataDir?: string;
        configDir?: string;
        managerUrl?: string;
        qwen?: { apiKey?: string; workspaceId?: string; baseUrl?: string; configured?: boolean };
        meshy?: { apiKey?: string; baseUrl?: string; configured?: boolean };
        midjourney?: { apiKey?: string; baseUrl?: string; configured?: boolean };
        tripo?: { apiKey?: string; baseUrl?: string; configured?: boolean };
        volcengine?: { apiKey?: string; baseUrl?: string; accessKeyId?: string; secretKey?: string; configured?: boolean; musicConfigured?: boolean };
        engines?: Record<string, StationProviders | ProviderId>;
      };
      setDataDir(s.dataDir || "");
      setConfigDir(s.configDir || "");
      if (s.managerUrl) {
        setManagerBase(s.managerUrl);
        setManagerUrl(s.managerUrl);
      }
      const saved = qwenConfigured(s.qwen);
      setKeySaved(saved);
      setKeyHint(s.qwen?.apiKey || "");
      setQwenWorkspace(s.qwen?.workspaceId || prefs.workspaceId || "");
      if (s.qwen?.baseUrl) setQwenBase(s.qwen.baseUrl);
      else if (prefs.baseUrl) setQwenBase(prefs.baseUrl);
      const next = emptyStations();
      for (const id of FEATURE_IDS) {
        next[id] = normalizeStation(id, s.engines?.[id]);
      }
      setEngines(next);
      if (prefs.apiKey) setQwenKey(prefs.apiKey);
      if (saved) setQwenNote("千问 API Key 已写入本机 settings.json");
      else if (prefs.apiKey) {
        setQwenNote("浏览器里还留着上次填的 Key，但生成服务文件里是空的。正在补写…");
        try {
          const pushed = await api.saveSettings({ qwen: { apiKey: prefs.apiKey } });
          const qwen = pushed.settings?.qwen as { configured?: boolean; apiKey?: string } | undefined;
          if (qwenConfigured(qwen)) {
            setKeySaved(true);
            setKeyHint(qwen?.apiKey || "");
            setQwenNote("千问 API Key 已写入本机 settings.json");
          } else {
            setQwenNote("浏览器里还留着上次填的 Key，但生成服务没有存上。请再点一次保存。");
          }
        } catch {
          setQwenNote("浏览器里还留着上次填的 Key，但生成服务没有存上。请再点一次保存。");
        }
      } else setQwenNote("千问 API Key 未配置。要用千问云的工位，请先填写 Key。");
      const nextCloud = emptyCloudForms();
      for (const id of ["meshy", "midjourney", "tripo", "volcengine"] as const) {
        const row = s[id];
        const cloudSaved = Boolean(row?.configured || row?.apiKey);
        nextCloud[id] = {
          apiKey: "",
          baseUrl: row?.baseUrl || CLOUD_META[id].defaultBase,
          saved: cloudSaved,
          hint: row?.apiKey || "",
          note: cloudSaved ? "API Key 已写入本机 settings.json" : "未配置 API Key。",
          accessKeyId: "",
          secretKey: "",
          musicSaved: id === "volcengine" ? Boolean(s.volcengine?.musicConfigured || (s.volcengine?.accessKeyId && s.volcengine?.secretKey)) : false,
        };
      }
      setCloudForms(nextCloud);
    } catch {
      if (prefs.apiKey) {
        setQwenKey(prefs.apiKey);
        setQwenWorkspace(prefs.workspaceId || "");
        if (prefs.baseUrl) setQwenBase(prefs.baseUrl);
      }
    }
    try {
      const p = await api.ping();
      if (p.engine && p.engine !== "VisualForge") {
        setApiNote(`旧进程占着 ${p.port || 18787}（${p.engine}）。请重启生成服务加载当前代码。`);
      } else {
        setApiNote(`在线 · ${p.engine || "VisualForge"} · 端口 ${p.port || 18787}${p.pid ? ` · PID ${p.pid}` : ""}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      if (/404|Not Found/i.test(msg)) setApiNote("18787 在跑，但是旧版。请重启生成服务加载当前代码。");
      else setApiNote("未启动或无响应。可点按钮重启 18787。");
    }
    try {
      const h = await api.health();
      const m = h.manager as {
        ok?: boolean;
        comfy?: { api?: { ok?: boolean }; connected?: boolean; processRunning?: boolean };
        error?: string;
      } | undefined;
      if (!m || m.ok === false) {
        setMgrNote(m?.error ? `ComfyManager 未连通：${m.error}` : "ComfyManager 未启动，请先运行 npm run manager");
      } else {
        const comfyOk = Boolean(m.comfy?.connected || m.comfy?.api?.ok);
        setMgrNote(`ComfyManager 在线 · ComfyUI ${comfyOk ? "已连通" : "未连通"}`);
      }
      if (h.qwen?.configured) setQwenNote("千问 API Key 已写入本机 settings.json");
      if (h.engine && h.engine !== "VisualForge") {
        setMgrNote((prev) => `${prev ? `${prev} · ` : ""}生成服务版本偏旧，请点上方「重启生成服务」`);
      }
    } catch {
      /* ComfyManager 超时不影响设置保存 */
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const active = PROVIDERS.find((p) => p.id === tab) || PROVIDERS[0];

  return (
    <section className="mx-auto max-w-5xl px-8 py-10">
      <PageHead
        kicker="Settings"
        title="设置"
        desc="平台提供商各自配置。工位里勾选要用的提供商，并指定默认；工位顶部只出现已勾选的标签。"
      />

      <div className="space-y-4 rounded-2xl border border-line bg-panel p-6">
        <h2 className="font-serif text-xl">视铸生成服务</h2>
        <p className="text-sm text-mute">{apiNote || "检测 18787…"}</p>
        <p className="text-xs text-mute">
          开发时由本页 Vite（5173）去关占用端口的旧进程并拉起当前代码。18787 挂了也能点。
        </p>
        <Button
          tone="ghost"
          disabled={apiRestarting}
          onClick={async () => {
            setApiRestarting(true);
            setError("");
            setOk("");
            setApiNote("正在重启生成服务…");
            try {
              await restartApi();
              setOk("生成服务已重启");
              await refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setApiRestarting(false);
            }
          }}
        >
          {apiRestarting ? "正在重启…" : "重启生成服务（18787）"}
        </Button>
        <Field label="配置目录" hint="设置和千问 Key 固定写在这里，不会进 Git">
          <Input value={configDir} readOnly />
        </Field>
        <Field label="成品根目录" hint="本机保存生成结果、任务和资源库（visualforge.sqlite）">
          <Input value={dataDir} onChange={(e) => setDataDir(e.target.value)} />
        </Field>
      </div>

      <div className="mt-6 overflow-hidden rounded-2xl border border-line bg-panel">
        <div className="flex flex-wrap gap-1 border-b border-line p-2">
          {PROVIDERS.map((p) => {
            const on = tab === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => setTab(p.id)}
                className={`rounded-xl px-4 py-2 text-sm transition ${
                  on
                    ? p.tone === "qwen"
                      ? "bg-qwen/20 text-foam"
                      : p.tone === "cloud"
                        ? "bg-cloud/20 text-foam"
                        : "bg-brass/20 text-foam"
                    : "text-mute hover:bg-ink-2/80 hover:text-foam"
                }`}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="space-y-4 p-6">
          <div>
            <div className={`text-[11px] tracking-[0.18em] uppercase ${providerKickerClass(active.tone)}`}>{active.kicker}</div>
            <h2 className="mt-1 font-serif text-xl text-foam">{active.label}</h2>
            <p className="mt-1 text-sm text-mute">{active.description}</p>
          </div>

          {tab === "comfyui" ? (
            <>
              <p className="text-sm text-mute">{mgrNote}</p>
              <Field label="ComfyManager 地址" hint="默认 http://127.0.0.1:18788">
                <Input value={managerUrl} onChange={(e) => setManagerUrl(e.target.value)} />
              </Field>
              <a className="inline-block text-sm text-brass underline" href={managerUrl || managerBase()} target="_blank" rel="noreferrer">
                打开 ComfyManager
              </a>
              <p className="text-sm text-mute">
                3D 动画（绑骨 / Mixamo / UniRig）不选云端提供商，由 ComfyManager 提供工具。Wan Animate 工作流也在管理端配置。
              </p>
            </>
          ) : null}

          {tab === "qwen" ? (
            <>
              <p className="text-sm text-mute">
                {qwenNote || "平台 "}
                {" "}
                <a className="text-qwen underline" href="https://www.qianwenai.com/" target="_blank" rel="noreferrer">
                  www.qianwenai.com
                </a>
                ，协议 DashScope。Key 写入本机 settings.json。
              </p>
              {keySaved ? (
                <p className="rounded-lg border border-qwen/40 bg-qwen/10 px-3 py-2 text-sm text-foam">
                  服务端已保存 Key{keyHint ? `（${keyHint}）` : ""}。密码框刷新后可以是空的，不等于没存上。
                </p>
              ) : null}
              <Field label="API Key" hint={keySaved ? "已写入生成服务；留空再保存不会覆盖" : "在官网申请，保存后写入本机 settings.json"}>
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder={keySaved ? "已配置，输入新值可替换" : "sk-…"}
                  value={qwenKey}
                  onChange={(e) => setQwenKey(e.target.value)}
                />
              </Field>
              <Field label="Workspace ID" hint="可选">
                <Input value={qwenWorkspace} onChange={(e) => setQwenWorkspace(e.target.value)} />
              </Field>
              <Field label="DashScope 地址" hint="默认北京区">
                <Input value={qwenBase} onChange={(e) => setQwenBase(e.target.value)} />
              </Field>
            </>
          ) : null}

          {tab === "meshy" || tab === "midjourney" || tab === "tripo" || tab === "volcengine" ? (
            <>
              <p className="text-sm text-mute">
                {cloudForms[tab].note}
                {active.docsUrl ? (
                  <>
                    {" "}
                    <a className={`${providerKickerClass(active.tone)} underline`} href={active.docsUrl} target="_blank" rel="noreferrer">
                      {active.docsUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                    </a>
                  </>
                ) : null}
              </p>
              {tab === "midjourney" ? (
                <p className="text-sm text-mute">
                  Midjourney 没有官方公开 API。视铸不会走 Discord 或非官方爬站。可填写兼容网关地址与 Key，但当前尚未接入任何第三方协议。
                </p>
              ) : null}
              {tab === "tripo" ? (
                <p className="text-sm text-mute">
                  这是 Tripo 官方 OpenAPI。千问云里的 Tripo-H3.1 / P1.0 要在千问模型市场单独开通，走另一套 Key。
                </p>
              ) : null}
              {tab === "volcengine" ? (
                <p className="text-sm text-mute">
                  生图 / 生视频走火山方舟（Seedream / Seedance），用 API Key。生音乐走海绵音乐 OpenAPI，要用账号 Access Key ID / Secret，在控制台「密钥管理」创建。
                </p>
              ) : null}
              {cloudForms[tab].saved ? (
                <p className={`rounded-lg border px-3 py-2 text-sm text-foam ${active.tone === "cloud" ? "border-cloud/40 bg-cloud/10" : "border-qwen/40 bg-qwen/10"}`}>
                  服务端已保存 Key{cloudForms[tab].hint ? `（${cloudForms[tab].hint}）` : ""}。密码框刷新后可以是空的，不等于没存上。
                </p>
              ) : null}
              <Field label="API Key" hint={cloudForms[tab].saved ? "已写入生成服务；留空再保存不会覆盖" : CLOUD_META[tab].keyHint}>
                <Input
                  type="password"
                  autoComplete="off"
                  placeholder={cloudForms[tab].saved ? "已配置，输入新值可替换" : CLOUD_META[tab].placeholder}
                  value={cloudForms[tab].apiKey}
                  onChange={(e) => setCloudForms((cur) => ({
                    ...cur,
                    [tab]: { ...cur[tab], apiKey: e.target.value },
                  }))}
                />
              </Field>
              <Field label="API 地址" hint={tab === "midjourney" ? "可选兼容网关；留空则无法出图" : tab === "volcengine" ? "默认北京区方舟" : "默认官方地址"}>
                <Input
                  value={cloudForms[tab].baseUrl}
                  onChange={(e) => setCloudForms((cur) => ({
                    ...cur,
                    [tab]: { ...cur[tab], baseUrl: e.target.value },
                  }))}
                  placeholder={CLOUD_META[tab].defaultBase || "https://…"}
                />
              </Field>
              {tab === "volcengine" ? (
                <>
                  {cloudForms.volcengine.musicSaved ? (
                    <p className="rounded-lg border border-cloud/40 bg-cloud/10 px-3 py-2 text-sm text-foam">
                      生音乐 Access Key 已写入。密码框刷新后可以是空的。
                    </p>
                  ) : (
                    <p className="text-xs text-mute">未配置 Access Key 时仍可生图 / 生视频，但不能生音乐。</p>
                  )}
                  <Field label="Access Key ID" hint="仅生音乐需要；留空再保存不会覆盖">
                    <Input
                      type="password"
                      autoComplete="off"
                      placeholder={cloudForms.volcengine.musicSaved ? "已配置，输入新值可替换" : "AK…"}
                      value={cloudForms.volcengine.accessKeyId || ""}
                      onChange={(e) => setCloudForms((cur) => ({
                        ...cur,
                        volcengine: { ...cur.volcengine, accessKeyId: e.target.value },
                      }))}
                    />
                  </Field>
                  <Field label="Secret Access Key" hint="与 Access Key ID 成对">
                    <Input
                      type="password"
                      autoComplete="off"
                      placeholder={cloudForms.volcengine.musicSaved ? "已配置，输入新值可替换" : "SK…"}
                      value={cloudForms.volcengine.secretKey || ""}
                      onChange={(e) => setCloudForms((cur) => ({
                        ...cur,
                        volcengine: { ...cur.volcengine, secretKey: e.target.value },
                      }))}
                    />
                  </Field>
                </>
              ) : null}
            </>
          ) : null}

          <div>
            <div className="text-[11px] tracking-[0.18em] uppercase text-mute">支持的工位</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {active.stations.map((id) => (
                <span key={id} className="rounded-full border border-line bg-ink/40 px-3 py-1 text-xs text-foam">
                  {FEATURE_LABELS[id]}
                </span>
              ))}
            </div>
            {PROVIDER_STATION_IDS.filter((id) => !active.stations.includes(id)).length ? (
              <p className="mt-2 text-xs text-mute">
                不支持：{PROVIDER_STATION_IDS.filter((id) => !active.stations.includes(id)).map((id) => FEATURE_LABELS[id]).join("、")}
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="mt-6 space-y-4 rounded-2xl border border-line bg-panel p-6">
        <h2 className="font-serif text-xl">各工位提供商</h2>
        <p className="text-sm text-mute">
          勾选该工位要出现的平台标签，并指定默认。只显示该提供商实际支持的生成工位。3D 动画不在此表：绑骨与动作合并依赖 ComfyManager，和谁生成的网格无关。
        </p>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-[0.12em] text-mute">
                <th className="px-4 py-2.5 font-medium">工位</th>
                {PROVIDERS.map((p) => (
                  <th key={p.id} className="px-4 py-2.5 font-medium">{p.label}</th>
                ))}
                <th className="px-4 py-2.5 font-medium">默认</th>
              </tr>
            </thead>
            <tbody>
              {PROVIDER_STATION_IDS.map((id) => {
                const allowed = providerIdsForStation(id);
                const row = engines[id];
                return (
                  <tr key={id} className="border-t border-line">
                    <td className="px-4 py-2.5">{FEATURE_LABELS[id]}</td>
                    {PROVIDERS.map((p) => {
                      const support = allowed.includes(p.id);
                      const checked = support && row.enabled.includes(p.id);
                      return (
                        <td key={p.id} className="px-4 py-2.5">
                          {support ? (
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-brass"
                              checked={checked}
                              onChange={(e) => setEngines((cur) => ({
                                ...cur,
                                [id]: toggleProvider(cur[id], id, p.id, e.target.checked),
                              }))}
                            />
                          ) : (
                            <span className="text-xs text-mute">—</span>
                          )}
                        </td>
                      );
                    })}
                    <td className="px-4 py-2.5">
                      <Select
                        value={row.default}
                        onChange={(e) => setEngines((cur) => ({
                          ...cur,
                          [id]: { ...cur[id], default: e.target.value as ProviderId },
                        }))}
                      >
                        {row.enabled.map((p) => (
                          <option key={p} value={p}>{PROVIDERS.find((x) => x.id === p)?.label || p}</option>
                        ))}
                      </Select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 space-y-3">
        <ErrorBox error={error} />
        {ok ? <div className="text-sm text-brass">{ok}</div> : null}
        <Button
          onClick={async () => {
            setError("");
            setOk("");
            try {
              setManagerBase(managerUrl);
              invalidateCatalog();
              const key = qwenKey.trim() || readQwenPrefs().apiKey || "";
              const qwenPatch: Record<string, string> = {
                workspaceId: qwenWorkspace,
                baseUrl: qwenBase,
              };
              if (key) qwenPatch.apiKey = key;
              writeQwenPrefs({
                apiKey: key || readQwenPrefs().apiKey,
                workspaceId: qwenWorkspace,
                baseUrl: qwenBase,
              });
              const saved = await api.saveSettings({
                dataDir,
                managerUrl,
                qwen: qwenPatch,
                meshy: {
                  baseUrl: cloudForms.meshy.baseUrl,
                  ...(cloudForms.meshy.apiKey.trim() ? { apiKey: cloudForms.meshy.apiKey.trim() } : {}),
                },
                midjourney: {
                  baseUrl: cloudForms.midjourney.baseUrl,
                  ...(cloudForms.midjourney.apiKey.trim() ? { apiKey: cloudForms.midjourney.apiKey.trim() } : {}),
                },
                tripo: {
                  baseUrl: cloudForms.tripo.baseUrl,
                  ...(cloudForms.tripo.apiKey.trim() ? { apiKey: cloudForms.tripo.apiKey.trim() } : {}),
                },
                volcengine: {
                  baseUrl: cloudForms.volcengine.baseUrl,
                  ...(cloudForms.volcengine.apiKey.trim() ? { apiKey: cloudForms.volcengine.apiKey.trim() } : {}),
                  ...(cloudForms.volcengine.accessKeyId?.trim() ? { accessKeyId: cloudForms.volcengine.accessKeyId.trim() } : {}),
                  ...(cloudForms.volcengine.secretKey?.trim() ? { secretKey: cloudForms.volcengine.secretKey.trim() } : {}),
                },
                engines,
              });
              const qwen = saved.settings?.qwen as { apiKey?: string; configured?: boolean } | undefined;
              if (key && !qwenConfigured(qwen)) {
                throw new Error("生成服务没有接下千问 API Key。请确认 18787 已启动，再到设置页保存一次。");
              }
              setOk(qwenConfigured(qwen) ? "已保存，Key 已写入生成服务" : "已保存");
              await refresh();
            } catch (e) {
              setOk("已记下部分设置，但生成本地服务可能未连上。");
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          保存
        </Button>
      </div>
    </section>
  );
}
