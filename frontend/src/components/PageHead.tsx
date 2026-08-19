export function PageHead({ kicker, title, desc }: { kicker: string; title: string; desc: string }) {
  return (
    <header className="mb-8">
      <div className="text-[11px] tracking-[0.28em] uppercase text-brass">{kicker}</div>
      <h1 className="mt-2 font-serif text-4xl">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-mute">{desc}</p>
    </header>
  );
}
