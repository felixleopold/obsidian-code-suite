#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/install.sh [version]
       npm run vault-install [-- version]

  scripts/install.sh          Build local source and install it.
  scripts/install.sh 1.4.0    Download release 1.4.0 from GitHub and install it.
EOF
}

if [[ ${1:-} == "-h" || ${1:-} == "--help" ]]; then
  usage
  exit 0
fi

version="${1:-}"
dest="/Users/leopoldmac/Documents/MyBrain/.obsidian/plugins/code-suite"

bold=$(tput bold 2>/dev/null || true)
reset=$(tput sgr0 2>/dev/null || true)
dim=$(tput dim 2>/dev/null || true)

mkdir -p "$dest"

if [[ -z "$version" ]]; then
  # Read version from manifest.json (local build)
  local_version=$(node -e "process.stdout.write(require('./manifest.json').version)")
  echo ""
  echo "${bold}CodeSuite ${local_version}${reset} — local build"
  echo "${dim}→ $dest${reset}"
  echo ""
  npm run build 2>&1 | grep -v "^$" | sed "s/^/  /"
  cp dist/main.js  "$dest/main.js"
  cp manifest.json "$dest/manifest.json"
  [ -f styles.css ] && cp styles.css "$dest/styles.css"
  echo ""
  echo "  Installed. Reload Obsidian or toggle the plugin off/on."
  echo ""
  exit 0
fi

if ! command -v gh >/dev/null 2>&1; then
  echo "error: GitHub CLI (gh) is required to download a specific version." >&2
  exit 1
fi

if ! gh release view "$version" >/dev/null 2>&1; then
  echo "error: no GitHub release found for version: $version" >&2
  exit 1
fi

echo ""
echo "${bold}CodeSuite ${version}${reset} — from GitHub release"
echo "${dim}→ $dest${reset}"
echo ""
gh release download "$version" --dir "$dest" --clobber \
  --pattern main.js --pattern manifest.json --pattern styles.css 2>&1 | sed "s/^/  /"
echo ""
echo "  Installed. Reload Obsidian or toggle the plugin off/on."
echo ""
