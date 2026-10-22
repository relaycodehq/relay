#!/usr/bin/env bash
# Runs only against an emulator. A connected physical device is never selected.
set -euo pipefail
cd "$(dirname "$0")/.."
export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
adb="$ANDROID_HOME/platform-tools/adb"
emulator="$ANDROID_HOME/emulator/emulator"
started_pid=""
cleanup() {
  if [[ -n "$started_pid" ]]; then
    "$adb" -s "$serial" emu kill >/dev/null 2>&1 || true
    wait "$started_pid" 2>/dev/null || true
  fi
}
trap cleanup EXIT
serial="${RELAY_TEST_EMULATOR:-}"
if [[ -n "$serial" && "$serial" != emulator-* ]]; then
  echo 'RELAY_TEST_EMULATOR must be an emulator serial.' >&2; exit 2
fi
if [[ -z "$serial" ]]; then
  serial=$("$adb" devices | awk '$1 ~ /^emulator-/ && $2 == "device" {print $1; exit}')
fi
if [[ -z "$serial" ]]; then
  avd="${RELAY_TEST_AVD:-relay-phone-16}"
  if ! "$emulator" -list-avds | grep -Fxq "$avd"; then
    echo "Missing AVD $avd. See docs/scroll-testing.md for setup." >&2; exit 2
  fi
  # Use a free, dedicated port; never stop another task's emulator.
  port=5580
  while "$adb" devices | grep -q "^emulator-$port"; do port=$((port + 2)); done
  serial="emulator-$port"
  "$emulator" -avd "$avd" -port "$port" -no-window -no-audio -no-boot-anim -no-snapshot-save > "${TMPDIR:-/tmp}/relay-scroll-emulator.log" 2>&1 &
  started_pid=$!
fi
booted=false
for ((attempt=0; attempt<120; attempt++)); do
  if [[ "$("$adb" -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" == 1 ]]; then booted=true; break; fi
  if [[ -n "$started_pid" ]] && ! kill -0 "$started_pid" 2>/dev/null; then break; fi
  sleep 1
done
if [[ "$booted" != true ]]; then echo "Emulator $serial did not boot within 120 seconds." >&2; exit 1; fi
export ANDROID_SERIAL="$serial"
# Install explicitly so Gradle never deploys tests to a plugged-in phone.
./gradlew :app:testDebugUnitTest :app:assembleDebug :app:assembleDebugAndroidTest
"$adb" -s "$serial" install -r app/build/outputs/apk/debug/app-debug.apk >/dev/null
"$adb" -s "$serial" install -r app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk >/dev/null
python3 - "$adb" "$serial" <<'PYTEST'
import pathlib, re, subprocess, sys
command = [sys.argv[1], '-s', sys.argv[2], 'shell', 'am', 'instrument', '-w', '-r',
           '-e', 'package', 'dev.relay.android.features.thread',
           'dev.relay.android.test/androidx.test.runner.AndroidJUnitRunner']
try:
    result = subprocess.run(command, capture_output=True, text=True, timeout=600)
except subprocess.TimeoutExpired:
    subprocess.run([sys.argv[1], '-s', sys.argv[2], 'shell', 'am', 'force-stop', 'dev.relay.android'], check=False)
    sys.exit('Scroll instrumentation exceeded 10 minutes; test app stopped.')
output = result.stdout + result.stderr
pathlib.Path('app/build/scroll-test-results.txt').write_text(output)
print(output)
if result.returncode or not re.search(r'OK \([1-9][0-9]* tests?\)', output):
    sys.exit(1)
PYTEST
