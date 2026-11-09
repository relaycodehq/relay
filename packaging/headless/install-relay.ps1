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
# Cloudflare's copy of every release; GitHub is the fallback.
$mirror = "https://dl.relaycode.io"
$dest = if ($env:RELAY_INSTALL) { $env:RELAY_INSTALL } else { Join-Path $env:LOCALAPPDATA "Programs\Relay Headless" }

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Relay needs Node.js 22.13 or newer: https://nodejs.org/en/download"
}
# Before 22.13 node:sqlite needs a flag, and without it a restart forgets running turns.
$sqlite = & node --no-warnings -p "try { require('node:sqlite'); 'yes' } catch { 'no' }"
if ($sqlite -ne "yes") { throw "Relay needs Node.js 22.13 or newer; this is $(& node --version)." }

# The mirror keeps only the newest releases, so an older RELAY_VERSION comes from GitHub.
if ($env:RELAY_UPDATE_FEED) { $feeds = @($env:RELAY_UPDATE_FEED) }
elseif ($env:RELAY_VERSION) {
  $v = $env:RELAY_VERSION.TrimStart('v')
  $feeds = @("$mirror/v$v/latest.json", "https://github.com/$repo/releases/download/v$v/latest.json")
}
else { $feeds = @("$mirror/latest/latest.json", "https://github.com/$repo/releases/latest/download/latest.json") }

# Unpacked beside the install: Move-Item can't move a folder to another drive.
New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
$tmp = Join-Path (Split-Path $dest) ("relay-install-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  $feedPath = Join-Path $tmp "latest.json"
  $signaturePath = Join-Path $tmp "latest.json.sig"
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
  // An exit code, not stderr: PowerShell 5.1 stops on a native command's stderr.
  if (!valid) process.exit(1);
'@
  $found = $false
  foreach ($feed in $feeds) {
    try {
      Invoke-WebRequest -Uri $feed -OutFile $feedPath -UseBasicParsing
      Invoke-WebRequest -Uri "$feed.sig" -OutFile $signaturePath -UseBasicParsing
    } catch { continue }
    $verifyFeed | & node - $feedPath $signaturePath
    if (-not $LASTEXITCODE) { $found = $true; break }
  }
  if (-not $found) { throw "Couldn't read a signed release feed from $($feeds -join ' or ')." }
  $release = Get-Content -LiteralPath $feedPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($release.version -notmatch '^\d+\.\d+\.\d+$') { throw "Invalid Relay version." }
  if (-not $release.headless) { throw "That release has no headless Relay yet." }
  $file = $release.headless
  $archive = Join-Path $tmp $file.name
  Write-Host "Downloading Relay $($release.version)..."
  # GitHub's copy when the mirror's is missing or damaged.
  $sources = @($file.url, $file.fallbackUrl) | Where-Object { $_ }
  $downloaded = $false
  foreach ($source in $sources) {
    try { Invoke-WebRequest -Uri $source -OutFile $archive -UseBasicParsing } catch { continue }
    $sha = [Security.Cryptography.SHA512]::Create()
    $stream = [IO.File]::OpenRead($archive)
    try { $hash = [Convert]::ToBase64String($sha.ComputeHash($stream)) } finally { $stream.Dispose() }
    if ($hash -ceq $file.sha512) { $downloaded = $true; break }
  }
  if (-not $downloaded) { throw "Couldn't download Relay $($release.version), or it does not match the release." }
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
