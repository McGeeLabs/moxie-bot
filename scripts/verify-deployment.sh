#!/usr/bin/env bash
set -euo pipefail
umask 077

if [[ $# -gt 1 || ( $# -eq 1 && "$1" != "--restart" ) ]]; then
  echo "Usage: bash scripts/verify-deployment.sh [--restart]" >&2
  exit 2
fi

dc=(docker compose --env-file .env.docker -f compose.yaml -f compose.integrations.yaml)
"${dc[@]}" --profile tools config --quiet
bot_id=$("${dc[@]}" ps -q bot)
if [[ -z "$bot_id" ]]; then echo "Start the VPS bot before verification." >&2; exit 1; fi

docker exec "$bot_id" node -e '
  if (process.getuid() === 0) throw new Error("Runtime must be non-root");
  for (const name of ["prisma", "typescript"]) {
    try { require.resolve(name); throw new Error("Development tooling in runtime"); }
    catch (error) { if (error.code !== "MODULE_NOT_FOUND") throw error; }
  }
  require("./dist/generated/prisma/client");
  require("./dist/core/client").createClient().destroy();
  console.log("Non-root runtime, production dependencies, and application imports verified.");
'
docker exec "$bot_id" node dist/core/database/check.js
"${dc[@]}" run --rm migrate validate
"${dc[@]}" run --rm migrate status

check_dir=$(mktemp -d)
bot_stopped=false
cleanup() {
  if [[ "$bot_stopped" == true ]]; then "${dc[@]}" up -d bot || true; fi
  rm -f -- "$check_dir/before.json" "$check_dir/after.json" "$check_dir/restart.log"
  rmdir -- "$check_dir" || true
}
trap cleanup EXIT
docker exec "$bot_id" node dist/core/database/verifyPersistence.js snapshot > "$check_dir/before.json"

if [[ "${1:-}" != "--restart" ]]; then
  echo "Read-only container checks passed. Add --restart to check graceful shutdown and persistence (brief bot downtime)."
  exit 0
fi

bot_stopped=true
"${dc[@]}" stop bot
if [[ "$(docker inspect --format '{{.State.ExitCode}}' "$bot_id")" != "0" ]]; then
  echo "Bot did not exit cleanly; inspect its shutdown logs." >&2
  exit 1
fi
restart_started=$(date -u +%Y-%m-%dT%H:%M:%S.%NZ)
"${dc[@]}" up -d bot
bot_stopped=false
bot_id=$("${dc[@]}" ps -q bot)
ready=false
for attempt in {1..30}; do
  docker logs --since "$restart_started" "$bot_id" > "$check_dir/restart.log" 2>&1
  if grep -q 'Moxie connected to Discord' "$check_dir/restart.log" && grep -q 'Guild configuration sync finished' "$check_dir/restart.log"; then ready=true; break; fi
  sleep 2
done
if [[ "$ready" != true ]]; then echo "Discord readiness not confirmed within 60 seconds; inspect logs." >&2; exit 1; fi
docker exec "$bot_id" node dist/core/database/verifyPersistence.js snapshot > "$check_dir/after.json"
if ! cmp -s "$check_dir/before.json" "$check_dir/after.json"; then
  echo "Saved configuration changed across restart. Check deliberate edits or startup defaults." >&2
  exit 1
fi
echo "Graceful shutdown, Discord readiness, and saved guild/webhook/Valheim configuration across restart verified."
