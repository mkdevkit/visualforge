export async function pingComfy(baseUrl?: string) {
  const base = (baseUrl || "").replace(/\/+$/, "");
  if (!base) return { ok: false, baseUrl: "", error: "未配置地址" };
  try {
    const res = await fetch(`${base}/system_stats`);
    const text = await res.text();
    let json: unknown = text;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = text;
    }
    if (!res.ok) return { ok: false, baseUrl: base, error: `HTTP ${res.status}` };
    return { ok: true, baseUrl: base, status: res.status, stats: json };
  } catch (err) {
    return { ok: false, baseUrl: base, error: err instanceof Error ? err.message : String(err) };
  }
}
