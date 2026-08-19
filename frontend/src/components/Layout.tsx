import { NavLink, Outlet } from "react-router-dom";

const items = [
  { to: "/image", label: "生图", kicker: "Image" },
  { to: "/video", label: "生视频", kicker: "Video" },
  { to: "/music", label: "生音乐", kicker: "Music" },
  { to: "/audio", label: "音频", kicker: "Voice / SFX" },
  { to: "/3d", label: "生 3D", kicker: "3D" },
  { to: "/library", label: "资源库", kicker: "Library" },
  { to: "/api", label: "本地 API", kicker: "Open API" },
  { to: "/settings", label: "设置", kicker: "Settings" },
];

export function Layout() {
  return (
    <div className="grain flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-line bg-ink-2/90 px-4 py-6">
        <div className="px-2">
          <div className="font-serif text-2xl tracking-wide text-foam">视铸</div>
          <div className="mt-1 text-[11px] tracking-[0.28em] uppercase text-brass">VisualForge</div>
        </div>
        <nav className="mt-8 flex flex-1 flex-col gap-1">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `rounded-xl px-3 py-2.5 transition ${isActive ? "bg-panel text-foam" : "text-mute hover:bg-panel/50 hover:text-foam"}`
              }
            >
              <div className="text-sm">{item.label}</div>
              <div className="text-[10px] tracking-[0.16em] uppercase opacity-70">{item.kicker}</div>
            </NavLink>
          ))}
        </nav>
        <p className="px-2 text-[11px] leading-relaxed text-mute/80">生成工坊 · ComfyUI 由 ComfyManager 管理</p>
      </aside>
      <main className="forge-scroll min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
