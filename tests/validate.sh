#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROJECT_PATH="${1:-$PWD}"

for FILE in \
  "$ROOT/opencode.jsonc" \
  "$ROOT/tui.json" \
  "$ROOT/AGENTS.md" \
  "$ROOT/agents/unity.md" \
  "$ROOT/agents/unity-full.md" \
  "$ROOT/plugins/unitycode-logo.tsx" \
  "$ROOT/skills/unity-mcp-workflow/SKILL.md" \
  "$ROOT/skills/unity-ui-toolkit/SKILL.md"; do
  [[ -s "$FILE" ]] || { echo "missing: $FILE" >&2; exit 1; }
done

bash -n "$ROOT/bin/unity-opencode"
bash -n "$ROOT/bin/UnityCode"
bash -n "$ROOT/bin/unity-cli"
bash -n "$ROOT/scripts/doctor.sh"

UNITY_MCP_URL="${UNITY_MCP_URL:-http://127.0.0.1:8080/mcp}" \
UNITY_OPENCODE_MODEL="${UNITY_OPENCODE_MODEL:-opencode/muse-spark-1.3-contributor-free}" \
OPENCODE_CONFIG="$ROOT/opencode.jsonc" \
OPENCODE_CONFIG_DIR="$ROOT" \
opencode debug config >/dev/null

"$ROOT/scripts/doctor.sh" "$PROJECT_PATH"
echo "harness_validation: ok"
