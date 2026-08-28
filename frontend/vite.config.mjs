import { defineConfig, loadEnv, transformWithOxc } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function healthPlugin(enabled) {
  if (!enabled) return null;
  const startedAt = Date.now();
  const status = { state: "success", lastCompileTime: Date.now(), lastSuccessTime: Date.now(), totalCompiles: 1 };
  return {
    name: "sit-happens-dev-health",
    configureServer(server) {
      let settleTimer;
      const markCompiling = () => {
        status.state = "compiling";
        status.lastCompileTime = Date.now();
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          status.state = "success";
          status.lastSuccessTime = Date.now();
          status.totalCompiles += 1;
        }, 300);
      };
      server.watcher.on("change", markCompiling);
      server.watcher.on("add", markCompiling);
      server.watcher.on("unlink", markCompiling);
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split("?", 1)[0];
        if (!url?.startsWith("/health")) return next();
        const uptimeMs = Date.now() - startedAt;
        const simple = { state: status.state, isHealthy: status.state === "success", errorCount: 0, warningCount: 0 };
        const json = (code, body) => { res.statusCode = code; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(body)); };
        if (url === "/health/simple") { res.statusCode = 200; return res.end(status.state === "success" ? "OK" : status.state.toUpperCase()); }
        if (url === "/health/live") return json(200, { alive: true, timestamp: new Date().toISOString() });
        if (url === "/health/ready") return json(simple.isHealthy ? 200 : 503, { ready: simple.isHealthy, state: status.state });
        if (url === "/health/errors") return json(200, { ...simple, errors: [], warnings: [] });
        if (url === "/health/stats") return json(200, { totalCompiles: status.totalCompiles, serverUptimeMs: uptimeMs, lastCompileTime: status.lastCompileTime, lastSuccessTime: status.lastSuccessTime });
        if (url === "/health") return json(200, { status: simple.isHealthy ? "healthy" : "unhealthy", timestamp: new Date().toISOString(), uptime: { seconds: Math.floor(uptimeMs / 1000) }, vite: status, server: { nodeVersion: process.version, platform: os.platform(), arch: os.arch() } });
        return next();
      });
    },
  };
}

// CRA-era sources keep JSX in .js files (App.js, index.js, lib/*.js). The
// builtin oxc transform derives its parser language from the file extension
// and (by default) excludes .js entirely, so those files die with
// "Unexpected JSX expression" in both dev and build. This pre-plugin
// transforms JSX away for src/**/*.js before the builtin ever parses them —
// no renames, so the Jest source-scan tests keep reading the same paths.
function jsxInJsPlugin() {
  return {
    name: "sit-happens-jsx-in-js",
    enforce: "pre",
    async transform(code, id) {
      const file = id.split("?")[0].replace(/\\/g, "/");
      if (!/\/src\/.+\.js$/.test(file)) return null;
      const result = await transformWithOxc(code, id, {
        lang: "jsx",
        jsx: { runtime: "automatic" },
      });
      return { code: result.code, map: result.map ?? null };
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, here, "");
  const backendUrl = process.env.VITE_BACKEND_URL || env.VITE_BACKEND_URL || process.env.REACT_APP_BACKEND_URL || env.REACT_APP_BACKEND_URL || "";
  const posAgentUrl = process.env.VITE_POS_AGENT_URL || env.VITE_POS_AGENT_URL || process.env.REACT_APP_POS_AGENT_URL || env.REACT_APP_POS_AGENT_URL || "http://127.0.0.1:8765";
  const devBackend = process.env.VITE_DEV_BACKEND_URL || env.VITE_DEV_BACKEND_URL || "http://127.0.0.1:8001";
  const healthEnabled = process.env.ENABLE_HEALTH_CHECK || env.ENABLE_HEALTH_CHECK || "";
  const health = healthPlugin(healthEnabled.toLowerCase() === "true");
  return {
    plugins: [jsxInJsPlugin(), react(), health].filter(Boolean),
    resolve: { alias: { "@": path.resolve(here, "src") } },
    define: {
      "process.env.REACT_APP_BACKEND_URL": JSON.stringify(backendUrl),
      "process.env.REACT_APP_POS_AGENT_URL": JSON.stringify(posAgentUrl),
    },
    server: {
      port: 3000,
      proxy: backendUrl ? undefined : { "/api": { target: devBackend, changeOrigin: true } },
    },
    preview: { port: 3000 },
    build: { outDir: "dist", sourcemap: false },
  };
});
