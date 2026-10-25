#!/usr/bin/env bash
# Blackboarder updater for macOS and Linux.
#
#   --install                 (run by update.sh) downloads the latest extension from GitHub into
#                             this folder and registers the update helper with Chrome, Chromium,
#                             Edge and Brave, so the extension can update itself from then on.
#   chrome-extension://.../   (the browser starts it this way) answers one native message:
#                             {"type":"ping"} or {"type":"update"}.
#
# The extension folder is the parent of the folder this script is in, or dist/ next to it when the
# script runs from a git clone's own updater/ folder. Inside a git clone the helper updates with
# git pull --ff-only, and only when that cannot lose work (on main, nothing uncommitted).
set -uo pipefail

HOST_NAME="com.blackboarder.updater"
ZIP_URL="https://github.com/yvs1n/blackboarder-extension/archive/refs/heads/main.zip"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
EXT_DIR="$(cd "$SCRIPT_DIR/.." && pwd -P)"
# Run from a git clone's own updater/ folder, the browser loads dist/ next to it
if [ ! -f "$EXT_DIR/manifest.json" ] && [ -f "$EXT_DIR/dist/manifest.json" ]; then EXT_DIR="$EXT_DIR/dist"; fi
HELPER_VERSION=1

is_dev_checkout() { [ -e "$EXT_DIR/../.git" ]; }

json_build() { sed -n 's/.*"build": *"\([^"]*\)".*/\1/p' "$1" 2>/dev/null | head -n 1; }
json_files() { sed -n '/"files": *\[/,/\]/p' "$1" 2>/dev/null | grep -o '"[^"]*"' | tr -d '"' | grep -v '^files$' || true; }
json_escape() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g' | tr -d '\n'; }

# Prints a JSON result line
# Built files are committed, so a fast-forward pull is the whole update. Anything that could lose
# work (another branch, uncommitted edits, local commits) is left alone.
git_skip() { echo "{\"ok\":false,\"code\":\"dev-checkout\",\"error\":\"$1\"}"; }

update_git_checkout() {
  local repo="$EXT_DIR/.." before branch changed=false
  command -v git >/dev/null 2>&1 || { git_skip "This folder is a git clone, but git was not found. Run git pull yourself."; return; }
  branch="$(git -C "$repo" rev-parse --abbrev-ref HEAD 2>/dev/null)"
  [ "$branch" = "main" ] || { git_skip "The git clone is on branch $branch, not main, so it was not updated."; return; }
  [ -z "$(git -C "$repo" status --porcelain --untracked-files=no 2>/dev/null)" ] || { git_skip "The git clone has uncommitted changes, so it was not updated."; return; }
  before="$(git -C "$repo" rev-parse HEAD)"
  git -C "$repo" pull --ff-only --quiet origin main >/dev/null 2>&1 || { git_skip "git pull --ff-only failed. Run git pull yourself."; return; }
  [ "$before" = "$(git -C "$repo" rev-parse HEAD)" ] || changed=true
  echo "{\"ok\":true,\"changed\":$changed,\"build\":\"$(json_build "$EXT_DIR/version.json")\"}"
}

update_extension_files() {
  if is_dev_checkout; then
    update_git_checkout
    return
  fi
  local work
  work="$(mktemp -d)"
  install_from_github "$work"
  rm -rf "$work"
}

install_from_github() {
  local work="$1"
  if ! curl -fsSL -o "$work/main.zip" "$ZIP_URL" >&2; then
    echo '{"ok":false,"error":"Could not download the update from GitHub."}'
    return
  fi
  if ! unzip -q "$work/main.zip" -d "$work/src" >&2; then
    echo '{"ok":false,"error":"Could not unpack the update."}'
    return
  fi
  local src_dist=""
  for dir in "$work"/src/*/; do
    if [ -f "${dir}dist/manifest.json" ]; then src_dist="${dir}dist"; break; fi
  done
  if [ -z "$src_dist" ]; then
    echo '{"ok":false,"error":"The download does not contain a built extension (dist/manifest.json)."}'
    return
  fi

  local new_build old_build
  new_build="$(json_build "$src_dist/version.json")"
  old_build="$(json_build "$EXT_DIR/version.json")"
  if [ -z "$new_build" ]; then
    echo '{"ok":false,"error":"The download has no version.json."}'
    return
  fi
  if [ "$new_build" = "$old_build" ]; then
    echo "{\"ok\":true,\"changed\":false,\"build\":\"$new_build\"}"
    return
  fi

  # Copy every file; version.json goes last so a half-finished update never looks complete
  (cd "$src_dist" && find . -type f ! -path ./version.json) | while IFS= read -r rel; do
    mkdir -p "$EXT_DIR/$(dirname "$rel")"
    cp -f "$src_dist/$rel" "$EXT_DIR/$rel"
  done

  # Remove files the previous build had and the new one does not
  local keep
  keep="$(json_files "$src_dist/version.json")"
  if [ -n "$keep" ]; then
    json_files "$EXT_DIR/version.json" | while IFS= read -r old; do
      case "$old" in *..*|/*) continue ;; esac
      if ! printf '%s\n' "$keep" | grep -qxF "$old"; then rm -f "$EXT_DIR/$old"; fi
    done
  fi

  cp -f "$src_dist/version.json" "$EXT_DIR/version.json"
  chmod +x "$EXT_DIR/update.sh" "$SCRIPT_DIR/blackboarder-updater.sh" 2>/dev/null || true
  echo "{\"ok\":true,\"changed\":true,\"build\":\"$new_build\"}"
}

# --- Native messaging: 4-byte length (native byte order) followed by JSON -------------------------

send_message() {
  local msg="$1" n
  n="$(LC_ALL=C; printf '%s' "$msg" | wc -c | tr -d ' ')"
  printf "$(printf '\\%03o\\%03o\\%03o\\%03o' $((n & 255)) $(((n >> 8) & 255)) $(((n >> 16) & 255)) $(((n >> 24) & 255)))"
  printf '%s' "$msg"
}

run_native_host() {
  local len msg reply
  len="$(dd bs=1 count=4 2>/dev/null | od -An -tu4 | tr -d ' \n')"
  if [ -z "$len" ] || [ "$len" -le 0 ] || [ "$len" -gt 1048576 ]; then exit 0; fi
  msg="$(dd bs=1 count="$len" 2>/dev/null)"
  case "$msg" in
    *'"type":"ping"'*)
      local dev=false
      is_dev_checkout && dev=true
      reply="{\"ok\":true,\"helperVersion\":$HELPER_VERSION,\"devCheckout\":$dev,\"build\":\"$(json_build "$EXT_DIR/version.json")\"}"
      ;;
    *'"type":"update"'*)
      reply="$(update_extension_files 2>/dev/null | tail -n 1)"
      [ -n "$reply" ] || reply='{"ok":false,"error":"The update failed."}'
      ;;
    *)
      reply='{"ok":false,"error":"Unknown request"}'
      ;;
  esac
  send_message "$reply"
}

# --- Registration -----------------------------------------------------------------------------

# Chromium names an unpacked extension after its folder: SHA-256 of the path, first 32 hex digits
# mapped to a-p
extension_id() {
  local hash
  if command -v shasum >/dev/null 2>&1; then
    hash="$(printf '%s' "$EXT_DIR" | shasum -a 256)"
  else
    hash="$(printf '%s' "$EXT_DIR" | sha256sum)"
  fi
  printf '%s' "${hash:0:32}" | tr '0-9a-f' 'a-p'
}

register_native_host() {
  local id manifest dirs dir
  id="$(extension_id)"
  manifest="{
  \"name\": \"$HOST_NAME\",
  \"description\": \"Blackboarder updater\",
  \"path\": \"$(json_escape "$SCRIPT_DIR/blackboarder-updater.sh")\",
  \"type\": \"stdio\",
  \"allowed_origins\": [\"chrome-extension://$id/\"]
}"
  if [ "$(uname -s)" = "Darwin" ]; then
    dirs=(
      "$HOME/Library/Application Support/Google/Chrome"
      "$HOME/Library/Application Support/Chromium"
      "$HOME/Library/Application Support/Microsoft Edge"
      "$HOME/Library/Application Support/BraveSoftware/Brave-Browser"
    )
  else
    dirs=(
      "$HOME/.config/google-chrome"
      "$HOME/.config/chromium"
      "$HOME/.config/microsoft-edge"
      "$HOME/.config/BraveSoftware/Brave-Browser"
    )
  fi
  for dir in "${dirs[@]}"; do
    [ -d "$dir" ] || continue
    mkdir -p "$dir/NativeMessagingHosts"
    printf '%s\n' "$manifest" > "$dir/NativeMessagingHosts/$HOST_NAME.json"
  done
  chmod +x "$SCRIPT_DIR/blackboarder-updater.sh"
  echo "      Extension ID: $id"
}

run_install() {
  echo "===================================================="
  echo "  Blackboarder updater"
  echo "===================================================="
  if [ ! -f "$EXT_DIR/manifest.json" ]; then
    echo "[ERROR] Could not find the extension next to this script ($EXT_DIR)."
    exit 1
  fi
  echo "Extension folder: $EXT_DIR"
  if is_dev_checkout; then
    echo "[1/2] This is a git clone; updating with git pull..."
  else
    echo "[1/2] Downloading the latest version from GitHub..."
  fi
  local result
  result="$(update_extension_files | tail -n 1)"
  case "$result" in
    *'"changed":true'*) echo "      Updated." ;;
    *'"ok":true'*) echo "      Already up to date." ;;
    *'"dev-checkout"'*) echo "      $result" ;;
    *) echo "[ERROR] $result"; exit 1 ;;
  esac
  echo "[2/2] Turning on automatic updates..."
  register_native_host
  echo ""
  echo "Done. Blackboarder now updates itself whenever a new version is pushed to GitHub."
  echo "If this is the first time: open chrome://extensions and click the reload arrow on Blackboarder once."
  echo "Your tasks, courses and Sync Key are kept."
}

case "${1:-}" in
  --install) run_install ;;
  chrome-extension://*) run_native_host ;;
  *) echo "Run update.sh in the Blackboarder folder." ;;
esac
