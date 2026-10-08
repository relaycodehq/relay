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

# A Node.js 22 or newer that actually runs: a Homebrew `node` can be broken
# by an upgrade while a keg-only node@22 beside it still works.
works() {
  [ -x "$1" ] || return 1
  major=$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null) || return 1
  [ "$major" -ge 22 ] 2>/dev/null
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
node=$(find_node)
if [ -z "$node" ]; then
  if [ -n "${RELAY_NODE:-}" ]; then
    fail "RELAY_NODE does not point to a working Node.js 22 or newer: $RELAY_NODE"
  fi
  if command -v node >/dev/null 2>&1; then
    fail "Relay needs Node.js 22 or newer; the node on your PATH is $(node --version 2>/dev/null || echo "broken"). Install a newer one: https://nodejs.org/en/download"
  fi
  fail "Relay needs Node.js 22 or newer: https://nodejs.org/en/download"
fi
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
