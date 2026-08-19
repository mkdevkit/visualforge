import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createVisualForgeMcp } from "./mcp.js";
import { loadSettings } from "./config.js";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, mcp-session-id, mcp-protocol-version, Last-Event-ID",
  "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version",
};

export function isMcpPath(url?: string) {
  const path = (url || "").split("?")[0];
  return path === "/mcp" || path.startsWith("/mcp/");
}

async function readJsonBody(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return undefined;
  return JSON.parse(raw) as unknown;
}

function writeJson(res: ServerResponse, status: number, body: unknown) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json", ...CORS });
  res.end(JSON.stringify(body));
}

export async function handleMcpHttp(req: IncomingMessage, res: ServerResponse) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  if (req.method !== "POST") {
    writeJson(res, 405, {
      jsonrpc: "2.0",
      error: { code: -32000, message: "视铸 MCP 使用 Streamable HTTP，请 POST /mcp" },
      id: null,
    });
    return;
  }

  const s = loadSettings();
  const server = createVisualForgeMcp();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    enableDnsRebindingProtection: true,
    allowedHosts: [
      "127.0.0.1",
      "localhost",
      "[::1]",
      `${s.host}:${s.port}`,
      `127.0.0.1:${s.port}`,
      `localhost:${s.port}`,
      `[::1]:${s.port}`,
    ],
  });

  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    const body = await readJsonBody(req);
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    console.error("[mcp]", err);
    writeJson(res, 500, {
      jsonrpc: "2.0",
      error: { code: -32603, message: err instanceof Error ? err.message : "MCP 内部错误" },
      id: null,
    });
    void transport.close();
    void server.close();
  }
}
