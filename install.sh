#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_URL="${UNITYCODE_REPOSITORY_URL:-https://github.com/Talhasarac/unitycode.git}"
REPOSITORY_REF="${UNITYCODE_REPOSITORY_REF:-main}"
INSTALL_DIRECTORY="${UNITYCODE_INSTALL_DIRECTORY:-$HOME/.local/share/unitycode}"
BIN_DIRECTORY="${UNITYCODE_BIN_DIRECTORY:-$HOME/.local/bin}"

fail() {
  printf 'unitycode installer: %s\n' "$1" >&2
  exit 1
}

for COMMAND in git npm; do
  command -v "$COMMAND" >/dev/null 2>&1 || fail "$COMMAND is required but was not found on PATH"
done

case "$INSTALL_DIRECTORY" in
  /|"$HOME") fail "refusing unsafe install directory: $INSTALL_DIRECTORY" ;;
esac

if [[ -e "$INSTALL_DIRECTORY" ]]; then
  [[ -d "$INSTALL_DIRECTORY/.git" && -x "$INSTALL_DIRECTORY/bin/UnityCode" ]] || \
    fail "$INSTALL_DIRECTORY already exists and is not a UnityCode installation"

  printf 'Updating UnityCode in %s\n' "$INSTALL_DIRECTORY"
  git -C "$INSTALL_DIRECTORY" pull --ff-only
else
  printf 'Installing UnityCode in %s\n' "$INSTALL_DIRECTORY"
  mkdir -p "$(dirname "$INSTALL_DIRECTORY")"
  git clone --depth 1 --branch "$REPOSITORY_REF" "$REPOSITORY_URL" "$INSTALL_DIRECTORY"
fi

(
  cd "$INSTALL_DIRECTORY"
  npm ci --omit=dev --ignore-scripts
)
mkdir -p "$BIN_DIRECTORY"
ln -sfn "$INSTALL_DIRECTORY/bin/UnityCode" "$BIN_DIRECTORY/unitycode"

printf '\nUnityCode installed successfully.\n'
printf 'Command: %s/unitycode\n' "$BIN_DIRECTORY"

case ":$PATH:" in
  *":$BIN_DIRECTORY:"*) ;;
  *)
    printf '\nAdd this line to your shell configuration, then restart the terminal:\n'
    printf '  export PATH="%s:$PATH"\n' "$BIN_DIRECTORY"
    ;;
esac
