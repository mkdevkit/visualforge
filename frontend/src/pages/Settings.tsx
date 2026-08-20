import { useEffect, useState } from "react";
import { api, restartApi } from "../lib/api";
import { invalidateCatalog } from "../lib/catalog";
import { managerBase, setManagerBase } from "../lib/manager";
import { readQwenPrefs, resolveQwenEnabled, writeQwenPrefs } from "../lib/qwen-prefs";
import type { FeatureId, StationEngine } from "../lib/types";
import { FEATURE_LABELS } from "../lib/types";
import { Button, ErrorBox, Field, Input, Select } from "../components/ui";
import { PageHead } from "../components/PageHead";

const STATION_ROWS: FeatureId[] = ["image", "video", "music", "tts", "sfx", "voiceDesign", "model3d"];

function qwenConfigured(qwen?: { apiKey?: string; configured?: boolean }) {
  return Boolean(qwen?.configured || qwen?.apiKey);
}

export function Settings() {
  const [dataDir, setDataDir] = useState("");
  const [configDir, setConfigDir] = useState("");
  const [managerUrl, setManagerUrl] = useState(managerBase());
  const [qwenEnabled, setQwenEnabled] = useState(false);
  const [qwenKey, setQwenKey] = useState("");
  const [qwenWorkspace, setQwenWorkspace] = useState("");
  const [qwenBase, setQwenBase] = useState("https://dashscope.aliyuncs.com/api/v1");
  const [keyHint, setKeyHint] = useState("");
  const [keySaved, setKeySaved] = useState(false);
  const [engines, setEngines] = useState<Partial<Record<FeatureId, StationEngine>>>({});
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [mgrNote, setMgrNote] = useState("");
  const [qwenNote, setQwenNote] = useState("");
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
        qwen?: { enabled?: boolean; apiKey?: string; workspaceId?: string; baseUrl?: string; configured?: boolean };
        engines?: Record<string, StationEngine>;
      };
      setDataDir(s.dataDir || "");
      setConfigDir(s.configDir || "");
      if (s.managerUrl) {
        setManagerBase(s.managerUrl);
        setManagerUrl(s.managerUrl);
      }
      const saved = qwenConfigured(s.qwen);
      const enabled = resolveQwenEnabled(s.qwen);
      setQwenEnabled(enabled);
      setKeySaved(saved);
      setKeyHint(s.qwen?.apiKey || "");
      setQwenWorkspace(s.qwen?.workspaceId || prefs.workspaceId || "");
      if (s.qwen?.baseUrl) setQwenBase(s.qwen.baseUrl);
      else if (prefs.baseUrl) setQwenBase(prefs.baseUrl);
      setEngines({ ...(prefs.engines || {}), ...(s.engines || {}) });
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
      } else setQwenNote("千问 API Key 未配置，选千问云工位前请先填写");
    } catch {
      setQwenEnabled(Boolean(prefs.enabled));
      if (prefs.apiKey) {
        setQwenKey(prefs.apiKey);
        setQwenWorkspace(prefs.workspaceId || "");
        if (prefs.baseUrl) setQwenBase(prefs.baseUrl);
      }
      if (prefs.engines) setEngines(prefs.engines);
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

  return (
    <section className="mx-auto max-w-3xl px-8 py-10">
      <PageHead kicker="Settings" title="设置" desc="ComfyUI 始终可用。千问云默认关闭；开启后再把某工位默认工具设为千问云，该工位才会出现千问云标签。" />

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
      </div>

      <div className="mt-6 space-y-4 rounded-2xl border border-line bg-panel p-6">
        <h2 className="font-serif text-xl">ComfyUI · ComfyManager</h2>
        <p className="text-sm text-mute">{mgrNote}</p>
        <Field label="地址" hint="默认 http://127.0.0.1:18788">
          <Input value={managerUrl} onChange={(e) => setManagerUrl(e.target.value)} />
        </Field>
        <Field label="配置目录" hint="设置和千问 Key 固定写在这里，Windows / Linux 都是用户主目录下的 .visualforge，不会进 Git">
          <Input value={configDir} readOnly />
        </Field>
        <Field label="成品根目录" hint="本机保存生成结果。新安装默认与配置目录相同">
          <Input value={dataDir} onChange={(e) => setDataDir(e.target.value)} />
        </Field>
        <a className="inline-block text-sm text-brass underline" href={managerUrl || managerBase()} target="_blank" rel="noreferrer">
          打开 ComfyManager
        </a>
      </div>

      <div className="mt-6 space-y-4 rounded-2xl border border-qwen/40 bg-qwen/5 p-6">
        <h2 className="font-serif text-xl text-foam">千问云</h2>
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-qwen/30 bg-ink/40 px-4 py-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-qwen"
            checked={qwenEnabled}
            onChange={(e) => setQwenEnabled(e.target.checked)}
          />
          <span>
            <span className="block text-sm text-foam">开启千问云</span>
            <span className="mt-0.5 block text-xs text-mute">
              默认关闭。开启后，还要把下面「各工位默认工具」选成千问云，对应工位顶部才会出现千问云标签。
            </span>
          </span>
        </label>
        <p className="text-sm text-mute">
          {qwenNote || "平台 "}
          {" "}
          <a className="text-qwen underline" href="https://www.qianwenai.com/" target="_blank" rel="noreferrer">
            www.qianwenai.com
          </a>
          ，协议 DashScope。Key 写入本机 settings.json，不会进 ComfyManager。
        </p>
        {keySaved ? (
          <p className="rounded-lg border border-qwen/40 bg-qwen/10 px-3 py-2 text-sm text-foam">
            服务端已保存 Key{keyHint ? `（${keyHint}）` : ""}。密码框刷新后可以是空的，不等于没存上。
          </p>
        ) : null}
        <Field label="API Key" hint={keySaved ? "已写入生成服务；留空再保存不会覆盖" : "在官网申请，保存后写入本机 data/settings.json"}>
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
      </div>

      <div className="mt-6 space-y-4 rounded-2xl border border-line bg-panel p-6">
        <h2 className="font-serif text-xl">各工位默认工具</h2>
        <p className="text-sm text-mute">
          {qwenEnabled
            ? "把工位设为千问云并保存后，该工位顶部才会出现千问云标签。3D 动画仍只用 ComfyUI。"
            : "先开启上方的千问云，才能把工位默认工具设为千问云。未开启时各工位只走 ComfyUI。"}
        </p>
        <div className={`overflow-hidden rounded-xl border border-line ${qwenEnabled ? "" : "opacity-50"}`}>
          <table className="w-full text-left text-sm">
            <tbody>
              {STATION_ROWS.map((id) => (
                <tr key={id} className="border-t border-line first:border-0">
                  <td className="px-4 py-2.5">{FEATURE_LABELS[id]}</td>
                  <td className="px-4 py-2.5">
                    <Select
                      value={qwenEnabled ? (engines[id] || "comfyui") : "comfyui"}
                      disabled={!qwenEnabled}
                      onChange={(e) => setEngines((cur) => ({ ...cur, [id]: e.target.value as StationEngine }))}
                    >
                      <option value="comfyui">ComfyUI（本机）</option>
                      {qwenEnabled ? <option value="qwen">千问云</option> : null}
                    </Select>
                  </td>
                </tr>
              ))}
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
              const qwenPatch: Record<string, string | boolean> = {
                enabled: qwenEnabled,
                workspaceId: qwenWorkspace,
                baseUrl: qwenBase,
              };
              if (key) qwenPatch.apiKey = key;
              writeQwenPrefs({
                enabled: qwenEnabled,
                apiKey: key || readQwenPrefs().apiKey,
                workspaceId: qwenWorkspace,
                baseUrl: qwenBase,
                engines,
              });
              const saved = await api.saveSettings({
                dataDir,
                managerUrl,
                qwen: qwenPatch,
                engines: qwenEnabled ? engines : undefined,
              });
              const qwen = saved.settings?.qwen as { apiKey?: string; configured?: boolean } | undefined;
              if (key && !qwenConfigured(qwen)) {
                throw new Error("生成服务没有接下千问 API Key。请确认 18787 已启动，再到设置页保存一次。");
              }
              setOk(qwenConfigured(qwen) ? "已保存，千问 Key 已写入生成服务" : "已保存");
              setQwenEnabled(qwenEnabled);
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
