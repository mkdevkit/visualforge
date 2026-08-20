export function PageHead({
  kicker,
  title,
  desc,
  tone = "comfy",
}: {
  kicker: string;
  title: string;
  desc: string;
  tone?: "comfy" | "qwen" | "cloud";
}) {
  const kickerClass = tone === "qwen" ? "text-qwen" : tone === "cloud" ? "text-cloud" : "text-brass";
  return (
    <header className="mb-8">
      <div className={`text-[11px] tracking-[0.28em] uppercase ${kickerClass}`}>{kicker}</div>
      <h1 className="mt-2 font-serif text-4xl">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mute">{desc}</p>
    </header>
  );
}
