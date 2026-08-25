#!/usr/bin/env bash
# Deploys dist/ to the gh-pages worktree at /tmp/ops-tracker-gh-pages and
# pushes it live.
#
# Deliberately does NOT delete the assets/ directory first. Vite
# content-hashes every filename, so old and new bundles never collide —
# but GitHub Pages caches index.html for ~10 minutes (Cache-Control:
# max-age=600), so a browser can still be holding an old index.html that
# points at an old hash for a while after a new deploy goes out. If that
# old hash has been deleted, the page 404s on its own JS bundle and never
# boots — this happened for real once (silent failure, ~5 min of a blank
# "loading" tab before the user noticed). Keeping old bundles around costs
# ~220KB per deploy and means a stale tab always finds what it's asking
# for until it naturally reloads onto the new one.
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREE_DIR="/tmp/ops-tracker-gh-pages"

if [ ! -d "$WORKTREE_DIR" ]; then
  echo "Expected gh-pages worktree at $WORKTREE_DIR — not found." >&2
  exit 1
fi

cd "$REPO_DIR"
npm run build

cd "$WORKTREE_DIR"
rm -f index.html
cp -r "$REPO_DIR/dist/." .

git add -A
if git diff --cached --quiet; then
  echo "Nothing changed — dist/ is identical to what's already deployed."
  exit 0
fi

MSG="${1:-Deploy}"
git commit -m "Deploy: $MSG" -q
git push origin gh-pages
