#!/bin/sh
# Installs the headless Relay for this user: the newest release (or
# RELAY_VERSION) into ~/.local/share/relay, and `relay` into ~/.local/bin.
# Then `relay setup` does the rest. Run it again to reinstall or update.
#
#   curl -fsSL https://github.com/relaycodehq/relay-releases/releases/latest/download/install-relay.sh | sh
set -eu
repo=relaycodehq/relay-releases
dest=${RELAY_INSTALL:-$HOME/.local/share/relay}
bindir=${RELAY_BIN:-$HOME/.local/bin}

say() { printf '%s\n' "$*"; }
fail() { say "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || fail "Relay needs Node.js 22 or newer: https://nodejs.org/en/download"
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 22 ] || fail "Relay needs Node.js 22 or newer; this is $(node --version)."
command -v tar >/dev/null 2>&1 || fail "Relay's installer needs tar."
if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q "$1" -O "$2"; }
else
  fail "Relay's installer needs curl or wget."
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
if [ -n "${RELAY_UPDATE_FEED:-}" ]; then
  feed=$RELAY_UPDATE_FEED
elif [ -n "${RELAY_VERSION:-}" ]; then
  feed="https://github.com/$repo/releases/download/v${RELAY_VERSION#v}/latest.json"
else
  feed="https://github.com/$repo/releases/latest/download/latest.json"
fi
fetch "$feed" "$tmp/latest.json" || fail "Couldn't reach $feed."
# The feed names the headless download and its SHA-512.
eval "$(node -e '
  const feed = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const file = feed.headless;
  if (!file) { console.log("missing=1"); process.exit(); }
  const q = (s) => "\x27" + String(s).replace(/\x27/g, "") + "\x27";
  console.log(`version=${q(feed.version)} url=${q(file.url)} sha512=${q(file.sha512)} name=${q(file.name)}`);
' "$tmp/latest.json")"
[ -z "${missing:-}" ] || fail "That release has no headless Relay yet."

say "Downloading Relay $version…"
fetch "$url" "$tmp/$name" || fail "Couldn't download $url."
node -e '
  const [file, want] = process.argv.slice(1);
  const got = require("crypto").createHash("sha512").update(require("fs").readFileSync(file)).digest("base64");
  if (got !== want) { console.error("The download does not match the release."); process.exit(1); }
' "$tmp/$name" "$sha512"
tar -xzf "$tmp/$name" -C "$tmp"

mkdir -p "$(dirname "$dest")" "$bindir"
rm -rf "$dest.new" && mv "$tmp/relay-$version" "$dest.new"
[ ! -e "$dest" ] || mv "$dest" "$dest.old"
mv "$dest.new" "$dest" && rm -rf "$dest.old"
ln -sf "$dest/bin/relay" "$bindir/relay"

say "Relay $version is installed in $dest."
case ":$PATH:" in
  *":$bindir:"*) say "Next: relay setup" ;;
  *) say "Add $bindir to your PATH, then run: relay setup" ;;
esac
if "$bindir/relay" status --json 2>/dev/null | grep -q '"running": true'; then
  "$bindir/relay" restart
fi
