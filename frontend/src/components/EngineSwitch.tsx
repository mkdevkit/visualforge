import type { ProviderId } from "../lib/types";
import { PROVIDERS, providerKickerClass, providerToneClass } from "../lib/providers";

export function EngineSwitch({
  value,
  onChange,
  providers,
}: {
  value: ProviderId;
  onChange: (next: ProviderId) => void;
  providers: ProviderId[];
}) {
  const list = PROVIDERS.filter((p) => providers.includes(p.id));
  if (!list.length) return null;
  return (
    <div className={`mb-8 grid gap-3 ${list.length > 1 ? "sm:grid-cols-2" : ""}`}>
      {list.map((p) => {
        const active = value === p.id;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onChange(p.id)}
            className={`rounded-2xl border px-4 py-4 text-left transition ${providerToneClass(p.tone, active)}`}
          >
            <div className={`text-[11px] tracking-[0.18em] uppercase ${providerKickerClass(p.tone)}`}>{p.kicker}</div>
            <div className="mt-1 font-serif text-xl text-foam">{p.label}</div>
            <p className="mt-1 text-xs leading-relaxed text-mute">
              {p.docsUrl ? (
                <>
                  <a className={`${providerKickerClass(p.tone)} underline`} href={p.docsUrl} target="_blank" rel="noreferrer">
                    {p.docsUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  </a>
                  {" · "}
                  {p.description}
                </>
              ) : (
                p.description
              )}
            </p>
          </button>
        );
      })}
    </div>
  );
}
