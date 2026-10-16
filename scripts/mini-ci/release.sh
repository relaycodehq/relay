#!/bin/bash
# Builds one release tag into a Relay release and publishes it to the releases
# repo: Mac, Windows, Linux and the Android app, all on the Mac mini.
# poll.sh runs it for every new v* tag. The tag names the version and its
# message is the release notes; scripts/tag-release.sh makes one.
#
#   release.sh <vX.Y.Z> [--dry-run]
#
# --dry-run builds everything and stops before touching the releases repo.
set -euo pipefail

ROOT="$HOME/relay-ci.noindex"
REPO_URL="git@github.com:relaycodehq/relay.git"
RELEASES_REPO="relaycodehq/relay"
SIGNING="$HOME/.config/relay-android/signing.env"
TOKEN_FILE="$HOME/.config/relay-ci/releases-token"
# Signs latest.json; installs refuse a feed without a signature from it.
UPDATE_KEY="$HOME/.config/relay-ci/update-signing-key.pem"
# CLOUDFLARE_API_TOKEN (Workers edit) and CLOUDFLARE_ACCOUNT_ID, for relaycode.io.
CLOUDFLARE="$HOME/.config/relay-ci/cloudflare.env"

dry_run=0
args=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    *) args+=("$arg") ;;
  esac
done
tag="${args[0]:?Usage: release.sh <vX.Y.Z> [--dry-run]}"
[[ "$tag" =~ ^v([0-9]+)\.([0-9]+)\.([0-9]+)$ ]] || { echo "$tag isn't a vX.Y.Z tag." >&2; exit 1; }
version="${tag#v}"
major="${BASH_REMATCH[1]}" minor="${BASH_REMATCH[2]}" patch="${BASH_REMATCH[3]}"

export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export JAVA_HOME="$ROOT/jdk21/Contents/Home"
export ANDROID_HOME="$ROOT/android-sdk"
export GRADLE_USER_HOME="$ROOT/gradle"
export NODE_OPTIONS="--max-old-space-size=3072"
export npm_config_fund=false npm_config_audit=false npm_config_update_notifier=false
if [[ -f "$TOKEN_FILE" ]]; then
  GH_TOKEN="$(<"$TOKEN_FILE")"
  export GH_TOKEN
elif ((!dry_run)); then
  echo "No releases token at $TOKEN_FILE." >&2
  exit 1
fi

step() { printf '\n==> %s  %s\n' "$(date '+%H:%M:%S')" "$*"; }

src="$ROOT/src"
out="$ROOT/out"

step "Checking out $tag"
[[ -d "$src/.git" ]] || git clone --quiet "$REPO_URL" "$src"
cd "$src"
# --force: a tag moved to another commit on GitHub moves here too.
git fetch --quiet --force --tags origin
git checkout --quiet --force --detach "$tag"
# node_modules survive between builds; installs below redo them when the lockfile changes.
git clean -ffdxq -e node_modules -e packaging/checks-typescript/node_modules
rm -rf "$out" && mkdir -p "$out"

# The mini is short on disk: drop what a build leaves beyond its installers.
tidy() {
  rm -rf release android/app/build android/build
}
tidy

step "Checking $tag"
fail() { echo "$tag $*" >&2; exit 1; }
# A lightweight tag has no message, so no release notes.
[[ "$(git cat-file -t "refs/tags/$tag")" == tag ]] ||
  fail "is a lightweight tag. Tag with git tag -a, the message is the release notes."
git merge-base --is-ancestor "$tag^{commit}" origin/main ||
  fail "points at a commit that isn't on main."
latest="$(gh api "repos/$RELEASES_REPO/releases/latest" --jq .tag_name 2>/dev/null || true)"
if [[ -n "$latest" ]] &&
  [[ "$(printf '%s\n' "${latest#v}" "$version" | sort -t. -k1,1n -k2,2n -k3,3n | tail -1)" != "$version" || "$latest" == "$tag" ]]; then
  fail "isn't newer than the published $latest."
fi
git tag -l --format='%(contents)' "$tag" | sed '/^-----BEGIN PGP SIGNATURE-----$/,$d' >"$ROOT/notes.md"
grep -q '[^[:space:]]' "$ROOT/notes.md" || fail "has an empty message; it's the release notes."
# A dry run without the key builds unsigned; a real one fails here, before the build.
if [[ -f "$UPDATE_KEY" ]] || ((!dry_run)); then
  node scripts/sign-update-feed.mjs --check --key "$UPDATE_KEY"
fi
echo "$version" >"$ROOT/state/version"
cat "$ROOT/notes.md"

# Linux builds in Docker; boot it now so it's up by the time that starts.
docker_was_running=1
if ! docker info >/dev/null 2>&1; then
  docker_was_running=0
  open -a Docker
fi
linux_pid=""
cleanup() {
  if [[ -n "$linux_pid" ]] && kill -0 "$linux_pid" 2>/dev/null; then
    kill "$linux_pid" 2>/dev/null || true
    docker rm -f relay-ci-linux >/dev/null 2>&1 || true
  fi
  ((docker_was_running)) || osascript -e 'quit app "Docker Desktop"' >/dev/null 2>&1 || true
}
trap cleanup EXIT

install() { # <dir>: npm ci, skipped while the lockfile is unchanged
  local stamp="$1/node_modules/.relay-ci-lock" hash
  hash="$(shasum -a 256 "$1/package-lock.json" | cut -d' ' -f1)"
  [[ -f "$stamp" && "$(<"$stamp")" == "$hash" ]] && return
  (cd "$1" && npm ci)
  echo "$hash" >"$stamp"
}
step "Installing dependencies"
install .
# Electron 44 fetches its binary on first use instead of at install. Fetch it
# here, or two test workers race to unpack it into the same folder.
node -e 'require("electron")' >/dev/null

node scripts/sync-version.mjs "$version"

step "Building"
npm run build

# In an x64 container under Rosetta. Sources go in and installers come out as
# tar streams: a shared mount drops executable bits and breaks the AppImage.
# Runs alongside the tests and the other platforms; it only reads dist and
# tracked files, which nothing after this point changes.
build_linux() {
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 3; done
  # dist/ is the same on every platform, so only the Electron side is rebuilt.
  { git ls-files -z | tar --null -T - -cf - dist; } |
    docker run --rm -i --name relay-ci-linux --platform linux/amd64 \
      -v relay-ci-npm:/root/.npm -v relay-ci-cache:/root/.cache \
      -e VERSION="$version" -e npm_config_fund=false -e npm_config_audit=false \
      -e ONNXRUNTIME_NODE_INSTALL=skip \
      electronuserland/builder:22 bash -c '
        set -euo pipefail
        exec 3>&1 1>&2
        mkdir /work && cd /work && tar -xf -
        npm ci
        node scripts/sync-version.mjs "$VERSION"
        node scripts/build-electron.mjs
        npx electron-builder --linux AppImage dir --x64 --publish never
        python3 scripts/package-omarchy.py
        tar -C release -cf - "Relay-$VERSION-linux-x86_64.AppImage" "Relay-$VERSION-omarchy-x86_64.tar.gz" >&3
      ' | tar -xf - -C "$out"
}
linux_log="$ROOT/linux.log"
step "Linux, in the background"
build_linux >"$linux_log" 2>&1 &
linux_pid=$!

step "Testing"
# Flagged, not blocking, as on GitHub: a formatting slip shouldn't hold back a release.
npm run format:check || echo "Formatting check failed (not blocking)."
npm run test:setup
npx vitest run --maxWorkers=2
python3 -m unittest discover -s tests/packaging

step "Headless"
# One archive for every platform.
node scripts/package-headless.mjs "$version"
cp "release/Relay-$version-headless.tar.gz" release/install-relay.sh release/install-relay.ps1 "$out/"

step "Mac"
npx electron-builder --mac --publish never
cp "release/Relay-$version-mac-arm64.zip" "release/Relay-$version-mac-arm64.dmg" "$out/"

step "Windows"
# electron-builder makes the NSIS installer on macOS without Wine; only the
# native modules have to be swapped for Windows builds.
rm -rf dist-electron/node-pty/prebuilds dist-electron/sherpa/sherpa-onnx-darwin-* dist-electron/onnxruntime/bin/napi-v6/darwin
mkdir -p dist-electron/node-pty/prebuilds dist-electron/onnxruntime/bin/napi-v6/win32
cp -R node_modules/onnxruntime-node/bin/napi-v6/win32/x64 dist-electron/onnxruntime/bin/napi-v6/win32/
cp -R node_modules/node-pty/prebuilds/win32-x64 dist-electron/node-pty/prebuilds/
find dist-electron/node-pty/prebuilds -name '*.pdb' -delete
sherpa_version="$(node -p 'require("./node_modules/sherpa-onnx-node/package.json").version')"
sherpa_integrity="$(node -p "require('./package-lock.json').packages['node_modules/sherpa-onnx-win-x64']?.integrity ?? ''")"
pack="$(mktemp -d)"
(cd "$pack" && npm pack --silent "sherpa-onnx-win-x64@$sherpa_version" >/dev/null)
tarball="$(ls "$pack"/*.tgz)"
if [[ -n "$sherpa_integrity" ]]; then
  actual="sha512-$(openssl dgst -sha512 -binary "$tarball" | base64)"
  [[ "$actual" == "$sherpa_integrity" ]] || { echo "sherpa-onnx-win-x64 doesn't match the lockfile." >&2; exit 1; }
fi
mkdir -p dist-electron/sherpa/sherpa-onnx-win-x64
tar -xzf "$tarball" -C dist-electron/sherpa/sherpa-onnx-win-x64 --strip-components 1
find dist-electron/sherpa/sherpa-onnx-win-x64 \( -name '*.md' -o -name '*.lib' -o -name '*.h' \) -delete
rm -rf "$pack"
npx electron-builder --win --x64 --publish never
cp "release/Relay-$version-win-x64.exe" "$out/"

step "Linux"
linux_ok=1
wait "$linux_pid" || linux_ok=0
linux_pid=""
cat "$linux_log" && rm -f "$linux_log"
((linux_ok)) || { echo "The Linux build failed." >&2; exit 1; }
# Docker's VM would sit on 4 GB through the Android build.
((docker_was_running)) || osascript -e 'quit app "Docker Desktop"' >/dev/null 2>&1 || true
docker_was_running=1

step "Android"
set -a && . "$SIGNING" && set +a
(
  cd android
  # Grows with every version, minor and major bumps included: 0.1.37 → 1037.
  export RELAY_VERSION="$version" RELAY_VERSION_CODE="$((major * 1000000 + minor * 1000 + patch))"
  # Not taskpolicy -b: macOS starves background work while anything else runs.
  ./gradlew :app:assembleRelease --console=plain --no-daemon --max-workers=2 \
    -Dorg.gradle.jvmargs="-Xmx3g -XX:MaxMetaspaceSize=1g" -Pkotlin.daemon.jvmargs=-Xmx1g
)
cp android/app/build/outputs/apk/release/app-release.apk "$out/Relay-Android.apk"

node scripts/release-manifest.mjs "$out" "$version" "$RELEASES_REPO" "$(cat "$ROOT/notes.md")"
if [[ -f "$UPDATE_KEY" ]] || ((!dry_run)); then
  node scripts/sign-update-feed.mjs "$out/latest.json" --key "$UPDATE_KEY"
fi
ls -l "$out"

tidy
if ((dry_run)); then
  step "Dry run: $version built, nothing published"
  exit 0
fi

step "Publishing $version"
gh release view "$tag" --repo "$RELEASES_REPO" >/dev/null 2>&1 ||
  gh release create "$tag" --repo "$RELEASES_REPO" --draft --title "Relay $version" --notes ""
# Nobody sees the draft until the edit below publishes it.
(cd "$out" && gh release upload "$tag" --repo "$RELEASES_REPO" --clobber $(ls | grep -v -E '^latest\.json(\.sig)?$'))
# The feed goes up only with its signature, after the files it points at.
[[ -s "$out/latest.json.sig" ]] || fail "has no latest.json.sig; installs would refuse latest.json."
gh release upload "$tag" "$out/latest.json.sig" "$out/latest.json" --repo "$RELEASES_REPO" --clobber
gh release edit "$tag" --repo "$RELEASES_REPO" --draft=false --latest \
  --title "Relay $version" --notes-file "$ROOT/notes.md"
rm -rf "$out"
step "Published $version"

# The site is built from the tag: it names this version and links its files.
# The release is public by now, so a failed deploy only shows in the status.
step "Deploying relaycode.io"
if [[ ! -f "$CLOUDFLARE" ]]; then
  echo "No Cloudflare token at $CLOUDFLARE; the site keeps its old version."
  echo skipped >"$ROOT/state/website"
# Only what npm and wrangler need: the signing passwords and GH_TOKEN this
# script exported stay out of a package fetched from npm.
elif (. "$CLOUDFLARE" && env -i PATH="$PATH" HOME="$HOME" \
  CLOUDFLARE_API_TOKEN="${CLOUDFLARE_API_TOKEN:-}" \
  CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-}" \
  npm run deploy:website); then
  echo deployed >"$ROOT/state/website"
else
  echo failed >"$ROOT/state/website"
fi
rm -rf dist-website
