#!/bin/bash
# Copies the release pipeline to the Mac mini and (re)loads its launchd job.
#
#   scripts/mini-ci/install.sh <user@host>
#
# The toolchain (Node 22, JDK 17, Android SDK, Docker Desktop) and the secrets
# in ~/.config/relay-ci and ~/.config/relay-android are set up once by hand.
set -euo pipefail
host="${1:?usage: scripts/mini-ci/install.sh <user@host>}"
here="$(cd "$(dirname "$0")" && pwd)"

ssh "$host" 'mkdir -p ~/relay-ci.noindex/bin ~/relay-ci.noindex/logs'
scp -q "$here/release.sh" "$here/poll.sh" "$here/cap-native-jobs.gradle" "$host:relay-ci.noindex/bin/"
ssh "$host" 'chmod +x ~/relay-ci.noindex/bin/*.sh
  plist=~/Library/LaunchAgents/dev.relay.ci.plist
  sed "s|HOME_DIR|$HOME|g" >"$plist"
  launchctl bootout gui/$(id -u) "$plist" 2>/dev/null || true
  launchctl bootstrap gui/$(id -u) "$plist"
  launchctl print gui/$(id -u)/dev.relay.ci | grep -E "state|run interval"' <"$here/dev.relay.ci.plist"
