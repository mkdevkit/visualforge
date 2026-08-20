import type { StationEngine } from "../lib/types";

export function EngineSwitch({
  value,
  onChange,
  showQwen = false,
}: {
  value: StationEngine;
  onChange: (next: StationEngine) => void;
  showQwen?: boolean;
}) {
  return (
    <div className={`mb-8 grid gap-3 ${showQwen ? "sm:grid-cols-2" : ""}`}>
      <button
        type="button"
        onClick={() => onChange("comfyui")}
        className={`rounded-2xl border px-4 py-4 text-left transition ${
          value === "comfyui"
            ? "border-brass bg-brass/15 shadow-[0_0_0_1px_rgba(212,165,116,0.35)]"
            : "border-line bg-panel/60 hover:border-brass/40"
        }`}
      >
        <div className="text-[11px] tracking-[0.18em] uppercase text-brass">本机工具</div>
        <div className="mt-1 font-serif text-xl text-foam">ComfyUI</div>
        <p className="mt-1 text-xs leading-relaxed text-mute">工作流 + ComfyManager 权重，不经过云端。</p>
      </button>
      {showQwen ? (
        <button
          type="button"
          onClick={() => onChange("qwen")}
          className={`rounded-2xl border px-4 py-4 text-left transition ${
            value === "qwen"
              ? "border-qwen bg-qwen/15 shadow-[0_0_0_1px_rgba(94,200,216,0.4)]"
              : "border-line bg-panel/60 hover:border-qwen/40"
          }`}
        >
          <div className="text-[11px] tracking-[0.18em] uppercase text-qwen">云端工具</div>
          <div className="mt-1 font-serif text-xl text-foam">千问云</div>
          <p className="mt-1 text-xs leading-relaxed text-mute">
            <a className="text-qwen underline" href="https://www.qianwenai.com/" target="_blank" rel="noreferrer">
              qianwenai.com
            </a>
            {" · "}DashScope 模型，无需工作流。
          </p>
        </button>
      ) : null}
    </div>
  );
}
