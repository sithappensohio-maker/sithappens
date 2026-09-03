// Runs the Vite dev server on the e2e port, pointed at the e2e backend.
// The frontend reads REACT_APP_BACKEND_URL at dev-server start (vite.config.mjs).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(here, "..");
const port = process.env.E2E_FRONT_PORT || "3100";
const backendPort = process.env.E2E_BACKEND_PORT || "8021";
const env = { ...process.env, REACT_APP_BACKEND_URL: `http://127.0.0.1:${backendPort}`, VITE_BACKEND_URL: `http://127.0.0.1:${backendPort}` };
// Run vite's JS entry through this same node binary: no shell, so a
// repository path with spaces (C:\Users\Sit Happens\...) is not a problem.
const viteEntry = path.join(frontendDir, "node_modules", "vite", "bin", "vite.js");
const child = spawn(process.execPath, [viteEntry, "--host", "127.0.0.1", "--port", port, "--strictPort"], { cwd: frontendDir, env, stdio: "inherit" });
const stop = () => { try { child.kill(); } catch { /* ignore */ } };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", stop);
child.on("exit", (code) => process.exit(code ?? 0));
