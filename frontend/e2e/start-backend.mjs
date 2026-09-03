// Seeds the disposable e2e database, then runs the backend on the e2e port.
// Playwright waits on the backend's health URL (playwright.config.js).
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.resolve(here, "..", "..", "backend");
const seedOut = path.join(here, ".seed.json");
const port = process.env.E2E_BACKEND_PORT || "8021";
const dbName = process.env.E2E_DB_NAME || "sit_happens_test_e2e_school";
// Two projects × up to 14 client slots each (see helpers.clientFor).
const clients = process.env.E2E_CLIENTS || "30";

function pythonPath() {
  if (process.env.E2E_PYTHON) return process.env.E2E_PYTHON;
  const candidates = process.platform === "win32"
    ? [path.join(backendDir, ".venv_local_test", "Scripts", "python.exe"), path.join(backendDir, ".venv_ci", "Scripts", "python.exe"), path.join(backendDir, "venv", "Scripts", "python.exe")]
    : [path.join(backendDir, ".venv_local_test", "bin", "python"), path.join(backendDir, ".venv_ci", "bin", "python"), path.join(backendDir, "venv", "bin", "python")];
  return candidates.find((p) => existsSync(p)) || (process.platform === "win32" ? "python" : "python3");
}

const python = pythonPath();
const frontPort = process.env.E2E_FRONT_PORT || "3100";
const env = {
  ...process.env, SIT_HAPPENS_TEST_DB_NAME: dbName, DB_NAME: dbName, SCHEDULER_ENABLED: "0", PYTHONUTF8: "1", PYTHONUNBUFFERED: "1",
  // The e2e frontend runs on its own port, so the backend must allow that origin.
  CORS_ORIGINS: `http://127.0.0.1:${frontPort},http://localhost:${frontPort}`,
};

console.log(`[e2e] seeding ${dbName} with ${clients} clients using ${python}`);
const seed = spawnSync(python, ["e2e_school_seed.py", "--clients", clients, "--out", seedOut], { cwd: backendDir, env, stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
const seedOk = /E2E_SEED_OK/.test(seed.stdout || "");
if (!seedOk) {
  process.stderr.write(seed.stdout || "");
  process.stderr.write(seed.stderr || "");
  console.error("[e2e] seed failed");
  process.exit(1);
}
console.log((seed.stdout || "").trim().split("\n").filter((l) => l.includes("E2E_SEED_OK")).join("\n"));

console.log(`[e2e] starting backend on :${port}`);
const server = spawn(python, ["-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", port], { cwd: backendDir, env, stdio: ["ignore", "inherit", "inherit"] });
const stop = () => { try { server.kill(); } catch { /* ignore */ } };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
process.on("exit", stop);
server.on("exit", (code) => process.exit(code ?? 0));
