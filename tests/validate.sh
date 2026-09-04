#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_PATH="${1:-$PWD}"

for FILE in \
  "$ROOT/opencode.jsonc" \
  "$ROOT/tui.json" \
  "$ROOT/AGENTS.md" \
  "$ROOT/install.sh" \
  "$ROOT/agents/unity.md" \
  "$ROOT/agents/unity-full.md" \
  "$ROOT/agents/simplemode.md" \
  "$ROOT/agents/dumpmode.md" \
  "$ROOT/commands/simplemode.md" \
  "$ROOT/commands/dumpmode.md" \
  "$ROOT/tests/simplemode.mjs" \
  "$ROOT/tests/dumpmode.mjs" \
  "$ROOT/tests/context-logger.mjs" \
  "$ROOT/tests/mode-state.mjs" \
  "$ROOT/plugins/unitycode-logo.tsx" \
  "$ROOT/plugins/unitycode-coordinator.ts" \
  "$ROOT/plugins/unitycode-context-logger.ts" \
  "$ROOT/plugins/unitycode-coordination.mjs" \
  "$ROOT/plugins/unitycode-presence.mjs" \
  "$ROOT/plugins/unitycode-mode-state.mjs" \
  "$ROOT/skills/unity-mcp-workflow/SKILL.md" \
  "$ROOT/skills/unity-ui-toolkit/SKILL.md"; do
  [[ -s "$FILE" ]] || { echo "missing: $FILE" >&2; exit 1; }
done

bash -n "$ROOT/bin/unity-opencode"
bash -n "$ROOT/bin/UnityCode"
bash -n "$ROOT/bin/unity-cli"
bash -n "$ROOT/install.sh"
bash -n "$ROOT/scripts/doctor.sh"
node "$ROOT/tests/presence.mjs"
node "$ROOT/tests/mode-state.mjs"
node "$ROOT/tests/coordination.mjs"
node "$ROOT/tests/context-logger.mjs"
node "$ROOT/tests/portability.mjs"
node "$ROOT/tests/simplemode.mjs"
node "$ROOT/tests/dumpmode.mjs"

UNITY_MCP_URL="${UNITY_MCP_URL:-http://127.0.0.1:8080/mcp}" \
OPENCODE_CONFIG="$ROOT/opencode.jsonc" \
OPENCODE_CONFIG_DIR="$ROOT" \
opencode debug config >/dev/null

"$ROOT/scripts/doctor.sh" "$PROJECT_PATH"
echo "harness_validation: ok"
