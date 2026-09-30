#!/bin/bash
# Releases Relay: an annotated v* tag on main, whose message is the changelog
# friends read in Settings → About and on GitHub. The Mac mini builds any new
# tag (scripts/mini-ci/poll.sh); pushing to main alone ships nothing.
#
#   scripts/tag-release.sh log                  what landed on origin/main since the last release
#   scripts/tag-release.sh <notes.md> [version]  tag origin/main with those notes and push the tag
#
# The version defaults to the last tag's patch plus one.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
git fetch --quiet --tags origin

last="$(git tag -l 'v[0-9]*.[0-9]*.[0-9]*' --merged origin/main |
  sed 's/^v//' | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)"
[[ -n "$last" ]] || { echo "No v* tag on main to start from." >&2; exit 1; }

if [[ "${1:-}" == log ]]; then
  echo "Since v$last:"
  git log --reverse --format='%h %s%n%w(0,4,4)%b' "v$last..origin/main"
  exit 0
fi

notes="${1:?Usage: tag-release.sh log | <notes.md> [version]}"
grep -q '[^[:space:]]' "$notes" || { echo "$notes is empty." >&2; exit 1; }
version="${2:-${last%.*}.$((${last##*.} + 1))}"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "$version isn't X.Y.Z." >&2; exit 1; }
[[ "$(printf '%s\n' "$last" "$version" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)" == "$version" && "$version" != "$last" ]] ||
  { echo "$version isn't newer than v$last." >&2; exit 1; }
[[ -n "$(git rev-list "v$last..origin/main")" ]] || { echo "Nothing on origin/main since v$last." >&2; exit 1; }

# verbatim: the default cleanup would drop Markdown headings as comments.
git tag -a "v$version" origin/main --cleanup=verbatim -F "$notes"
git push --quiet origin "v$version"
echo "Tagged v$version on $(git rev-parse --short origin/main); the Mac mini builds it next."
