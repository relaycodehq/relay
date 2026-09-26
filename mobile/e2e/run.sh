#!/usr/bin/env bash
# Runs e2e/remote.yaml on a booted Android emulator: a throwaway desktop Relay
# (built first: vite build + build-electron in the repo), Metro, Expo Go.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
out="${OUT:-$here/results}"
mkdir -p "$out"

desktop_log="$(mktemp)"
(cd "$repo" && exec env -u RELAY_DEV_URL node tests/fixtures/phone-desktop.mjs \
  --host 10.0.2.2 --port "${PORT:-47901}" >"$desktop_log" 2>&1) &
desktop=$!
metro=""
cleanup() {
  kill "$desktop" 2>/dev/null || true
  [ -n "$metro" ] && kill "$metro" 2>/dev/null || true
}
trap cleanup EXIT

for _ in $(seq 1 90); do grep -q '"url"' "$desktop_log" && break; sleep 1; done
grep -q '"url"' "$desktop_log" || { cat "$desktop_log"; exit 1; }
link="$(node -e 'const l=require("fs").readFileSync(process.argv[1],"utf8").split("\n").find(l=>l.includes("\"url\""));console.log(JSON.parse(l).url.split("?")[1])' "$desktop_log")"

if ! curl -sf http://localhost:8081/status >/dev/null; then
  (cd "$here/.." && exec npx expo start --port 8081 >"$out/metro.log" 2>&1) &
  metro=$!
  for _ in $(seq 1 90); do curl -sf http://localhost:8081/status >/dev/null && break; sleep 1; done
fi

# Expo Go opens the app from Metro; the emulator reaches this computer at 10.0.2.2.
maestro test "$here/remote.yaml" \
  -e PAIR_LINK="exp://10.0.2.2:8081/--/pair?$link" \
  -e OUT="$out"
