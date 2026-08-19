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
  const prereqs = (status?.prereqs || {}) as {
    os?: { label?: string };
    git?: { ok?: boolean; version?: string; hint?: string };
    python?: { ok?: boolean; version?: string; executable?: string; hint?: string };
  };

  return (
    <section className="mx-auto max-w-3xl px-8 py-10">
      <PageHead kicker="ComfyUI" title="部署与接口" desc="支持 Windows 与 Ubuntu。Git、Python 3.10+ 请自行安装并加入 PATH。本工具会建虚拟环境并安装 CUDA 版 PyTorch。" />
      <div className="space-y-3 rounded-2xl border border-line bg-panel p-6 text-sm">
        <div>
          安装：{status?.installed
            ? status?.reusedExisting
              ? "已就绪（使用本机已有 ComfyUI）"
              : "已就绪"
            : Array.isArray(status?.existingInstalls) && (status.existingInstalls as string[]).length
              ? "发现本机已有 ComfyUI"
              : "未安装"}
        </div>
        <div className="break-all">目录：{String(status?.installDir || "")}</div>
        <div className="break-all">模型目录：{String(status?.modelsDir || "")}</div>
        {Array.isArray(status?.existingInstalls) && (status.existingInstalls as string[]).length ? (
          <div className="break-all text-xs text-mute">
            已发现：{(status.existingInstalls as string[]).join("；")}
          </div>
        ) : null}
        <div>系统：{prereqs.os?.label || ""}</div>
        <div>Git：{prereqs.git?.ok ? prereqs.git.version || "已就绪" : prereqs.git?.hint || "未检测到（请自行安装）"}</div>
        <div className="break-all">
          Python：{prereqs.python?.ok
            ? `${prereqs.python.version} · ${prereqs.python.executable}`
            : prereqs.python?.hint || "未检测到（请自行安装 3.10+）"}
        </div>
        <div>加速：{String((status?.accel as { label?: string } | undefined)?.label || "检测中")}</div>
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
          {busy === "install"
            ? "安装依赖中（含 CUDA PyTorch，可能要几分钟）…"
            : status?.installed
              ? "同步模型路径 / CUDA 依赖"
              : Array.isArray(status?.existingInstalls) && (status.existingInstalls as string[]).length
                ? "使用已有安装"
                : "安装 ComfyUI（含 CUDA）"}
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
