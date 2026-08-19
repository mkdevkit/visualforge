import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import { Button, ErrorBox, Select } from "../components/ui";
import { PageHead } from "../components/PageHead";

const FEATURES: { id: string; label: string }[] = [
  { id: "image", label: "生图" },
  { id: "video", label: "生视频" },
  { id: "music", label: "生音乐" },
  { id: "tts", label: "配音" },
  { id: "sfx", label: "音效" },
  { id: "voiceDesign", label: "音色设计" },
  { id: "model3d", label: "生 3D" },
  { id: "anim3d", label: "3D 动画" },
];

const PRIMARY_FOLDERS = new Set(["checkpoints", "diffusion_models", "unet", "tts"]);

function isPrimary(m: { id: string; name: string; filename: string; folder: string }) {
  if (!PRIMARY_FOLDERS.has(m.folder)) return false;
  return !/tokenizer|vae|encoder|clip.vision|lightning/i.test(`${m.id} ${m.name} ${m.filename}`);
}

function sizeText(n?: number) {
  if (!n) return "";
  if (n > 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n > 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}

type OpenModel = {
  id: string;
  name: string;
  family: string;
  description: string;
  folder: string;
  filename: string;
  sizeBytes?: number;
  features: string[];
  license?: string;
  installed?: boolean;
};

export function Models() {
  const [models, setModels] = useState<OpenModel[]>([]);
  const [jobs, setJobs] = useState<Array<{ modelId: string; status: string; progress: number; error?: string }>>([]);
  const [active, setActive] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [catalogFile, setCatalogFile] = useState("");

  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const refresh = async () => {
    const [m, d] = await Promise.all([api.models(), api.downloads().catch(() => ({ jobs: [] }))]);
    setModels((m.openModels || []) as OpenModel[]);
    setCatalogFile(String(m.catalogFile || ""));
    setActive(m.activeModels || {});
    setJobs((d.jobs || []) as typeof jobs);
  };

  useEffect(() => {
    refresh().catch((e) => setError(e.message));
    const t = setInterval(() => {
      api.downloads()
        .then(async (r) => {
          const next = (r.jobs || []) as typeof jobs;
          const prevRunning = new Set(
            jobsRef.current.filter((j) => j.status === "running" || j.status === "queued").map((j) => j.id),
          );
          const finished = next.some((j) => prevRunning.has(j.id) && j.status !== "running" && j.status !== "queued");
          setJobs(next);
          if (finished) await refresh();
        })
        .catch(() => undefined);
    }, 1000);
    return () => clearInterval(t);
  }, []);

  const running = (id: string) => jobs.find((j) => j.modelId === id && (j.status === "running" || j.status === "queued"));

  return (
    <section className="mx-auto max-w-5xl px-8 py-10">
      <PageHead kicker="Weights" title="开源模型" desc="仅列出可商用权重（Apache-2.0 / MIT）。下载后可在本页或「工作流」页指定各工位当前生效模型。" />

      <div className="mb-8 grid gap-3 rounded-2xl border border-line bg-panel p-5 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.id} className="text-sm">
            <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-brass">{f.label}</div>
            <Select
              value={active[f.id] || ""}
              onChange={async (e) => {
                const next = { ...active, [f.id]: e.target.value };
                setActive(next);
                try {
                  await api.saveActive(next);
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
            >
              <option value="">未指定</option>
              {models.filter((m) => m.features.includes(f.id) && m.installed && isPrimary(m)).map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </div>
        ))}
      </div>

      <p className="mb-4 text-xs text-mute">目录：{catalogFile}</p>
      <ErrorBox error={error} />
      <div className="space-y-3">
        {models.map((m) => {
          const job = running(m.id);
          return (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-panel px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="text-foam">{m.name}</div>
                <div className="mt-1 text-xs text-mute">
                  {m.family} · {m.license || "许可未标"} · {m.folder}/{m.filename} · {sizeText(m.sizeBytes)} · {m.features.join(" / ")}
                </div>
                <p className="mt-1 text-xs text-mute">{m.description}</p>
                {job ? (
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-2">
                    <div className="h-full bg-ember" style={{ width: `${job.progress}%` }} />
                  </div>
                ) : null}
                {job?.error ? <div className="mt-1 text-xs text-red-300">{job.error}</div> : null}
              </div>
              {m.installed ? (
                <Button
                  tone="danger"
                  onClick={async () => {
                    if (!confirm(`删除 ${m.filename}？`)) return;
                    setError("");
                    try {
                      await api.remove(m.id);
                      await refresh();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  删除
                </Button>
              ) : (
                <Button
                  tone="ghost"
                  disabled={!!job}
                  onClick={async () => {
                    setError("");
                    try {
                      await api.download(m.id);
                      await refresh();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                >
                  {job ? `${job.progress}%` : "下载"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
