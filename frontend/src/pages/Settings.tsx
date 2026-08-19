import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { invalidateCatalog } from "../lib/catalog";
import { managerBase, setManagerBase } from "../lib/manager";
import { Button, ErrorBox, Field, Input } from "../components/ui";
import { PageHead } from "../components/PageHead";

export function Settings() {
  const [dataDir, setDataDir] = useState("");
  const [managerUrl, setManagerUrl] = useState(managerBase());
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [mgrNote, setMgrNote] = useState("");

  const refresh = () => {
    api.settings().then((r) => {
      const s = r.settings as { dataDir?: string; managerUrl?: string };
      setDataDir(s.dataDir || "");
      if (s.managerUrl) {
        setManagerBase(s.managerUrl);
        setManagerUrl(s.managerUrl);
      }
    }).catch(() => undefined);
    api.health().then((h) => {
      if (!h.engine) {
        setError("18787 上还是旧版生成服务。工位模型已改从 ComfyManager 读取；请关掉占用该端口的旧进程后重新 npm run dev，否则无法真正生成。");
      }
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
    }).catch(() => undefined);
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <section className="mx-auto max-w-3xl px-8 py-10">
      <PageHead kicker="Settings" title="设置" desc="视铸只需要 ComfyManager 地址。模型选项和工作流都从管理端接口读取。" />

      <div className="space-y-4 rounded-2xl border border-line bg-panel p-6">
        <h2 className="font-serif text-xl">ComfyManager</h2>
        <p className="text-sm text-mute">{mgrNote}</p>
        <Field label="地址" hint="默认 http://127.0.0.1:18788">
          <Input value={managerUrl} onChange={(e) => setManagerUrl(e.target.value)} />
        </Field>
        <Field label="成品根目录" hint="本机保存生成结果，与 Comfy 无关">
          <Input value={dataDir} onChange={(e) => setDataDir(e.target.value)} />
        </Field>
        <a className="inline-block text-sm text-brass underline" href={managerUrl || managerBase()} target="_blank" rel="noreferrer">
          打开 ComfyManager
        </a>
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
              await api.saveSettings({ dataDir, managerUrl });
              setOk("已保存");
              refresh();
            } catch (e) {
              setOk("已记下 ComfyManager 地址。模型列表会从管理端读取；生成本地服务未连上。");
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
