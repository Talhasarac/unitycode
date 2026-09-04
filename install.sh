#!/usr/bin/env bash
set -euo pipefail

REPOSITORY_URL="${UNITYCODE_REPOSITORY_URL:-https://github.com/Talhasarac/unitycode.git}"
REPOSITORY_REF="${UNITYCODE_REPOSITORY_REF:-main}"
INSTALL_DIRECTORY="${UNITYCODE_INSTALL_DIRECTORY:-$HOME/.local/share/unitycode}"
ORIGINAL_PATH="$PATH"

fail() {
  printf 'unitycode installer: %s\n' "$1" >&2
  exit 1
}

case "$(uname -s)" in
  Darwin|Linux) ;;
  *) fail "only macOS and Linux are currently supported" ;;
esac

for COMMAND in curl git npm; do
  command -v "$COMMAND" >/dev/null 2>&1 || fail "$COMMAND is required but was not found on PATH"
done

if ! command -v opencode >/dev/null 2>&1; then
  [[ "${UNITYCODE_INSTALL_OPENCODE:-1}" != "0" ]] || \
    fail "OpenCode is required; install it first or allow the default automatic installation"
  printf 'OpenCode was not found; installing it from https://opencode.ai/install\n'
  TEMP_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/unitycode-install.XXXXXX")"
  trap 'rm -rf "$TEMP_DIRECTORY"' EXIT
  curl -fsSL https://opencode.ai/install -o "$TEMP_DIRECTORY/opencode-install.sh"
  bash "$TEMP_DIRECTORY/opencode-install.sh"
  rm -rf "$TEMP_DIRECTORY"
  trap - EXIT
  export PATH="$HOME/.opencode/bin:$PATH"
  command -v opencode >/dev/null 2>&1 || fail "OpenCode installation finished but opencode was not found"
fi

path_contains() {
  local search_path="${2:-$PATH}"
  case ":$search_path:" in
    *":$1:"*) return 0 ;;
    *) return 1 ;;
  esac
}

choose_bin_directory() {
  if [[ -n "${UNITYCODE_BIN_DIRECTORY:-}" ]]; then
    printf '%s\n' "$UNITYCODE_BIN_DIRECTORY"
    return
  fi

  local candidate parent
  for candidate in "$HOME/.local/bin" "$HOME/bin" "$HOME/.opencode/bin" /opt/homebrew/bin /usr/local/bin; do
    path_contains "$candidate" "$ORIGINAL_PATH" || continue
    parent="$(dirname "$candidate")"
    if [[ -w "$candidate" || ( ! -e "$candidate" && -d "$parent" && -w "$parent" ) ]]; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  printf '%s\n' "$HOME/.local/bin"
}

BIN_DIRECTORY="$(choose_bin_directory)"
case "$BIN_DIRECTORY" in
  /) fail "refusing unsafe command directory: $BIN_DIRECTORY" ;;
esac

add_bin_to_shell_config() {
  local shell_name config_file line
  shell_name="$(basename "${SHELL:-sh}")"
  case "$shell_name" in
    zsh) config_file="${ZDOTDIR:-$HOME}/.zshrc" ;;
    bash)
      if [[ "$(uname -s)" == "Darwin" ]]; then
        config_file="$HOME/.bash_profile"
      else
        config_file="$HOME/.bashrc"
      fi
      ;;
    fish) config_file="$HOME/.config/fish/config.fish" ;;
    *) config_file="$HOME/.profile" ;;
  esac

  mkdir -p "$(dirname "$config_file")"
  touch "$config_file"
  if grep -F "$BIN_DIRECTORY" "$config_file" >/dev/null 2>&1; then
    printf '%s\n' "$config_file"
    return
  fi
  if [[ "$shell_name" == "fish" ]]; then
    line="fish_add_path \"$BIN_DIRECTORY\""
  else
    line="export PATH=\"$BIN_DIRECTORY:\$PATH\""
  fi
  printf '\n# UnityCode\n%s\n' "$line" >> "$config_file"
  printf '%s\n' "$config_file"
}

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
COMMAND_PATH="$BIN_DIRECTORY/unitycode"
if [[ -e "$COMMAND_PATH" || -L "$COMMAND_PATH" ]]; then
  [[ -L "$COMMAND_PATH" ]] || fail "refusing to replace existing file: $COMMAND_PATH"
  [[ "$(readlink "$COMMAND_PATH")" == "$INSTALL_DIRECTORY/bin/UnityCode" ]] || \
    fail "refusing to replace unrelated symlink: $COMMAND_PATH"
fi
ln -sfn "$INSTALL_DIRECTORY/bin/UnityCode" "$COMMAND_PATH"

printf '\nUnityCode installed successfully.\n'
printf 'Command: %s/unitycode\n' "$BIN_DIRECTORY"

if path_contains "$BIN_DIRECTORY" "$ORIGINAL_PATH"; then
  printf 'Ready: type unitycode in this terminal.\n'
else
  CONFIG_FILE="$(add_bin_to_shell_config)"
  printf '\nAdded UnityCode to PATH in %s.\n' "$CONFIG_FILE"
  printf 'Open a new terminal, or run: source "%s"\n' "$CONFIG_FILE"
fi
