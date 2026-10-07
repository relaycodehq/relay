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
$release = Invoke-RestMethod -Uri $feed
if (-not $release.headless) { throw "That release has no headless Relay yet." }
$file = $release.headless

# Unpacked beside the install: Move-Item can't move a folder to another drive.
New-Item -ItemType Directory -Path (Split-Path $dest) -Force | Out-Null
$tmp = Join-Path (Split-Path $dest) ("relay-install-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
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
  if (Test-Path "$dest.old") { Remove-Item "$dest.old" -Recurse -Force }
  if (Test-Path $dest) { Move-Item -Path $dest -Destination "$dest.old" }
  Move-Item -Path (Join-Path $tmp "relay-$($release.version)") -Destination $dest
  Remove-Item "$dest.old" -Recurse -Force -ErrorAction SilentlyContinue
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
