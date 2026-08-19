import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button, ErrorBox } from "../components/ui";
import { PageHead } from "../components/PageHead";

export function Overview() {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const refresh = () => api.status().then(setStatus).catch((e) => setError(e.message));

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  const apiInfo = (status?.api as { ok?: boolean; error?: string; baseUrl?: string }) || {};
  const unirig = (status?.unirig as { installed?: boolean; dir?: string }) || {};

  return (
    <section className="mx-auto max-w-3xl px-8 py-10">
      <PageHead kicker="ComfyUI" title="部署与接口" desc="安装、启动本机 ComfyUI，以及可选的 UniRig 自动绑骨仓库。生成工具通过本服务的 API 读取接口地址与当前模型。" />
      <div className="space-y-3 rounded-2xl border border-line bg-panel p-6 text-sm">
        <div>安装：{status?.installed ? "已就绪" : "未安装"}</div>
        <div>目录：{String(status?.installDir || "")}</div>
        <div>模型目录：{String(status?.modelsDir || "")}</div>
        <div>进程：{status?.processRunning ? `运行中 PID ${status.pid}` : "未启动"}</div>
        <div>接口：{String(status?.baseUrl || "")} · {apiInfo.ok ? "已连通" : apiInfo.error || "未连通"}</div>
      </div>
      <ErrorBox error={error} />
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          disabled={!!busy}
          onClick={async () => {
            setBusy("install");
            setError("");
            try {
              await api.install();
              await refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy("");
            }
          }}
        >
          {busy === "install" ? "安装中…" : "安装 / 更新依赖"}
        </Button>
        <Button
          tone="ghost"
          disabled={!!busy}
          onClick={async () => {
            setBusy("start");
            setError("");
            try {
              await api.start();
              await refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy("");
            }
          }}
        >
          启动
        </Button>
        <Button
          tone="ghost"
          disabled={!!busy}
          onClick={async () => {
            setBusy("stop");
            try {
              await api.stop();
              await refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy("");
            }
          }}
        >
          停止
        </Button>
      </div>

      <div className="mt-8 space-y-3 rounded-2xl border border-line bg-panel p-6 text-sm">
        <div className="text-[11px] tracking-[0.18em] uppercase text-brass">UniRig 自动绑骨</div>
        <div>仓库：{unirig.installed ? "已克隆" : "未安装"}</div>
        <div className="break-all text-xs text-mute">目录：{unirig.dir || "comfymanager/tools/UniRig"}</div>
        <p className="text-xs leading-relaxed text-mute">
          MIT 开源自动骨骼 + 蒙皮。此处只克隆官方仓库；Python 3.11 / PyTorch 等请按
          {" "}
          <a className="text-brass underline" href="https://github.com/VAST-AI-Research/UniRig" target="_blank" rel="noreferrer">
            UniRig README
          </a>
          {" "}
          自行安装，并用 UNIRIG_PYTHON 指向该解释器。视铸绑骨会调用
          {" "}
          <code className="text-foam">POST /api/tools/unirig/run</code>
          ，由本进程拉起 Python 子进程，不经过 ComfyUI。
        </p>
        <Button
          tone="ghost"
          disabled={!!busy}
          onClick={async () => {
            setBusy("unirig");
            setError("");
            try {
              await api.installUniRig();
              await refresh();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy("");
            }
          }}
        >
          {busy === "unirig" ? "克隆中…" : unirig.installed ? "已安装 UniRig" : "安装 UniRig"}
        </Button>
      </div>
    </section>
  );
}
