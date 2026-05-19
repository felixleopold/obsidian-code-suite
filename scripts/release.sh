#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/release.sh <version> [--push] [--notes-file <path>] [--publish-notes]

Examples:
  npm run release -- 1.3.2
  npm run release -- 1.3.2 --push
  npm run release -- 1.3.2 --push --publish-notes

What it does:
  1. Updates package.json, package-lock.json, and manifest.json to <version>
  2. Runs lint and build
  3. Commits the release and creates a matching git tag
  4. Optionally pushes the commit/tag
  5. Optionally applies RELEASE_NOTES.md to the GitHub release if it already exists
EOF
}

if [[ ${1:-} == "-h" || ${1:-} == "--help" ]]; then
  usage
  exit 0
fi

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

version="$1"
shift

push_release=false
publish_notes=false
notes_file="RELEASE_NOTES.md"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)
      push_release=true
      ;;
    --publish-notes)
      publish_notes=true
      ;;
    --notes-file)
      shift
      if [[ $# -eq 0 ]]; then
        echo "Missing value for --notes-file" >&2
        exit 1
      fi
      notes_file="$1"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
  shift
done

if [[ ! "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "Version must match MAJOR.MINOR.PATCH (for example: 1.3.2)" >&2
  exit 1
fi

if [[ ! -f "$notes_file" ]]; then
  echo "Notes file not found: $notes_file" >&2
  exit 1
fi

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "Working tree is not clean. Commit or stash other changes before releasing." >&2
  exit 1
fi

if git rev-parse "$version" >/dev/null 2>&1; then
  echo "Git tag already exists: $version" >&2
  exit 1
fi

echo "Updating package version to $version"
npm version "$version" --no-git-tag-version --allow-same-version >/dev/null

echo "Updating manifest version to $version"
node - "$version" <<'EOF'
const fs = require("fs");
const version = process.argv[2];
const file = "manifest.json";
const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
manifest.version = version;
fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
EOF

echo "Running lint"
npm run lint

echo "Running build"
npm run build

git add package.json package-lock.json manifest.json "$notes_file"
git commit -m "Release $version"
git tag -a "$version" -m "$version"

echo
echo "Created commit and tag: $version"

if [[ "$push_release" == true ]]; then
  echo "Pushing branch and tag"
  git push origin HEAD
  git push origin "$version"
fi

if [[ "$publish_notes" == true ]]; then
  if ! command -v gh >/dev/null 2>&1; then
    echo "GitHub CLI is not installed; cannot update release notes automatically." >&2
    exit 1
  fi

  if gh release view "$version" >/dev/null 2>&1; then
    gh release edit "$version" --notes-file "$notes_file"
    echo "Updated GitHub release notes for $version"
  else
    echo "GitHub release for $version is not available yet."
    echo "Run this once the release workflow finishes:"
    echo "  gh release edit $version --notes-file $notes_file"
  fi
fi

if [[ "$push_release" == false ]]; then
  echo "Next step: git push origin HEAD && git push origin $version"
fi