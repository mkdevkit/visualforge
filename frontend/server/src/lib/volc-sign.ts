import { createHash, createHmac } from "node:crypto";

function sha256Hex(content: string) {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function hmac(key: string | Buffer, content: string) {
  return createHmac("sha256", key).update(content, "utf8").digest();
}

function canonicalQuery(query: Record<string, string>) {
  return Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join("&");
}

export async function volcOpenApi(opts: {
  action: string;
  version?: string;
  service?: string;
  region?: string;
  accessKeyId: string;
  secretKey: string;
  body: Record<string, unknown>;
}): Promise<Record<string, unknown>> {
  const host = "open.volcengineapi.com";
  const service = opts.service || "imagination";
  const region = opts.region || "cn-beijing";
  const version = opts.version || "2024-08-12";
  const query = { Action: opts.action, Version: version };
  const body = JSON.stringify(opts.body);
  const payloadHash = sha256Hex(body);
  const now = new Date();
  const xDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const shortDate = xDate.slice(0, 8);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Host: host,
    "X-Date": xDate,
    "X-Content-Sha256": payloadHash,
  };
  const signedHeaderKeys = ["content-type", "host", "x-content-sha256", "x-date"];
  const canonicalHeaders = `${signedHeaderKeys.map((k) => {
    const found = Object.keys(headers).find((h) => h.toLowerCase() === k) || k;
    return `${k}:${headers[found].trim()}`;
  }).join("\n")}\n`;
  const canonicalRequest = [
    "POST",
    "/",
    canonicalQuery(query),
    canonicalHeaders,
    signedHeaderKeys.join(";"),
    payloadHash,
  ].join("\n");
  const credentialScope = `${shortDate}/${region}/${service}/request`;
  const stringToSign = ["HMAC-SHA256", xDate, credentialScope, sha256Hex(canonicalRequest)].join("\n");
  const kDate = hmac(opts.secretKey, shortDate);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "request");
  const signature = createHmac("sha256", kSigning).update(stringToSign, "utf8").digest("hex");
  headers.Authorization = `HMAC-SHA256 Credential=${opts.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaderKeys.join(";")}, Signature=${signature}`;
  const url = `https://${host}/?${canonicalQuery(query)}`;
  const res = await fetch(url, { method: "POST", headers, body });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch {
    throw new Error(`火山引擎 OpenAPI 返回了非 JSON：${text.slice(0, 400)}`);
  }
  const meta = (json.ResponseMetadata || {}) as { Error?: { Message?: string; Code?: string } };
  if (!res.ok || meta.Error || (json.Code !== undefined && json.Code !== 0 && json.Code !== "0")) {
    const msg = meta.Error?.Message || String(json.Message || json.error || text.slice(0, 400) || `HTTP ${res.status}`);
    throw new Error(`火山引擎 ${opts.action}：${msg}`);
  }
  return json;
}
