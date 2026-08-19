import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Button, ErrorBox, Field, Input } from "../components/ui";
import { PageHead } from "../components/PageHead";

export function Settings() {
  const [comfy, setComfy] = useState({
    baseUrl: "http://127.0.0.1:8188",
    apiKey: "",
    installDir: "",
    pythonPath: "",
    extraArgs: "",
    listenHost: "127.0.0.1",
    listenPort: 8188,
    modelsDir: "",
    hfToken: "",
  });
  const [dataDir, setDataDir] = useState("");
  const [masked, setMasked] = useState({ apiKey: "", hfToken: "" });
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");
  const [ping, setPing] = useState("");

  const refresh = () => {
    api.settings().then((r) => {
      const s = r.settings as {
        dataDir?: string;
        comfy?: typeof comfy;
      };
      setDataDir(s.dataDir || "");
      setComfy({
        baseUrl: s.comfy?.baseUrl || "http://127.0.0.1:8188",
        apiKey: "",
        installDir: s.comfy?.installDir || "",
        pythonPath: s.comfy?.pythonPath || "",
        extraArgs: s.comfy?.extraArgs || "",
        listenHost: s.comfy?.listenHost || "127.0.0.1",
        listenPort: s.comfy?.listenPort || 8188,
        modelsDir: s.comfy?.modelsDir || "",
        hfToken: "",
      });
      setMasked({ apiKey: s.comfy?.apiKey || "", hfToken: s.comfy?.hfToken || "" });
    }).catch((e) => setError(e.message));
  };

  useEffect(() => {
    refresh();
  }, []);

  return (
    <section className="mx-auto max-w-3xl px-8 py-10">
      <PageHead kicker="Settings" title="设置" desc="ComfyUI 安装路径、监听接口、Hugging Face Token。" />
      <div className="space-y-4 rounded-2xl border border-line bg-panel p-6">
        <Field label="ComfyUI 接口地址">
          <Input value={comfy.baseUrl} onChange={(e) => setComfy({ ...comfy, baseUrl: e.target.value })} />
        </Field>
        <Field label="访问令牌" hint={masked.apiKey ? `当前 ${masked.apiKey}` : "可选"}>
          <Input type="password" value={comfy.apiKey} onChange={(e) => setComfy({ ...comfy, apiKey: e.target.value })} />
        </Field>
        <Field label="Hugging Face Token" hint={masked.hfToken ? `当前 ${masked.hfToken}` : "下载门禁模型需要"}>
          <Input type="password" value={comfy.hfToken} onChange={(e) => setComfy({ ...comfy, hfToken: e.target.value })} />
        </Field>
        <Field label="安装目录" hint="默认 comfymanager/comfy">
          <Input value={comfy.installDir} onChange={(e) => setComfy({ ...comfy, installDir: e.target.value })} />
        </Field>
        <Field label="模型目录" hint="默认 comfymanager/models">
          <Input value={comfy.modelsDir} onChange={(e) => setComfy({ ...comfy, modelsDir: e.target.value })} />
        </Field>
        <Field label="Python 路径">
          <Input value={comfy.pythonPath} onChange={(e) => setComfy({ ...comfy, pythonPath: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="监听地址">
            <Input value={comfy.listenHost} onChange={(e) => setComfy({ ...comfy, listenHost: e.target.value })} />
          </Field>
          <Field label="端口">
            <Input type="number" value={comfy.listenPort} onChange={(e) => setComfy({ ...comfy, listenPort: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label="启动附加参数">
          <Input value={comfy.extraArgs} onChange={(e) => setComfy({ ...comfy, extraArgs: e.target.value })} />
        </Field>
        <Field label="ComfyManager 数据目录">
          <Input value={dataDir} onChange={(e) => setDataDir(e.target.value)} />
        </Field>
        <div className="flex items-center gap-3">
          <Button
            tone="ghost"
            onClick={async () => {
              setPing("");
              try {
                const r = await api.ping(comfy.baseUrl);
                setPing(r.ok ? `已连通 ${r.baseUrl}` : `未连通：${r.error}`);
              } catch (e) {
                setPing(e instanceof Error ? e.message : String(e));
              }
            }}
          >
            探测接口
          </Button>
          {ping ? <span className="text-sm text-mute">{ping}</span> : null}
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
              const { apiKey, hfToken, ...rest } = comfy;
              await api.saveSettings({
                dataDir,
                comfy: {
                  ...rest,
                  ...(apiKey ? { apiKey } : {}),
                  ...(hfToken ? { hfToken } : {}),
                },
              });
              setOk("已保存");
              refresh();
            } catch (e) {
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
