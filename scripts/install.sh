#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/install.sh [version]
       npm run vault-install [-- version]

  scripts/install.sh          Build local source and install it.
  scripts/install.sh 1.4.0    Download release 1.4.0 from GitHub and install it.

Set the install target(s) via one of:
  VAULT_PLUGIN_DIRS   One or more plugin dirs, newline-separated (multi-vault).
  VAULT_PLUGIN_DIR    A single plugin dir (back-compat).

The easiest way is to run via install-plugin.sh (gitignored), which has the
path(s) hardcoded for your machine.
EOF
}

if [[ ${1:-} == "-h" || ${1:-} == "--help" ]]; then
  usage
  exit 0
fi

version="${1:-}"

# Collect destination plugin dirs. VAULT_PLUGIN_DIRS (newline-separated) wins;
# fall back to the single VAULT_PLUGIN_DIR. Newline separation keeps paths with
# spaces intact.
dests=()
if [[ -n "${VAULT_PLUGIN_DIRS:-}" ]]; then
  while IFS= read -r line; do
    [[ -n "$line" ]] && dests+=("$line")
  done <<< "$VAULT_PLUGIN_DIRS"
elif [[ -n "${VAULT_PLUGIN_DIR:-}" ]]; then
  dests=("$VAULT_PLUGIN_DIR")
fi

if [[ ${#dests[@]} -eq 0 ]]; then
  echo "error: no install target set." >&2
  echo "Set VAULT_PLUGIN_DIRS (newline-separated) or VAULT_PLUGIN_DIR, or run via install-plugin.sh." >&2
  exit 1
fi

bold=$(tput bold 2>/dev/null || true)
reset=$(tput sgr0 2>/dev/null || true)
dim=$(tput dim 2>/dev/null || true)

# Copy the three plugin files from a source dir into every destination.
install_to_dests() {
  local src="$1"
  for dest in "${dests[@]}"; do
    mkdir -p "$dest"
    cp "$src/main.js"       "$dest/main.js"
    cp "$src/manifest.json" "$dest/manifest.json"
    [ -f "$src/styles.css" ] && cp "$src/styles.css" "$dest/styles.css"
    echo "${dim}→ $dest${reset}"
  done
}

if [[ -z "$version" ]]; then
  # Local build: compile once, then fan out to every vault.
  local_version=$(node -e "process.stdout.write(require('./manifest.json').version)")
  echo ""
  echo "${bold}CodeSuite ${local_version}${reset} — local build → ${#dests[@]} vault(s)"
  echo ""
  npm run build 2>&1 | grep -v "^$" | sed "s/^/  /"
  # Stage the built files (manifest/styles live at repo root, main.js in dist/).
  stage=$(mktemp -d)
  trap 'rm -rf "$stage"' EXIT
  cp dist/main.js  "$stage/main.js"
  cp manifest.json "$stage/manifest.json"
  [ -f styles.css ] && cp styles.css "$stage/styles.css"
  install_to_dests "$stage"
  echo ""
  echo "  Installed. Reload Obsidian or toggle the plugin off/on."
  echo ""
  exit 0
fi

# Specific release: download once, then fan out to every vault.
if ! command -v gh >/dev/null 2>&1; then
  echo "error: GitHub CLI (gh) is required to download a specific version." >&2
  exit 1
fi

if ! gh release view "$version" >/dev/null 2>&1; then
  echo "error: no GitHub release found for version: $version" >&2
  exit 1
fi

echo ""
echo "${bold}CodeSuite ${version}${reset} — from GitHub release for ${#dests[@]} vault(s)"
echo ""
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT
gh release download "$version" --dir "$stage" --clobber \
  --pattern main.js --pattern manifest.json --pattern styles.css 2>&1 | sed "s/^/  /"
install_to_dests "$stage"
echo ""
echo "  Installed. Reload Obsidian or toggle the plugin off/on."
echo ""
