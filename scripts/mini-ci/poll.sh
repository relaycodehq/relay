#!/bin/bash
# Run by launchd every minute: releases the newest v* tag when it's new, and
# reports the build on the tagged commit as the "Release" status, which Relay
# and GitHub show. Pushing to main alone releases nothing.
# A tag that fails isn't retried unless it moves to another commit; delete
# state/failed to try the same one again.
set -uo pipefail

ROOT="$HOME/relay-ci.noindex"
REPO="relaycodehq/relay"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
state="$ROOT/state"
mkdir -p "$state" "$ROOT/logs"

# launchd never overlaps runs; this guards against a manual run alongside.
exec 9>"$state/lock"
/usr/bin/lockf -t 0 9 || exit 0

refs="$(git ls-remote --tags "git@github.com:$REPO.git" 'refs/tags/v*')"
tag="$(awk '$2 ~ /^refs\/tags\/v[0-9]+\.[0-9]+\.[0-9]+$/ { sub("refs/tags/v", "", $2); print $2 }' <<<"$refs" |
  sort -t. -k1,1n -k2,2n -k3,3n | tail -1)"
[[ -n "$tag" ]] || exit 0
tag="v$tag"
# An annotated tag lists its commit on a peeled ^{} line; a lightweight one is the commit itself.
head="$(awk -v ref="refs/tags/$tag^{}" '$2 == ref { print $1 }' <<<"$refs")"
[[ -n "$head" ]] || head="$(awk -v ref="refs/tags/$tag" '$2 == ref { print $1 }' <<<"$refs")"
build="$tag $head"
[[ "$build" == "$(cat "$state/released" 2>/dev/null)" || "$build" == "$(cat "$state/failed" 2>/dev/null)" ]] && exit 0

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
  gh release view "$tag" --repo "$REPO" >/dev/null 2>&1 ||
    gh release create "$tag" --repo "$REPO" --draft --title "CI logs" \
      --notes "Logs of failed Mac mini builds. A draft, so only collaborators see it." >/dev/null
  gh release upload "$tag" "$log" --repo "$REPO" --clobber >/dev/null &&
    gh release view "$tag" --repo "$REPO" --json url --jq .url
  # Keep the last 10.
  gh release view "$tag" --repo "$REPO" --json assets --jq '.assets | sort_by(.createdAt) | reverse | .[10:][].name' |
    while read -r name; do gh release delete-asset "$tag" "$name" --repo "$REPO" --yes >/dev/null; done
}

log="$ROOT/logs/$(date +%Y-%m-%d-%H%M)-$tag.log"
echo "$(date '+%F %T') building $tag (${head:0:7}) → $log"
report pending "Building $tag on the Mac mini"
if "$ROOT/bin/release.sh" "$tag" >"$log" 2>&1; then
  echo "$build" >"$state/released"
  rm -f "$state/failed"
  version="$(cat "$state/version")"
  report success "Published $version" "https://github.com/$REPO/releases/tag/v$version"
  echo "$(date '+%F %T') released $tag (${head:0:7})"
else
  echo "$build" >"$state/failed"
  step="$(grep '^==> ' "$log" | tail -1 | cut -c15-)"
  report failure "Failed at: ${step:-start}" "$(upload_log 2>/dev/null)"
  echo "$(date '+%F %T') FAILED $tag (${head:0:7}) at ${step:-start}, see $log"
fi
# Keep the last 30 build logs.
ls -1t "$ROOT"/logs/*-*.log 2>/dev/null | tail -n +31 | xargs rm -f
