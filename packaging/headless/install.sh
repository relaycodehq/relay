#!/bin/sh
# Installs the headless Relay for this user: the newest release (or
# RELAY_VERSION) into ~/.local/share/relay and `relay` into ~/.local/bin,
# then runs `relay setup` when there's a terminal to ask in. Run it again to
# reinstall or update.
#
#   curl -fsSL https://relaycode.io/install.sh | sh
#
# RELAY_NO_SETUP=1 skips the setup, RELAY_NO_MODIFY_PATH=1 leaves your shell's
# startup file alone, RELAY_NODE picks the Node.js to run with.
set -eu
repo=relaycodehq/relay
dest=${RELAY_INSTALL:-$HOME/.local/share/relay}
bindir=${RELAY_BIN:-$HOME/.local/bin}
home=${RELAY_HOME:-$HOME/.relay}

say() { printf '%s\n' "$*"; }
fail() { say "$*" >&2; exit 1; }

# A Node.js 22.13 or newer that actually runs: a Homebrew `node` can be broken
# by an upgrade while a keg-only node@22 beside it still works. Before 22.13
# node:sqlite needs a flag, and without it Relay keeps turns in memory alone,
# so a restart forgets the ones still running.
works() {
  [ -x "$1" ] || return 1
  major=$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null) || return 1
  [ "$major" -ge 22 ] 2>/dev/null || return 1
  "$1" -e 'require("node:sqlite")' >/dev/null 2>&1
}
find_node() {
  if [ -n "${RELAY_NODE:-}" ]; then
    if works "$RELAY_NODE"; then say "$RELAY_NODE"; fi
    return 0
  fi
  for candidate in "$(command -v node 2>/dev/null || true)" \
    /opt/homebrew/opt/node@26/bin/node /opt/homebrew/opt/node@24/bin/node \
    /opt/homebrew/opt/node@22/bin/node /usr/local/opt/node@24/bin/node \
    /usr/local/opt/node@22/bin/node "$HOME/.volta/bin/node"; do
    if [ -n "$candidate" ] && works "$candidate"; then
      say "$candidate"
      return
    fi
  done
  # nvm's, newest first.
  for candidate in $(ls -rd "${NVM_DIR:-$HOME/.nvm}"/versions/node/v*/bin/node 2>/dev/null); do
    if works "$candidate"; then
      say "$candidate"
      return
    fi
  done
}
command -v tar >/dev/null 2>&1 || fail "Relay's installer needs tar."
if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q "$1" -O "$2"; }
else
  fail "Relay's installer needs curl or wget."
fi

tmp=$(mktemp -d)
new=
cleanup() {
  relay_install_status=$?
  rm -rf "$tmp" || true
  if [ -n "$new" ]; then rm -rf "$new" || true; fi
  exit "$relay_install_status"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
# No Node.js 22.13 here, as on a server whose system one is older: Relay brings
# its own into ~/.relay, where `relay` and its updates keep using it. No sudo.
node_version=v22.23.2
fetch_node() {
  case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *) return 1 ;;
  esac
  case "$(uname -m)" in
    x86_64 | amd64) arch=x64 ;;
    aarch64 | arm64) arch=arm64 ;;
    *) return 1 ;;
  esac
  # Node's own builds need glibc; on Alpine and other musl systems it's theirs to install.
  if [ "$os" = linux ] && ldd --version 2>&1 | grep -qi musl; then return 1; fi
  if command -v sha256sum >/dev/null 2>&1; then
    sum() { sha256sum "$1" | cut -d' ' -f1; }
  elif command -v shasum >/dev/null 2>&1; then
    sum() { shasum -a 256 "$1" | cut -d' ' -f1; }
  else
    return 1
  fi
  file="node-$node_version-$os-$arch.tar.gz"
  base="https://nodejs.org/dist/$node_version"
  say "No Node.js 22.13 or newer here; downloading Node.js $node_version for Relay…"
  fetch "$base/$file" "$tmp/$file" || return 1
  fetch "$base/SHASUMS256.txt" "$tmp/SHASUMS256.txt" || return 1
  want=$(grep " $file\$" "$tmp/SHASUMS256.txt" | cut -d' ' -f1)
  [ -n "$want" ] && [ "$(sum "$tmp/$file")" = "$want" ] || {
    say "The Node.js download does not match its checksum." >&2
    return 1
  }
  tar -xzf "$tmp/$file" -C "$tmp"
  (umask 077 && mkdir -p "$home")
  rm -rf "$home/node-$node_version-$os-$arch"
  mv "$tmp/node-$node_version-$os-$arch" "$home/"
  node="$home/node-$node_version-$os-$arch/bin/node"
}
node=$(find_node)
if [ -z "$node" ]; then
  if [ -n "${RELAY_NODE:-}" ]; then
    fail "RELAY_NODE does not point to a working Node.js 22.13 or newer: $RELAY_NODE"
  fi
  fetch_node || node=
  if ! works "$node"; then
    if command -v node >/dev/null 2>&1; then
      fail "Relay needs Node.js 22.13 or newer; the node on your PATH is $(node --version 2>/dev/null || echo "broken"). Install a newer one: https://nodejs.org/en/download"
    fi
    fail "Relay needs Node.js 22.13 or newer: https://nodejs.org/en/download"
  fi
fi
if [ -n "${RELAY_UPDATE_FEED:-}" ]; then
  feed=$RELAY_UPDATE_FEED
elif [ -n "${RELAY_VERSION:-}" ]; then
  feed="https://github.com/$repo/releases/download/v${RELAY_VERSION#v}/latest.json"
else
  feed="https://github.com/$repo/releases/latest/download/latest.json"
fi
fetch "$feed" "$tmp/latest.json" || fail "Couldn't reach $feed."
fetch "$feed.sig" "$tmp/latest.json.sig" || fail "Couldn't fetch the release feed signature."
# Authenticate the exact feed bytes before accepting any metadata or archive.
"$node" -e '
  const fs = require("node:fs");
  const { createPublicKey, verify } = require("node:crypto");
  // Keep these raw Ed25519 public keys in sync with shared/updates.ts.
  const keys = ["83EmHV/Q5V1spYrUP+1S8Kuke5rUt2gAPVQJ1r45YL4="];
  const [feedPath, signaturePath] = process.argv.slice(process.argv[1] === "-" ? 2 : 1);
  const bytes = fs.readFileSync(feedPath);
  const signatures = fs.readFileSync(signaturePath, "utf8").split(/\s+/)
    .filter(s => /^[A-Za-z0-9+/]{86}==$/.test(s)).slice(0, 8);
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  const valid = keys.some(raw => {
    const key = createPublicKey({ key: Buffer.concat([prefix, Buffer.from(raw, "base64")]), format: "der", type: "spki" });
    return signatures.some(s => verify(null, bytes, key, Buffer.from(s, "base64")));
  });
  if (!valid) throw new Error("The release feed signature does not match a trusted Relay key.");
' "$tmp/latest.json" "$tmp/latest.json.sig" || fail "Couldn't verify the release feed."
# The feed names the headless download and its SHA-512.
metadata=$("$node" -e '
  const feed = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  if (!/^\d+\.\d+\.\d+$/.test(feed.version)) { console.error("Invalid Relay version."); process.exit(1); }
  const file = feed.headless;
  if (!file) { console.log("missing=1"); process.exit(); }
  const q = (s) => "\x27" + String(s).replace(/\x27/g, "") + "\x27";
  console.log(`version=${q(feed.version)} url=${q(file.url)} sha512=${q(file.sha512)} name=${q(file.name)}`);
' "$tmp/latest.json") || fail "Couldn't read the release feed."
eval "$metadata"
[ -z "${missing:-}" ] || fail "That release has no headless Relay yet."

say "Downloading Relay ${version}…"
fetch "$url" "$tmp/$name" || fail "Couldn't download $url."
"$node" -e '
  const [file, want] = process.argv.slice(1);
  const got = require("crypto").createHash("sha512").update(require("fs").readFileSync(file)).digest("base64");
  if (got !== want) { console.error("The download does not match the release."); process.exit(1); }
' "$tmp/$name" "$sha512"
tar -xzf "$tmp/$name" -C "$tmp"

mkdir -p "$(dirname "$dest")" "$bindir"
# Stage on the install's filesystem before the shared, locked swap.
new=$(mktemp -d "$dest.new-XXXXXX")
rmdir "$new"
mv "$tmp/relay-$version" "$new"
"$node" "$new/lib/install-files.cjs" "$dest" "$new" "$version"

# bin/relay runs with this Node from now on, through updates too.
(umask 077 && mkdir -p "$home")
printf '%s\n' "$node" >"$home/node"
# The desktop app's `relay` hands everything but folders to this one; keep it.
if ! grep -qs "relay-desktop-command" "$bindir/relay"; then
  ln -sf "$dest/bin/relay" "$bindir/relay"
fi
relay="$dest/bin/relay"
say "Relay $version is installed in $dest."

# On PATH for the next terminal, in the startup file of the shell you use.
case ":$PATH:" in
  *":$bindir:"*) ;;
  *)
    if [ -z "${RELAY_NO_MODIFY_PATH:-}" ]; then
      case "$(basename "${SHELL:-sh}")" in
        zsh) rc="${ZDOTDIR:-$HOME}/.zshrc" line="export PATH=\"$bindir:\$PATH\"" ;;
        bash)
          rc="$HOME/.bashrc"
          [ "$(uname)" != Darwin ] || rc="$HOME/.bash_profile"
          line="export PATH=\"$bindir:\$PATH\""
          ;;
        fish) rc="$HOME/.config/fish/conf.d/relay.fish" line="fish_add_path $bindir" ;;
        *) rc="$HOME/.profile" line="export PATH=\"$bindir:\$PATH\"" ;;
      esac
      if ! grep -qsF "$line" "$rc"; then
        mkdir -p "$(dirname "$rc")"
        printf '\n# Relay\n%s\n' "$line" >>"$rc"
        say "Added $bindir to your PATH in $rc; new terminals find relay."
      fi
    else
      say "Add $bindir to your PATH to run relay from anywhere."
    fi
    ;;
esac

if "$relay" status --json 2>/dev/null | grep -q '"running": true'; then
  "$relay" restart
elif [ -z "${RELAY_NO_SETUP:-}" ] && (exec </dev/tty) 2>/dev/null; then
  # Piped into sh, stdin is this script; setup asks its questions on the terminal.
  say ""
  "$relay" setup </dev/tty
else
  say "Next: relay setup"
fi
