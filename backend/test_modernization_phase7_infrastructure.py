"""Phase 7 infrastructure guards.

These are intentionally source-level: they prevent the modernization from
quietly drifting back to CRA/CRACO, production-only dependency bloat, or an
untracked `git pull` deployment path.
"""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
BACKEND = ROOT / "backend"


def test_frontend_build_is_vite_not_cra_craco():
    pkg = json.loads((FRONTEND / "package.json").read_text())
    all_deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
    assert "react-scripts" not in all_deps
    assert "@craco/craco" not in all_deps
    assert pkg["scripts"]["build"] == "vite build"
    assert pkg["scripts"]["start"].startswith("vite ")
    assert (FRONTEND / "vite.config.mjs").exists()
    assert (FRONTEND / "index.html").exists()
    assert not (FRONTEND / "craco.config.js").exists()
    assert not (FRONTEND / "public" / "index.html").exists()


def test_jest_is_standalone_from_build_tool():
    pkg = json.loads((FRONTEND / "package.json").read_text())
    assert pkg["scripts"]["test"] == "jest"
    assert (FRONTEND / "jest.config.cjs").exists()


def test_runtime_requirements_are_runtime_only():
    runtime = (BACKEND / "requirements.txt").read_text().lower()
    tests = (BACKEND / "requirements-test.txt").read_text().lower()
    dev = (BACKEND / "requirements-dev.txt").read_text().lower()
    for banned in (
        "openai", "litellm", "huggingface", "numpy", "pandas", "tiktoken",
        "tokenizers", "pytest", "black", "flake8", "mypy", "isort",
    ):
        assert banned not in runtime
    assert "pytest" in tests
    assert "black" in dev and "flake8" in dev
    assert "-r requirements.txt" in tests
    assert "-r requirements-test.txt" in dev


def test_ci_runs_frontend_backend_and_release_critical_gates():
    ci = (ROOT / ".github" / "workflows" / "ci.yml").read_text()
    assert "yarn test:ci" in ci
    assert "yarn build" in ci
    assert "test_modernization_phase7_infrastructure.py" in ci
    assert "tests/run_release_critical.py" in ci
    assert "mongo:7" in ci


def test_update_script_records_exact_sha_and_has_rollback():
    updater = (ROOT / "update.sh").read_text()
    assert "git pull" not in updater
    assert 'git rev-parse "$REMOTE/$BRANCH"' in updater
    assert "CURRENT_SHA_FILE" in updater
    assert "PREVIOUS_SHA_FILE" in updater
    assert "--rollback" in updater
    assert "rollback_after_failed_deploy" in updater
    assert "git reset --hard" in updater
    assert "APP_GIT_SHA" in updater
    assert "backup_gate" in updater



def test_nginx_caches_vite_hashed_assets_and_keeps_spa_fallback():
    nginx = (FRONTEND / "nginx.conf").read_text()
    assert "location /assets/" in nginx
    assert "location /static/" not in nginx
    assert "try_files $uri $uri/ /index.html" in nginx

def test_docker_frontend_serves_vite_dist_and_vite_node_floor():
    docker = (ROOT / "Dockerfile.frontend").read_text()
    assert "node:20.19-alpine" in docker
    assert "/app/dist" in docker
    assert "/app/build" not in docker
    assert "yarn build" in docker
