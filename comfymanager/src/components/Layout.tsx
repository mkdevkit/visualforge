import { NavLink, Outlet } from "react-router-dom";

const items = [
  { to: "/overview", label: "概览", kicker: "ComfyUI" },
  { to: "/models", label: "模型", kicker: "Weights" },
  { to: "/workflows", label: "工作流", kicker: "Studios" },
  { to: "/settings", label: "设置", kicker: "Settings" },
];

export function Layout() {
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-line bg-ink-2/90 px-4 py-6">
        <div className="px-2">
          <div className="font-serif text-2xl tracking-wide text-foam">ComfyManager</div>
          <div className="mt-1 text-[11px] tracking-[0.2em] uppercase text-brass">部署 · 模型 · 接口</div>
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
        <p className="px-2 text-[11px] leading-relaxed text-mute/80">视铸只配本工具地址，模型与工作流都从这里的 API 读取。</p>
      </aside>
      <main className="forge-scroll min-w-0 flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
