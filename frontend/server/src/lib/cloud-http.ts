export class CloudError extends Error {
  status: number;
  code?: string;
  raw?: unknown;
  constructor(message: string, status = 500, code?: string, raw?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.raw = raw;
  }
}

export async function cloudJson(
  url: string,
  init: RequestInit,
  label: string,
): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new CloudError(`${label} 网络失败：${msg}`, 502, "NETWORK");
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  if (text.trim()) {
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new CloudError(
        `${label} HTTP ${res.status}，返回了非 JSON：${text.slice(0, 400)}`,
        res.status || 502,
        "NON_JSON",
        { status: res.status, body: text.slice(0, 800) },
      );
    }
  }
  if (!res.ok) {
    const message =
      String(json.message || json.error || json.msg || "").trim() ||
      (typeof json.task_error === "object" && json.task_error
        ? String((json.task_error as { message?: string }).message || "")
        : "") ||
      text.slice(0, 400) ||
      `HTTP ${res.status}`;
    throw new CloudError(`${label} HTTP ${res.status}：${message}`, res.status || 502, String(json.code || res.status), json);
  }
  return json;
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}
