#!/bin/bash
# Run by launchd every minute: releases main when it has moved, and reports
# each build on the commit as the "Release" status, which Relay and GitHub show.
# A commit that fails isn't retried; delete state/failed to try it again.
set -uo pipefail

ROOT="$HOME/relay-ci.noindex"
REPO="lubomirmolin/relay"
RELEASES_REPO="lubomirmolin/relay-releases"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
state="$ROOT/state"
mkdir -p "$state" "$ROOT/logs"

# launchd never overlaps runs; this guards against a manual run alongside.
exec 9>"$state/lock"
/usr/bin/lockf -t 0 9 || exit 0

head="$(git ls-remote "git@github.com:$REPO.git" refs/heads/main | cut -f1)"
[[ -n "$head" ]] || exit 0
last="$(cat "$state/released" 2>/dev/null || true)"
[[ "$head" == "$last" || "$head" == "$(cat "$state/failed" 2>/dev/null)" ]] && exit 0

GH_TOKEN="$(cat "$HOME/.config/relay-ci/releases-token" 2>/dev/null || true)"
export GH_TOKEN
report() { # <state> <description> [<url>]
  gh api -X POST "repos/$REPO/statuses/$head" -f context=Release -f state="$1" \
    -f description="$2" ${3:+-f target_url="$3"} >/dev/null 2>&1 ||
    echo "Couldn't report $1 on ${head:0:7}."
}
# Failed logs go to a draft release: only people who can push see drafts.
upload_log() {
  local tag=ci-logs
  gh release view "$tag" --repo "$RELEASES_REPO" >/dev/null 2>&1 ||
    gh release create "$tag" --repo "$RELEASES_REPO" --draft --title "CI logs" \
      --notes "Logs of failed Mac mini builds. A draft, so only collaborators see it." >/dev/null
  gh release upload "$tag" "$log" --repo "$RELEASES_REPO" --clobber >/dev/null &&
    gh release view "$tag" --repo "$RELEASES_REPO" --json url --jq .url
  # Keep the last 10.
  gh release view "$tag" --repo "$RELEASES_REPO" --json assets --jq '.assets | sort_by(.createdAt) | reverse | .[10:][].name' |
    while read -r name; do gh release delete-asset "$tag" "$name" --repo "$RELEASES_REPO" --yes >/dev/null; done
}

log="$ROOT/logs/$(date +%Y-%m-%d-%H%M)-${head:0:7}.log"
echo "$(date '+%F %T') building ${head:0:7} → $log"
report pending "Building on the Mac mini"
if "$ROOT/bin/release.sh" "$head" $last >"$log" 2>&1; then
  echo "$head" >"$state/released"
  rm -f "$state/failed"
  version="$(cat "$state/version")"
  report success "Published $version" "https://github.com/$RELEASES_REPO/releases/tag/v$version"
  echo "$(date '+%F %T') released ${head:0:7} as $version"
else
  echo "$head" >"$state/failed"
  step="$(grep '^==> ' "$log" | tail -1 | cut -c15-)"
  report failure "Failed at: ${step:-start}" "$(upload_log 2>/dev/null)"
  echo "$(date '+%F %T') FAILED ${head:0:7} at ${step:-start}, see $log"
fi
# Keep the last 30 build logs.
ls -1t "$ROOT"/logs/*-*.log 2>/dev/null | tail -n +31 | xargs rm -f
