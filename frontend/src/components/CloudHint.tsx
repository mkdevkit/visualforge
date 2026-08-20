import { useSettings } from "../lib/settings";
import type { ProviderId } from "../lib/types";
import { providerById, providerKickerClass } from "../lib/providers";
import { QwenHint } from "./QwenHint";

export function CloudHint({ provider, extra, error }: { provider: ProviderId; extra?: string; error?: string }) {
  if (provider === "qwen") return <QwenHint extra={extra} error={error} />;
  const p = providerById(provider);
  const settings = useSettings();
  const cfg =
    provider === "meshy" ? settings?.meshy
    : provider === "midjourney" ? settings?.midjourney
    : provider === "tripo" ? settings?.tripo
    : provider === "volcengine" ? settings?.volcengine
    : undefined;
  const view = cfg as { configured?: boolean; apiKey?: string; musicConfigured?: boolean } | undefined;
  const hasKey = Boolean(view?.configured || view?.apiKey);
  const tone = p?.tone || "cloud";
  const kicker = providerKickerClass(tone);
  const border = tone === "cloud" ? "border-cloud/50 bg-cloud/10" : "border-qwen/50 bg-qwen/10";
  return (
    <div className={`rounded-xl border px-3 py-3 text-xs leading-relaxed ${border}`}>
      <div className={`text-[11px] tracking-[0.16em] uppercase ${kicker}`}>引擎</div>
      <div className="mt-1 font-serif text-lg text-foam">{p?.label || provider}</div>
      <p className="mt-1 text-mute">
        {p?.docsUrl ? (
          <>
            平台{" "}
            <a className={`${kicker} underline`} href={p.docsUrl} target="_blank" rel="noreferrer">
              {p.docsUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
            </a>
            。不经过 ComfyUI，也没有工作流。
          </>
        ) : (
          p?.description
        )}
      </p>
      {provider === "midjourney" ? (
        <p className="mt-1 text-mute">
          官方没有公开 API。未填写兼容网关时无法出图，视铸也不会走 Discord 或非官方爬站。
        </p>
      ) : null}
      {provider === "volcengine" ? (
        <p className="mt-1 text-mute">
          生图 / 生视频用方舟 API Key。生音乐另需账号 Access Key ID / Secret，不是同一把钥匙。
        </p>
      ) : null}
      {provider === "volcengine" ? (
        <>
          {hasKey ? (
            <p className="mt-1 text-mute">方舟 API Key 已配置。</p>
          ) : (
            <p className="mt-1 text-red-300">还没有方舟 API Key。请到设置页填写，或在 https://console.volcengine.com/ark 申请。</p>
          )}
          {view?.musicConfigured ? (
            <p className="mt-1 text-mute">生音乐 Access Key 已配置。</p>
          ) : (
            <p className="mt-1 text-mute">未配置 Access Key 时不能生音乐。</p>
          )}
        </>
      ) : hasKey ? (
        <p className="mt-1 text-mute">API Key 已配置。</p>
      ) : (
        <p className="mt-1 text-red-300">还没有 API Key。请到设置页填写，或在官网申请。</p>
      )}
      {error ? <p className="mt-1 text-red-300">{error}</p> : null}
      {extra ? <p className="mt-1 text-mute">{extra}</p> : null}
    </div>
  );
}
