#!/bin/zsh
# Builds Relay for a paired iPhone and installs it over the network: no cable
# once the phone is paired with this computer (Xcode › Devices, or
# `xcrun devicectl manage pair`), on the same network, unlocked, with
# Developer Mode on.
#
#   ios/scripts/device.sh [device udid or name]
#
# Signs with the team in RELAY_IOS_TEAM (Brain Fuel by default) under
# RELAY_IOS_BUNDLE; the Simulator build keeps dev.relay.ios and no team.
set -euo pipefail
ios=${0:A:h:h}
team=${RELAY_IOS_TEAM:-N43VNP65G7}
bundle=${RELAY_IOS_BUNDLE:-cz.brainfuel.relay}
device=${1:-$(xcrun devicectl list devices 2>/dev/null | awk '/available \(paired\)/ && /iPhone[0-9]/ { for (i = 1; i <= NF; i++) if ($i == "(UDID)") { print $(i-1); exit } }')}
[[ -n $device ]] || { echo "No paired iPhone is available. Unlock it and check it's on this network." >&2; exit 1; }
derived=${TMPDIR:-/tmp}/relay-ios-device

cd $ios
xcodegen generate >/dev/null
xcodebuild -project Relay.xcodeproj -scheme Relay -configuration Release \
  -destination "id=$device" -derivedDataPath $derived \
  -allowProvisioningUpdates -allowProvisioningDeviceRegistration \
  DEVELOPMENT_TEAM=$team PRODUCT_BUNDLE_IDENTIFIER=$bundle CODE_SIGN_STYLE=Automatic \
  build 2>&1 | grep -E 'error:|warning: .*(provision|sign)|BUILD' | sort -u
app=$derived/Build/Products/Release-iphoneos/Relay.app
xcrun devicectl device install app --device $device $app
xcrun devicectl device process launch --device $device $bundle
