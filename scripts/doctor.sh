#!/usr/bin/env bash
set -euo pipefail

PROJECT_PATH="${1:-$PWD}"
PROJECT_PATH="$(cd "$PROJECT_PATH" 2>/dev/null && pwd)" || exit 2
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Unity OpenCode Harness doctor"
echo "project: $PROJECT_PATH"
echo "opencode: $(command -v opencode 2>/dev/null || echo missing)"
echo "opencode_version: $(opencode --version 2>/dev/null || echo unavailable)"
"$ROOT/bin/unity-cli" "$PROJECT_PATH" status

if grep -q 'com.coplaydev.unity-mcp' "$PROJECT_PATH/Packages/manifest.json" 2>/dev/null; then
  echo "unity_mcp_package: present"
else
  echo "unity_mcp_package: missing"
fi

MCP_URL="${UNITY_MCP_URL:-}"
if [[ -z "$MCP_URL" ]]; then
  PID_FILE="$(find "$PROJECT_PATH/Library/MCPForUnity/RunState" -maxdepth 1 -name 'mcp_http_*.pid' -print -quit 2>/dev/null || true)"
  if [[ -n "$PID_FILE" ]]; then
    PORT="${PID_FILE##*_}"; PORT="${PORT%.pid}"
    MCP_URL="http://127.0.0.1:${PORT}/mcp"
  else
    MCP_URL="http://127.0.0.1:8080/mcp"
  fi
fi
echo "unity_mcp_url: $MCP_URL"

RESPONSE="$(curl -sS --max-time 8 -X POST "$MCP_URL" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data-binary '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"unity-opencode-harness-doctor","version":"1.0.0"}}}' 2>/dev/null || true)"
if grep -q 'mcp-for-unity-server' <<<"$RESPONSE"; then
  echo "unity_mcp_handshake: ok"
else
  echo "unity_mcp_handshake: failed"
  exit 6
fi

