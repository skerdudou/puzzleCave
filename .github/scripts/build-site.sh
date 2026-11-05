#!/usr/bin/env bash
# Builds the site published on GitHub Pages (.github/workflows/pages.yml) into the folder $1:
# the latest release (the highest v* tag) at the root and the preview of main in
# preview-$PREVIEW_DIR/ (DEVELOPMENT.md › Preview of `main`).
#
# Run from the repository root, with its history and tags, dependencies installed (npm ci).
# Environment:
#   PREVIEW_DIR  the preview's secret folder name (letters, digits, - and _); empty: the release
#                alone, with a warning (the preview is never published at a guessable path)
#   PREVIEW_REF  the commit built as the preview (default: HEAD)
# The folder name is never printed.
set -euo pipefail

site=${1:?usage: build-site.sh <site folder>}
preview_dir=${PREVIEW_DIR:-}
preview_ref=${PREVIEW_REF:-HEAD}
root=$(pwd)
work=$(mktemp -d)
worktrees=()
cleanup() {
  for w in "${worktrees[@]}"; do git -C "$root" worktree remove --force "$w" || true; done
  rm -rf "$work"
}
trap cleanup EXIT

# Builds the game at <commit> into <out>, with the environment given after them (VAR=value…):
# in place when <commit> is the one checked out, else in a worktree of its own, with its own
# dependencies.
build() {
  local commit out dir
  commit=$(git rev-parse --verify "$1^{commit}")
  out=$2
  shift 2
  if [ "$commit" = "$(git rev-parse HEAD)" ]; then
    dir=$root
  else
    dir=$work/src-${#worktrees[@]}
    git worktree add --detach --quiet "$dir" "$commit"
    worktrees+=("$dir")
    (cd "$dir" && npm ci --no-audit --no-fund)
  fi
  (cd "$dir" && env "$@" npm run build)
  mkdir -p "$out"
  cp -R "$dir/packages/game/dist/." "$out/"
}

release=$(git tag --list 'v*' --sort=-v:refname | head -n 1)
if [ -z "$release" ]; then
  echo "::error::no v* tag: there is no release to publish"
  exit 1
fi

rm -rf "$site"
echo "Release $release at the root"
build "$release" "$site"

if [ -z "$preview_dir" ]; then
  echo "::warning::The PREVIEW_DIR secret is not set: the release is published alone, without the preview of main (DEVELOPMENT.md › Preview of main)."
elif ! [[ $preview_dir =~ ^[A-Za-z0-9_-]+$ ]]; then
  echo "::warning::The PREVIEW_DIR secret holds characters other than letters, digits, - and _: the release is published alone, without the preview of main."
else
  sha=$(git rev-parse --short=7 "$preview_ref")
  echo "Preview of main ($sha) in its folder"
  out=$site/preview-$preview_dir
  build "$preview_ref" "$out" VITE_PREVIEW=1 "VITE_PREVIEW_SHA=$sha"
  # what keeps the preview apart from the release: checked before anything is published
  fail() {
    echo "::error::$1"
    exit 1
  }
  grep -q 'name="robots" content="noindex, nofollow"' "$out/index.html" ||
    fail "the preview's index.html is not marked noindex"
  grep -qF '"name":"puzzleCave (preview)"' "$out/manifest.webmanifest" ||
    fail "the preview's manifest is not named puzzleCave (preview)"
  grep -rqF 'puzzlecave.preview.save.v1' "$out/assets" ||
    fail "the preview does not save under its own key"
  if grep -q 'name="robots"' "$site/index.html"; then fail "the release's index.html is marked noindex"; fi
  # the saved solutions: bundled in the preview (its author mode replays them), never in the release
  grep -rqF '# optimal (proven)' "$out/assets" ||
    fail "the preview does not bundle the saved solutions"
  if grep -rqF '# optimal (proven)' "$site/assets"; then fail "the release bundles the saved solutions"; fi
fi
