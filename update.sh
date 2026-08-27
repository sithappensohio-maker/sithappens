#!/usr/bin/env bash
# Sit Happens — controlled production updater / rollback tool.
#
#   ./update.sh                 deploy exact origin/main HEAD
#   ./update.sh --status        show recorded deployment SHAs
#   ./update.sh --rollback      roll back to previously successful SHA
#   ./update.sh --rollback SHA  roll back to an explicit known commit
#
# A verified backup is required before code/container replacement unless
# SKIP_PREUPDATE_BACKUP=1 is explicitly set.

set -Eeuo pipefail
cd "$(dirname "$0")"

REMOTE="${DEPLOY_REMOTE:-origin}"
BRANCH="${DEPLOY_BRANCH:-main}"
STATE_DIR=".deploy-state"
CURRENT_SHA_FILE="$STATE_DIR/current_sha"
PREVIOUS_SHA_FILE="$STATE_DIR/previous_sha"
LAST_ATTEMPT_FILE="$STATE_DIR/last_attempt_sha"
HISTORY_FILE="$STATE_DIR/history.log"
HEALTH_URL="${DEPLOY_HEALTH_URL:-http://localhost:8080/api/health}"
mkdir -p "$STATE_DIR"

say() { printf '%s\n' "$*"; }
fail() { say "❌ $*" >&2; exit 1; }
read_state() { local f="$1"; [ -f "$f" ] && tr -d '[:space:]' < "$f" || true; }
valid_commit() { [ -n "${1:-}" ] && git cat-file -e "$1^{commit}" 2>/dev/null; }
record_history() { printf '%s\t%s\t%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$3" >> "$HISTORY_FILE"; }

require_git_clone() {
  [ -d .git ] || fail "This folder is not a git clone. update.sh must run from the production clone."
}

require_clean_tree() {
  if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
    git status --short
    fail "Tracked working-tree changes detected. Commit/stash them before deploying; update.sh will not overwrite local edits."
  fi
}

require_expected_branch() {
  local current_branch
  current_branch="$(git symbolic-ref --quiet --short HEAD || true)"
  [ "$current_branch" = "$BRANCH" ] || fail "Production clone is on '${current_branch:-detached}', expected '$BRANCH'."
}

backup_gate() {
  if [ "${SKIP_PREUPDATE_BACKUP:-0}" = "1" ]; then
    say "⚠️  SKIP_PREUPDATE_BACKUP=1 — proceeding without the required safety backup."
    return
  fi
  say "💾  Creating required pre-deployment backup..."
  [ -x ./backup-now.sh ] || fail "backup-now.sh is missing or not executable. No code was changed."
  ./backup-now.sh
  say "✅  Pre-deployment backup complete."
}

wait_for_health() {
  say "⏳  Waiting for backend health..."
  local i
  for i in $(seq 1 60); do
    if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
      say "🗂️   Checking School media storage is writable..."
      docker compose exec -T backend python school_media_preflight.py >/dev/null
      return 0
    fi
    sleep 2
  done
  return 1
}

build_and_start() {
  local sha="$1"
  export APP_GIT_SHA="$sha"
  say "🔨  Building containers for ${sha:0:12}..."
  docker compose build
  say "🔁  Starting containers..."
  docker compose up -d
  wait_for_health
}

record_success() {
  local new_sha="$1" previous_sha="$2" action="$3"
  printf '%s\n' "$new_sha" > "$CURRENT_SHA_FILE"
  printf '%s\n' "$previous_sha" > "$PREVIOUS_SHA_FILE"
  printf '%s\n' "$new_sha" > "$LAST_ATTEMPT_FILE"
  record_history "$action" "$new_sha" "previous=$previous_sha"
  say "✅  Running SHA recorded: $new_sha"
}

restore_source_only() {
  local previous_sha="$1"
  if valid_commit "$previous_sha"; then
    git reset --hard "$previous_sha" >/dev/null
    say "↩️   Source tree restored to previous SHA $previous_sha (existing containers were not replaced)."
  fi
}

rollback_after_failed_deploy() {
  local previous_sha="$1" failed_sha="$2" reason="$3"
  say "⚠️  Deployment of $failed_sha failed: $reason"
  say "↩️   Automatically rolling back to $previous_sha..."
  if ! valid_commit "$previous_sha"; then
    record_history "ROLLBACK_FAILED" "$failed_sha" "previous SHA unavailable"
    fail "Automatic rollback cannot continue because previous SHA '$previous_sha' is not available locally. Backup remains intact."
  fi
  git reset --hard "$previous_sha" >/dev/null
  if build_and_start "$previous_sha"; then
    printf '%s\n' "$previous_sha" > "$CURRENT_SHA_FILE"
    printf '%s\n' "$failed_sha" > "$PREVIOUS_SHA_FILE"
    record_history "AUTO_ROLLBACK" "$previous_sha" "failed=$failed_sha reason=$reason"
    say "✅  Rollback healthy. Production is back on $previous_sha."
    exit 1
  fi
  record_history "ROLLBACK_FAILED" "$previous_sha" "failed=$failed_sha reason=$reason"
  say "❌ AUTOMATIC ROLLBACK ALSO FAILED. Do not retry blindly." >&2
  say "   Inspect: docker compose ps && docker compose logs --tail=120 backend frontend" >&2
  say "   The pre-deployment backup was created before code replacement." >&2
  exit 2
}

show_status() {
  local current previous attempt source
  source="$(git rev-parse HEAD 2>/dev/null || true)"
  current="$(read_state "$CURRENT_SHA_FILE")"
  previous="$(read_state "$PREVIOUS_SHA_FILE")"
  attempt="$(read_state "$LAST_ATTEMPT_FILE")"
  say "Source HEAD:        ${source:-unknown}"
  say "Recorded deployed:  ${current:-not recorded yet}"
  say "Previous deployed:  ${previous:-not recorded yet}"
  say "Last attempt:       ${attempt:-not recorded yet}"
  if [ -f "$HISTORY_FILE" ]; then
    say "Recent deployment history:"
    tail -n 8 "$HISTORY_FILE"
  fi
}

manual_rollback() {
  local requested="${1:-}"
  require_clean_tree
  require_expected_branch
  git fetch --prune "$REMOTE" "$BRANCH"
  local from_sha target_sha
  from_sha="$(read_state "$CURRENT_SHA_FILE")"
  [ -n "$from_sha" ] || from_sha="$(git rev-parse HEAD)"
  target_sha="$requested"
  [ -n "$target_sha" ] || target_sha="$(read_state "$PREVIOUS_SHA_FILE")"
  [ -n "$target_sha" ] || fail "No previous deployment SHA has been recorded yet. Pass an explicit SHA to --rollback."
  valid_commit "$target_sha" || fail "Rollback SHA '$target_sha' is not a known local commit."
  [ "$target_sha" != "$from_sha" ] || fail "Rollback target is already the recorded running SHA."
  backup_gate
  printf '%s\n' "$target_sha" > "$LAST_ATTEMPT_FILE"
  git reset --hard "$target_sha" >/dev/null
  if build_and_start "$target_sha"; then
    record_success "$target_sha" "$from_sha" "MANUAL_ROLLBACK"
    docker compose ps
    return 0
  fi
  rollback_after_failed_deploy "$from_sha" "$target_sha" "manual rollback target failed health/build"
}

main_update() {
  require_clean_tree
  require_expected_branch
  say "📥  Fetching $REMOTE/$BRANCH..."
  git fetch --prune "$REMOTE" "$BRANCH"
  local source_sha previous_sha target_sha
  source_sha="$(git rev-parse HEAD)"
  previous_sha="$(read_state "$CURRENT_SHA_FILE")"
  if ! valid_commit "$previous_sha"; then
    # Bootstrap safety for the first hardened deployment: if this checkout was
    # just advanced manually/with the legacy updater, ORIG_HEAD normally still
    # names the commit that was running immediately before it. Preserve that as
    # the first rollback point instead of losing it.
    previous_sha="$(git rev-parse ORIG_HEAD 2>/dev/null || true)"
  fi
  if ! valid_commit "$previous_sha"; then previous_sha="$source_sha"; fi
  target_sha="$(git rev-parse "$REMOTE/$BRANCH")"

  say "Current recorded SHA: $previous_sha"
  say "Target SHA:           $target_sha"
  if [ "$target_sha" = "$previous_sha" ] && [ "$source_sha" = "$target_sha" ]; then
    say "✅  Already on the recorded $REMOTE/$BRANCH SHA."
    show_status
    return 0
  fi

  backup_gate
  printf '%s\n' "$target_sha" > "$LAST_ATTEMPT_FILE"
  record_history "ATTEMPT" "$target_sha" "previous=$previous_sha"

  say "📌  Updating source to exact SHA $target_sha..."
  git reset --hard "$target_sha" >/dev/null

  export APP_GIT_SHA="$target_sha"
  say "🔨  Building containers..."
  if ! docker compose build; then
    record_history "BUILD_FAILED" "$target_sha" "previous=$previous_sha"
    restore_source_only "$previous_sha"
    fail "Build failed. Existing production containers were left running; source was restored to $previous_sha."
  fi

  say "🔁  Starting rebuilt containers..."
  if ! docker compose up -d; then
    rollback_after_failed_deploy "$previous_sha" "$target_sha" "docker compose up failed"
  fi
  if ! wait_for_health; then
    rollback_after_failed_deploy "$previous_sha" "$target_sha" "health/media preflight failed"
  fi

  record_success "$target_sha" "$previous_sha" "DEPLOY"
  docker compose ps
}

require_git_clone
case "${1:-}" in
  --status)
    show_status
    ;;
  --rollback)
    manual_rollback "${2:-}"
    ;;
  "")
    main_update
    ;;
  *)
    fail "Unknown option '$1'. Use ./update.sh, ./update.sh --status, or ./update.sh --rollback [SHA]."
    ;;
esac
