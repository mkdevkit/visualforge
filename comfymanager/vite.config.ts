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
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith("/api")) return listener(req, res);
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), apiPlugin()],
  server: {
    port: 18788,
    host: "127.0.0.1",
  },
  preview: {
    port: 18788,
    host: "127.0.0.1",
  },
});
