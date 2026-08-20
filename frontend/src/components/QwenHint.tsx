import { useSettings } from "../lib/settings";

export function QwenHint({ extra, error }: { extra?: string; error?: string }) {
  const settings = useSettings();
  const hasKey = Boolean(settings?.qwen?.apiKey);
  return (
    <div className="rounded-xl border border-qwen/50 bg-qwen/10 px-3 py-3 text-xs leading-relaxed">
      <div className="text-[11px] tracking-[0.16em] uppercase text-qwen">引擎</div>
      <div className="mt-1 font-serif text-lg text-foam">千问云</div>
      <p className="mt-1 text-mute">
        平台{" "}
        <a className="text-qwen underline" href="https://www.qianwenai.com/" target="_blank" rel="noreferrer">
          qianwenai.com
        </a>
        ，协议 DashScope。不经过 ComfyUI，也没有工作流。
      </p>
      {hasKey ? (
        <p className="mt-1 text-mute">API Key 已配置。</p>
      ) : (
        <p className="mt-1 text-red-300">还没有 API Key。请到设置页填写，或在官网申请。</p>
      )}
      {error ? <p className="mt-1 text-red-300">{error}</p> : null}
      {extra ? <p className="mt-1 text-mute">{extra}</p> : null}
    </div>
  );
}
