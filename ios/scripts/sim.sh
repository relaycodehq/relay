#!/bin/zsh
# Builds Relay for a Simulator, installs it and opens it without the launch
# splash, then waits until the screen shows a label instead of sleeping.
#
#   ios/scripts/sim.sh <simulator udid> [--no-build] [--wait "<accessibility label>"]
#
# Builds into Xcode's own DerivedData, where hot reload finds the build log
# (ios/AGENTS.md). A build that worked can still print "error: … failed with
# exit code 0 but produced no further output": xcodebuild's exit status is the
# truth, so that line is dropped here.
set -euo pipefail
ios=${0:A:h:h}
sim=${1:?simulator udid}; shift
build=1 wait=""
while (( $# )); do
  case $1 in
    --no-build) build=0 ;;
    --wait) wait=$2; shift ;;
  esac
  shift
done

cd $ios
if (( build )); then
  # The project is made from project.yml and lists every file, so a new file needs it made again.
  xcodegen generate --use-cache >/dev/null
  log=$(mktemp)
  if ! xcodebuild -project Relay.xcodeproj -scheme Relay -configuration Debug \
      -destination "id=$sim" build -quiet >$log 2>&1; then
    grep -E 'error:' $log | grep -v 'exit code 0 but produced no further output' >&2 || cat $log >&2
    exit 1
  fi
fi
app=$(xcodebuild -project Relay.xcodeproj -scheme Relay -configuration Debug \
  -destination "id=$sim" -showBuildSettings 2>/dev/null | awk '/ CODESIGNING_FOLDER_PATH /{print $3; exit}')
xcrun simctl install $sim "$app"
SIMCTL_CHILD_RELAY_NO_SPLASH=1 xcrun simctl launch --terminate-running-process $sim dev.relay.ios >/dev/null
if [[ -n $wait ]]; then
  # A look at the screen takes axe ~2s, so the limit is in seconds rather than tries.
  SECONDS=0
  until (( SECONDS > 20 )); do
    ui=$(axe describe-ui --udid $sim 2>/dev/null || true)
    [[ $ui == *"\"AXLabel\" : \"$wait\""* ]] && exit 0
  done
  echo "\"$wait\" didn't show within 20s" >&2
  exit 1
fi
