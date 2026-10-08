# Installs the headless Relay for this user on Windows: the newest release
# (or $env:RELAY_VERSION) into %LOCALAPPDATA%\Programs\Relay Headless, with
# its bin folder on the user's PATH, then runs `relay setup`. Not in
# Programs\Relay: that's where the desktop app installs. Run it again to
# reinstall or update; $env:RELAY_NO_SETUP skips the setup.
#
#   irm https://relaycode.io/install.ps1 | iex
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$repo = "relaycodehq/relay"
$dest = if ($env:RELAY_INSTALL) { $env:RELAY_INSTALL } else { Join-Path $env:LOCALAPPDATA "Programs\Relay Headless" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Relay needs Node.js 22 or newer: https://nodejs.org/en/download"
}
$major = [int](& node -p "process.versions.node.split('.')[0]")
if ($major -lt 22) { throw "Relay needs Node.js 22 or newer; this is $(& node --version)." }

if ($env:RELAY_UPDATE_FEED) { $feed = $env:RELAY_UPDATE_FEED }
elseif ($env:RELAY_VERSION) { $feed = "https://github.com/$repo/releases/download/v$($env:RELAY_VERSION.TrimStart('v'))/latest.json" }
else { $feed = "https://github.com/$repo/releases/latest/download/latest.json" }

# Unpacked beside the install: Move-Item can't move a folder to another drive.
New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
$tmp = Join-Path (Split-Path $dest) ("relay-install-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $feedPath = Join-Path $tmp "latest.json"
  $signaturePath = Join-Path $tmp "latest.json.sig"
  Invoke-WebRequest -Uri $feed -OutFile $feedPath -UseBasicParsing
  Invoke-WebRequest -Uri "$feed.sig" -OutFile $signaturePath -UseBasicParsing
  # Authenticate exact bytes before parsing or executing any release contents.
  $verifyFeed = @'
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
'@
  $verifyFeed | & node - $feedPath $signaturePath
  if ($LASTEXITCODE) { throw "Couldn't verify the release feed." }
  $release = Get-Content -LiteralPath $feedPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($release.version -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid Relay version." }
  if (-not $release.headless) { throw "That release has no headless Relay yet." }
  $file = $release.headless
  $archive = Join-Path $tmp $file.name
  Write-Host "Downloading Relay $($release.version)..."
  Invoke-WebRequest -Uri $file.url -OutFile $archive -UseBasicParsing
  $sha = [Security.Cryptography.SHA512]::Create()
  $stream = [IO.File]::OpenRead($archive)
  try { $hash = [Convert]::ToBase64String($sha.ComputeHash($stream)) } finally { $stream.Dispose() }
  if ($hash -cne $file.sha512) { throw "The download does not match the release." }
  # Windows' own tar: a GNU tar from Git earlier on PATH reads C: as a host.
  & (Join-Path $env:SystemRoot "System32\tar.exe") -xzf $archive -C $tmp
  if ($LASTEXITCODE) { throw "Couldn't unpack $archive." }
  $staged = Join-Path $tmp "relay-$($release.version)"
  & node (Join-Path $staged "lib\install-files.cjs") $dest $staged $release.version
  if ($LASTEXITCODE) { throw "Couldn't install Relay; the previous install was preserved." }
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

$bin = Join-Path $dest "bin"
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if (-not (($userPath -split ";") -contains $bin)) {
  [Environment]::SetEnvironmentVariable("Path", ((@($userPath, $bin) | Where-Object { $_ }) -join ";"), "User")
}
if (-not (($env:Path -split ";") -contains $bin)) { $env:Path = "$env:Path;$bin" }

Write-Host "Relay $($release.version) is installed in $dest."
$relay = Join-Path $bin "relay.cmd"
if ((& $relay status --json 2>$null | Out-String) -match '"running": true') {
  & $relay restart
} elseif (-not $env:RELAY_NO_SETUP -and [Environment]::UserInteractive) {
  Write-Host ""
  & $relay setup
} else {
  Write-Host "Next: relay setup   (open a new terminal first if relay isn't found)"
}
