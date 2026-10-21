#!/bin/bash
# Run by launchd every minute: tests a new head of the release-check branch,
# reported as its "Tests" status, then releases the newest v* tag when it's
# new, reported on the tagged commit as the "Release" status. Relay and GitHub
# show both. Pushing to main alone releases nothing.
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

GH_TOKEN="$(cat "$HOME/.config/relay-ci/releases-token" 2>/dev/null || true)"
export GH_TOKEN
report() { # <commit> <context> <state> <description> [<url>]
  gh api -X POST "repos/$REPO/statuses/$1" -f context="$2" -f state="$3" \
    -f description="$4" ${5:+-f target_url="$5"} >/dev/null 2>&1 ||
    echo "Couldn't report $2 $3 on ${1:0:7}."
}
# Failed logs go to a draft release: only people who can push see drafts.
upload_log() { # <log>
  local tag=ci-logs
  gh release view "$tag" --repo "$REPO" >/dev/null 2>&1 ||
    gh release create "$tag" --repo "$REPO" --draft --title "CI logs" \
      --notes "Logs of failed Mac mini builds. A draft, so only collaborators see it." >/dev/null
  gh release upload "$tag" "$1" --repo "$REPO" --clobber >/dev/null &&
    gh release view "$tag" --repo "$REPO" --json url --jq .url
  # Keep the last 10.
  gh release view "$tag" --repo "$REPO" --json assets --jq '.assets | sort_by(.createdAt) | reverse | .[10:][].name' |
    while read -r name; do gh release delete-asset "$tag" "$name" --repo "$REPO" --yes >/dev/null; done
}

# A release's tests, before its tag: a failure here costs a commit, not a version.
check="$(git ls-remote "git@github.com:$REPO.git" refs/heads/release-check | cut -f1)"
if [[ -n "$check" && "$check" != "$(cat "$state/checked" 2>/dev/null)" ]]; then
  log="$ROOT/logs/$(date +%Y-%m-%d-%H%M)-check-${check:0:9}.log"
  echo "$(date '+%F %T') testing ${check:0:7} → $log"
  report "$check" Tests pending "Testing on the Mac mini"
  if "$ROOT/bin/check.sh" "$check" >"$log" 2>&1; then
    report "$check" Tests success "Passed on the Mac mini"
    echo "$(date '+%F %T') tests passed on ${check:0:7}"
  else
    step="$(grep '^==> ' "$log" | tail -1 | cut -c15-)"
    report "$check" Tests failure "Failed at: ${step:-start}" "$(upload_log "$log" 2>/dev/null)"
    echo "$(date '+%F %T') tests FAILED on ${check:0:7} at ${step:-start}, see $log"
  fi
  echo "$check" >"$state/checked"
fi

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

log="$ROOT/logs/$(date +%Y-%m-%d-%H%M)-$tag.log"
echo "$(date '+%F %T') building $tag (${head:0:7}) → $log"
report "$head" Release pending "Building $tag on the Mac mini"
rm -f "$state/website"
if "$ROOT/bin/release.sh" "$tag" >"$log" 2>&1; then
  echo "$build" >"$state/released"
  rm -f "$state/failed"
  version="$(cat "$state/version")"
  case "$(cat "$state/website" 2>/dev/null)" in
    deployed) site="" ;;
    failed) site=", site deploy failed" ;;
    *) site=", site not deployed" ;;
  esac
  report "$head" Release success "Published $version$site" "https://github.com/$REPO/releases/tag/v$version"
  echo "$(date '+%F %T') released $tag (${head:0:7})"
else
  echo "$build" >"$state/failed"
  step="$(grep '^==> ' "$log" | tail -1 | cut -c15-)"
  report "$head" Release failure "Failed at: ${step:-start}" "$(upload_log "$log" 2>/dev/null)"
  echo "$(date '+%F %T') FAILED $tag (${head:0:7}) at ${step:-start}, see $log"
fi
# Keep the last 30 build logs.
ls -1t "$ROOT"/logs/*-*.log 2>/dev/null | tail -n +31 | xargs rm -f
