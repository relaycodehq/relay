# Sourced by release.sh and check.sh: the mini's toolchain, the checkout they
# share, and the test run a release has to pass.

ROOT="$HOME/relay-ci.noindex"
REPO_URL="git@github.com:relaycodehq/relay.git"

export PATH="/opt/homebrew/opt/node@22/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export JAVA_HOME="$ROOT/jdk21/Contents/Home"
export ANDROID_HOME="$ROOT/android-sdk"
export GRADLE_USER_HOME="$ROOT/gradle"
export NODE_OPTIONS="--max-old-space-size=3072"
export npm_config_fund=false npm_config_audit=false npm_config_update_notifier=false

src="$ROOT/src"

step() { printf '\n==> %s  %s\n' "$(date '+%H:%M:%S')" "$*"; }

# Leaves $src at <ref>, with nothing a previous build left but node_modules.
checkout() { # <ref>
  [[ -d "$src/.git" ]] || git clone --quiet "$REPO_URL" "$src"
  cd "$src"
  # --force: a tag moved to another commit on GitHub moves here too.
  git fetch --quiet --force --tags origin '+refs/heads/*:refs/remotes/origin/*'
  git checkout --quiet --force --detach "$1"
  # node_modules survive between builds; install redoes them when the lockfile changes.
  git clean -ffdxq -e node_modules -e packaging/checks-typescript/node_modules
}

install() { # <dir>: npm ci, skipped while the lockfile is unchanged
  local stamp="$1/node_modules/.relay-ci-lock" hash
  hash="$(shasum -a 256 "$1/package-lock.json" | cut -d' ' -f1)"
  [[ -f "$stamp" && "$(<"$stamp")" == "$hash" ]] && return
  (cd "$1" && npm ci)
  echo "$hash" >"$stamp"
}

install_deps() {
  install .
  # Electron 44 fetches its binary on first use instead of at install. Fetch it
  # here, or two test workers race to unpack it into the same folder.
  node -e 'require("electron")' >/dev/null
}

run_tests() {
  # Flagged, not blocking, as on GitHub: a formatting slip shouldn't hold back a release.
  npm run format:check || echo "Formatting check failed (not blocking)."
  npm run test:setup
  npx vitest run --maxWorkers=2
  python3 -m unittest discover -s tests/packaging
}
