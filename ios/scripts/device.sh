#!/bin/zsh
# Builds Relay for the iPhone, signs it by hand and installs it over the
# network, then launches it with Show touches on. The phone needs to be paired
# with this computer once (Xcode › Devices), on the same network, unlocked,
# with Developer Mode on.
#
#   ios/scripts/device.sh [device udid]
#
# Signs with whichever installed provisioning profile lists the phone, hasn't
# expired and has its certificate in the keychain; the bundle id comes from
# that profile. It doesn't go through an Xcode account, so a missing or
# signed-out one doesn't matter. The employer's (TBS) certificates are never used.
# RELAY_IOS_CONFIG=Release builds Release, which has no Show touches.
set -euo pipefail
ios=${0:A:h:h}
config=${RELAY_IOS_CONFIG:-Debug}
derived=${TMPDIR:-/tmp}/relay-ios-device
work=$(mktemp -d)
trap 'rm -rf $work' EXIT

# A phone shows as "connected" or "available (paired)" depending on how it was reached.
device=${1:-$(xcrun devicectl list devices 2>/dev/null | awk '/physical/ && /iPhone[0-9]/ && !/unavailable/ { for (i = 1; i <= NF; i++) if ($i == "(UDID)") { print $(i-1); exit } }')}
[[ -n $device ]] || { echo "No iPhone found. Unlock it and check it's on this network." >&2; exit 1; }

identities=$(security find-identity -v -p codesigning | grep -v -i -e tbs -e 'Lubomir Molin' || true)
for f in ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/*.mobileprovision(N); do
  security cms -D -i $f > $work/profile.plist 2>/dev/null || continue
  read -r appid sha < <(python3 -I - $work/profile.plist $device <<'PY'
import datetime, hashlib, plistlib, sys
p = plistlib.load(open(sys.argv[1], 'rb'))
appid = p['Entitlements']['application-identifier']
ok = ('iOS' in p.get('Platform', [])
  and sys.argv[2] in p.get('ProvisionedDevices', [])
  and p['ExpirationDate'] > datetime.datetime.now()
  and not appid.endswith('*'))
if ok:
  for cert in p['DeveloperCertificates']:
    print(appid, hashlib.sha1(cert).hexdigest().upper())
    break
PY
  ) || continue
  [[ -n ${sha:-} ]] && grep -q $sha <<< $identities && { profile=$f; break; }
  sha=
done
[[ -n ${profile:-} ]] || { echo "No usable provisioning profile for $device. Open ios/Relay.xcodeproj in Xcode once and build to the phone to get a fresh one." >&2; exit 1; }
team=${appid%%.*}
bundle=${appid#*.}

cd $ios
xcodegen generate >/dev/null
xcodebuild -project Relay.xcodeproj -scheme Relay -configuration $config \
  -destination "id=$device" -derivedDataPath $derived \
  PRODUCT_BUNDLE_IDENTIFIER=$bundle CODE_SIGNING_ALLOWED=NO \
  ENABLE_DEBUG_DYLIB=NO ENABLE_PREVIEWS=NO \
  build 2>&1 | grep -E 'error:|BUILD' | sort -u
app=$derived/Build/Products/$config-iphoneos/Relay.app
[[ -d $app ]] || exit 1

cp $profile $app/embedded.mobileprovision
python3 -I - $work/profile.plist $work/entitlements.plist $team.$bundle <<'PY'
import plistlib, sys
e = plistlib.load(open(sys.argv[1], 'rb'))['Entitlements']
e['keychain-access-groups'] = [sys.argv[3]]
plistlib.dump(e, open(sys.argv[2], 'wb'))
PY
for nested in $app/**/*.(dylib|framework|appex)(N); do
  codesign --force --sign $sha $nested
done
codesign --force --sign $sha --entitlements $work/entitlements.plist $app

xcrun devicectl device install app --device $device $app
# Right after an install the phone can refuse the launch for a few seconds
# ("not explicitly trusted", "Unknown application display identifier").
for attempt in 1 2 3 4 5; do
  xcrun devicectl device process launch --terminate-existing --device $device $bundle -- -relay.show-touches YES && exit 0
  sleep 3
done
exit 1
