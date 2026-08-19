import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { getRequestListener } from "@hono/node-server";
import { app } from "./src/api/app.ts";
import { ensureLayout, loadSettings } from "./src/api/config.ts";

function apiPlugin(): Plugin {
  return {
    name: "comfymanager-api",
    configureServer(server) {
      const s = loadSettings();
      ensureLayout(s.dataDir, s.comfy.modelsDir);
      const listener = getRequestListener(app.fetch);
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api")) return next();
        try {
          await listener(req, res);
        } catch (err) {
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }));
          }
        }
      });
      server.httpServer && Object.assign(server.httpServer, { timeout: 0, headersTimeout: 0, requestTimeout: 0 });
    },
  };
}

const listen = loadSettings();

const watchIgnored = [
  "**/node_modules/**",
  "**/.git/**",
  "**/comfy/**",
  "**/models/**",
  "**/data/**",
  "**/tools/**",
  "**/.venv/**",
  "**/site-packages/**",
];

export default defineConfig({
  plugins: [react(), tailwindcss(), apiPlugin()],
  server: {
    port: listen.port,
    host: listen.host,
    allowedHosts: true,
    strictPort: true,
    watch: {
      ignored: watchIgnored,
    },
  },
  preview: {
    port: listen.port,
    host: listen.host,
    allowedHosts: true,
    strictPort: true,
  },
});
