#!/bin/bash
# Builds one commit into a Relay release and publishes it to the releases
# repo: Mac, Windows, Linux, the phone bundle and the APK, all on the Mac mini.
# poll.sh runs it for every new commit on main.
#
#   release.sh <commit> [<previous released commit>] [--dry-run]
#
# --dry-run builds everything and stops before touching the releases repo.
set -euo pipefail

ROOT="$HOME/relay-ci.noindex"
REPO_URL="git@github.com:lubomirmolin/relay.git"
RELEASES_REPO="lubomirmolin/relay-releases"
SIGNING="$HOME/.config/relay-android/signing.env"
TOKEN_FILE="$HOME/.config/relay-ci/releases-token"

dry_run=0
args=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry_run=1 ;;
    *) args+=("$arg") ;;
  esac
done
commit="${args[0]:?Usage: release.sh <commit> [<previous commit>] [--dry-run]}"
previous="${args[1]:-}"

export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export JAVA_HOME="$ROOT/jdk/Contents/Home"
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

step "Checking out $commit"
[[ -d "$src/.git" ]] || git clone --quiet "$REPO_URL" "$src"
cd "$src"
git fetch --quiet origin
git checkout --quiet --force --detach "$commit"
# node_modules survive between builds; installs below redo them when the lockfile changes.
git clean -ffdxq -e node_modules -e mobile/node_modules -e packaging/checks-typescript/node_modules
rm -rf "$out" && mkdir -p "$out"

# The mini is short on disk: drop what a build leaves beyond its installers,
# including native build output inside node_modules (APKs are rebuilt rarely).
tidy() {
  rm -rf release mobile/android
  find mobile/node_modules -type d \( -path '*/android/build' -o -path '*/android/.cxx' \) -prune -exec rm -rf {} + 2>/dev/null || true
}
tidy

# major.minor from package.json, the patch one past the newest release.
line="$(node -p 'require("./package.json").version.split(".").slice(0,2).join(".")')"
last_patch="$(gh api "repos/$RELEASES_REPO/releases?per_page=100" --jq '.[].tag_name' |
  sed -nE "s/^v${line//./\\.}\.([0-9]+)$/\1/p" | sort -n | tail -1)"
patch=$((${last_patch:-0} + 1))
version="$line.$patch"
echo "$version" >"$ROOT/state/version"
step "Version $version"

install() { # <dir>: npm ci, skipped while the lockfile is unchanged
  local stamp="$1/node_modules/.relay-ci-lock" hash
  hash="$(shasum -a 256 "$1/package-lock.json" | cut -d' ' -f1)"
  [[ -f "$stamp" && "$(<"$stamp")" == "$hash" ]] && return
  (cd "$1" && npm ci)
  echo "$hash" >"$stamp"
}
step "Installing dependencies"
install .
install mobile

npm version "$version" --no-git-tag-version --allow-same-version >/dev/null

step "Building"
npm run build

step "Testing"
# Flagged, not blocking, as on GitHub: a formatting slip shouldn't hold back a release.
npm run format:check || echo "Formatting check failed (not blocking)."
npm run test:setup
npx vitest run --maxWorkers=2
python3 -m unittest discover -s tests/packaging

step "Phone bundle"
node scripts/export-phone-bundle.mjs "$version"

step "Mac"
npx electron-builder --mac --publish never
cp "release/Relay-$version-mac-arm64.zip" "release/Relay-$version-mac-arm64.dmg" "$out/"

step "Windows"
# electron-builder makes the NSIS installer on macOS without Wine; only the
# native modules have to be swapped for Windows builds.
rm -rf dist-electron/node-pty/prebuilds dist-electron/sherpa/sherpa-onnx-darwin-*
mkdir -p dist-electron/node-pty/prebuilds
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
# In an x64 container under Rosetta. Sources go in and installers come out as
# tar streams: a shared mount drops executable bits and breaks the AppImage.
docker_was_running=1
if ! docker info >/dev/null 2>&1; then
  docker_was_running=0
  open -a Docker
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 3; done
fi
quit_docker() { ((docker_was_running)) || osascript -e 'quit app "Docker Desktop"' >/dev/null 2>&1 || true; }
trap quit_docker EXIT
# dist/ is the same on every platform, so only the Electron side is rebuilt.
{ git ls-files -z | tar --null -T - -cf - dist dist-phone; } |
  docker run --rm -i --platform linux/amd64 \
    -v relay-ci-npm:/root/.npm -v relay-ci-cache:/root/.cache \
    -e VERSION="$version" -e npm_config_fund=false -e npm_config_audit=false \
    electronuserland/builder:22 bash -c '
      set -euo pipefail
      exec 3>&1 1>&2
      mkdir /work && cd /work && tar -xf -
      npm ci
      npm version "$VERSION" --no-git-tag-version --allow-same-version >/dev/null
      node scripts/build-electron.mjs
      npx electron-builder --linux AppImage dir --x64 --publish never
      python3 scripts/package-omarchy.py
      tar -C release -cf - "Relay-$VERSION-linux-x86_64.AppImage" "Relay-$VERSION-omarchy-x86_64.tar.gz" >&3
    ' | tar -xf - -C "$out"
quit_docker
trap - EXIT

step "Android"
runtime="$(node mobile/scripts/runtime.mjs)"
apk="$out/Relay-Android.apk"
previous_apk="$(mktemp -d)"
# The APK only changes with the native side; otherwise the last one carries on.
if gh release download --repo "$RELEASES_REPO" --pattern Relay-Android.apk --dir "$previous_apk" 2>/dev/null &&
  [[ "$(unzip -p "$previous_apk/Relay-Android.apk" assets/app.config 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).extra?.relayRuntime??""))')" == "$runtime" ]]; then
  echo "Native side unchanged ($runtime): reusing the last APK."
  mv "$previous_apk/Relay-Android.apk" "$apk"
else
  set -a && . "$SIGNING" && set +a
  (
    cd mobile
    export RELAY_VERSION="$version" RELAY_VERSION_CODE="$patch" RELAY_RUNTIME="$runtime"
    CI=1 npx expo prebuild --platform android --no-install --clean
    cd android
    # At most two native compiles per worker. Not taskpolicy -b: macOS starves
    # background work while anything else runs, and the build took 40 minutes, not 4.
    ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain \
      --no-daemon --max-workers=2 --init-script "$ROOT/bin/cap-native-jobs.gradle" -Dorg.gradle.jvmargs="-Xmx3g -XX:MaxMetaspaceSize=1g" \
      -Pkotlin.daemon.jvmargs=-Xmx1g
  )
  cp mobile/android/app/build/outputs/apk/release/app-release.apk "$apk"
fi
rm -rf "$previous_apk"

# The commit's message without trailers like Co-Authored-By; subjects when several commits land at once.
without_trailers() { sed -E '/^[A-Za-z-]+: .*<[^>]*@[^>]*>$/d' | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'; }
if [[ -n "$previous" ]] && [[ "$(git rev-list --count "$previous..$commit" 2>/dev/null || echo 1)" -gt 1 ]]; then
  git log --reverse --format='- %s' "$previous..$commit" >"$ROOT/notes.md"
else
  git log -1 --format=%B "$commit" | without_trailers >"$ROOT/notes.md"
fi
node scripts/release-manifest.mjs "$out" "$version" "$RELEASES_REPO" "$(cat "$ROOT/notes.md")"
ls -l "$out"

tidy
if ((dry_run)); then
  step "Dry run: $version built, nothing published"
  exit 0
fi

step "Publishing $version"
tag="v$version"
gh release view "$tag" --repo "$RELEASES_REPO" >/dev/null 2>&1 ||
  gh release create "$tag" --repo "$RELEASES_REPO" --draft --title "Relay $version" --notes ""
# Nobody sees the draft until the edit below publishes it.
(cd "$out" && gh release upload "$tag" --repo "$RELEASES_REPO" --clobber $(ls | grep -v '^latest\.json$'))
gh release upload "$tag" "$out/latest.json" --repo "$RELEASES_REPO" --clobber
gh release edit "$tag" --repo "$RELEASES_REPO" --draft=false --latest \
  --title "Relay $version" --notes-file "$ROOT/notes.md"
rm -rf "$out"
step "Published $version"
