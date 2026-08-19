import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button, ErrorBox } from "../components/ui";
import { PageHead } from "../components/PageHead";

export function Models() {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null);
  const [managerUrl, setManagerUrl] = useState("http://127.0.0.1:18788");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    api.settings().then((r) => {
      const url = String((r.settings as { managerUrl?: string }).managerUrl || "http://127.0.0.1:18788");
      setManagerUrl(url);
    }).catch(() => undefined);
    api.health()
      .then((h) => {
        const mgr = h.manager as { ok?: boolean; comfy?: Record<string, unknown>; error?: string } | undefined;
        if (mgr?.comfy) setStatus(mgr.comfy);
        else {
          setError(mgr?.error || "ComfyManager 未连接");
          setNote("请先启动 ComfyManager：npm run manager");
        }
      })
      .catch((e) => {
        setError(e.message);
        setNote("请先启动 ComfyManager：npm run manager");
      });
  }, []);

  const connected = Boolean((status as { connected?: boolean } | null)?.connected);

  return (
    <section className="mx-auto max-w-3xl px-8 py-10">
      <PageHead
        kicker="ComfyManager"
        title="模型与部署"
        desc="安装、下载模型、各工位工作流都在 ComfyManager。视铸只通过它的 API 拉选项。"
      />
      <ErrorBox error={error} />
      {note ? <p className="mb-4 text-sm text-mute">{note}</p> : null}
      {status ? (
        <div className="mb-6 space-y-2 rounded-2xl border border-line bg-panel p-6 text-sm">
          <div>进程：{status.processRunning ? "运行中" : "未启动"}</div>
          <div>接口：{connected ? "已连通" : "未连通"}</div>
        </div>
      ) : null}
      <a href={managerUrl} target="_blank" rel="noreferrer">
        <Button>打开 ComfyManager</Button>
      </a>
    </section>
  );
}
