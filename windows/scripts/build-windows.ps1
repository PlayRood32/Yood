# Yood Windows build — everything automated, just run it.
#
#   powershell -ExecutionPolicy Bypass -File .\build-windows.ps1
#
# What it does:
#   1. Checks prereqs (Rust cargo, Node.js, Tauri CLI, WebView2).
#   2. Downloads ONLY what's needed into src-tauri\binaries\windows-x86_64:
#      yt-dlp.exe and ffmpeg.exe. Portable Brave is optional via -BundleBrave.
#   3. Builds the frontend + `cargo tauri build` (NSIS installer).
# Result: src-tauri\target\release\bundle\nsis\Yood_*_x64-setup.exe
param(
  [switch]$BundleBrave
)
$ErrorActionPreference = "Stop"

$WorkspaceRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
$WindowsRoot = Join-Path $WorkspaceRoot "windows"
$BinDir = Join-Path $WindowsRoot "src-tauri\binaries\windows-x86_64"
$BraveDir = Join-Path $BinDir "brave"
$PinnedBrave = "1.94.121"

function Step($msg) { Write-Host ""; Write-Host "==> $msg" -ForegroundColor Cyan }
function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    throw "Missing $cmd. $hint"
  }
}

# Downloads with curl.exe when present (resume + retry survive flaky
# networks); falls back to Invoke-WebRequest otherwise.
function Download-File($url, $dest) {
  $curl = Join-Path $env:SystemRoot "System32\curl.exe"
  if (Test-Path $curl) {
    & $curl -L --fail --retry 3 --retry-all-errors --proto '=https' --proto-redir '=https' --tlsv1.2 -C - `
      --speed-time 30 --speed-limit 30000 --progress-bar $url -o $dest
    if ($LASTEXITCODE -ne 0) { throw "download failed: $url" }
  } else {
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
  }
}

function Assert-GitHubAssetDigest($path, $assetName) {
  $api = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest"
  $release = Invoke-RestMethod -Uri $api -Headers @{ "User-Agent" = "Yood-build"; "Accept" = "application/vnd.github+json" }
  $asset = @($release.assets | Where-Object { $_.name -eq $assetName }) | Select-Object -First 1
  if (-not $asset -or -not $asset.digest -or -not $asset.digest.StartsWith("sha256:")) {
    throw "GitHub did not provide a SHA-256 digest for $assetName"
  }
  $expected = $asset.digest.Substring(7).ToLowerInvariant()
  $actual = (Get-FileHash -Path $path -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($expected -ne $actual) { throw "SHA-256 verification failed for $assetName" }
}

# ---------- 0. prereqs ----------
Step "Checking prereqs"
Need cargo "Install Rust from https://rustup.rs/ (stable MSVC toolchain), then reopen PowerShell."
Need node "Install Node.js LTS from https://nodejs.org/, then reopen PowerShell."
# rustup shims exist before any toolchain is installed — a bare Get-Command
# check passes while every cargo call fails. Ensure a working toolchain now
# instead of failing 10 minutes into the build.
cargo --version >$null 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "No default Rust toolchain - running 'rustup default stable' (one-time download)..."
  rustup default stable
  cargo --version >$null 2>&1
  if ($LASTEXITCODE -ne 0) { throw "Rust toolchain still broken. Reinstall from https://rustup.rs/." }
}
# MSVC link.exe is mandatory for Tauri builds; fail fast with guidance.
$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
$hasVC = $false
if (Test-Path $vswhere) {
  $hasVC = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
}
if (-not $hasVC) {
  throw "No Visual Studio C++ tools detected (link.exe). Install 'Build Tools for Visual Studio 2022' with the 'Desktop development with C++' workload from https://visualstudio.microsoft.com/downloads/ , then rerun this script."
}
# NOTE: probe with `cargo tauri --version` (checked via $LASTEXITCODE, not
# try/catch — native-command exit codes do not throw on Windows PowerShell
# 5.1). Do NOT short-circuit on `Get-Command cargo-tauri` — a stale PATH
# entry or a stale $env:Path in an inherited terminal can make it pass while
# the Tauri build itself fails with "no such command: tauri".
cargo tauri --version >$null 2>&1
if ($LASTEXITCODE -ne 0) {
  Step "Installing tauri-cli (one-time, a few minutes of compiling)"
  cargo install tauri-cli --locked
  if ($LASTEXITCODE -ne 0) { throw "cargo install tauri-cli failed (see above)." }
  # Freshly installed binaries land in %USERPROFILE%\.cargo\bin — make sure
  # it is on PATH for this session even if the inherited $env:Path is stale.
  $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
  if (($($env:Path -split ';') | Where-Object { $_.Trim().ToLower() -eq $cargoBin.ToLower() }).Count -eq 0) {
    $env:Path = "$cargoBin`;$env:Path"
  }
  cargo tauri --version >$null 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "cargo-tauri is installed but not resolvable. Reopen your terminal so %USERPROFILE%\.cargo\bin is on PATH, then rerun."
  }
}
$wv = Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue
if (-not $wv) {
  Write-Host "WARNING: WebView2 runtime not detected. The app needs it to run." -ForegroundColor Yellow
  Write-Host "Download it from https://developer.microsoft.com/microsoft-edge/webview2/ (Evergreen Standalone Installer)."
}

# ---------- 1. Brave (optional bundle; installed Brave is detected at runtime) ----------
if (-not $BundleBrave -and $env:YOOD_BUNDLE_BRAVE -ne "1") {
  Write-Host "Skipping bundled Brave. Yood will use an installed Brave when available, otherwise it falls back to Tauri WebView. Use -BundleBrave to include Brave." -ForegroundColor Yellow
  if (Test-Path $BraveDir) { Remove-Item -Recurse -Force $BraveDir }
} else {
Step "Brave browser"
$braveVersion = $env:BRAVE_VERSION
if (-not $braveVersion -and (Test-Path (Join-Path $BraveDir "VERSION"))) {
  $staged = (Get-Content (Join-Path $BraveDir "VERSION") -TotalCount 1).Trim()
  if ($staged -and (Test-Path (Join-Path $BraveDir "brave.exe"))) {
    Write-Host "Reusing staged Brave $staged."
    $braveVersion = $staged
  }
}
if (-not $braveVersion) {
  try {
    $req = [System.Net.HttpWebRequest]::Create("https://github.com/brave/brave-browser/releases/latest")
    $req.AllowAutoRedirect = $false
    $req.Timeout = 30000
    $loc = $req.GetResponse().Headers["Location"]
    if ($loc -match "/tag/v([0-9]+\.[0-9]+\.[0-9]+)") { $braveVersion = $Matches[1] }
  } catch { Write-Host "Could not resolve latest Brave, using pinned $PinnedBrave." -ForegroundColor Yellow }
  if (-not $braveVersion) { $braveVersion = $PinnedBrave }
}
if (-not ((Test-Path (Join-Path $BraveDir "VERSION")) -and ((Get-Content (Join-Path $BraveDir "VERSION") -TotalCount 1).Trim() -eq $braveVersion) -and (Test-Path (Join-Path $BraveDir "brave.exe")))) {
  $file = "brave-v$braveVersion-win32-x64.zip"
  $base = "https://github.com/brave/brave-browser/releases/download/v$braveVersion"
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("yood-brave-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $zip = Join-Path $tmp "brave.zip"
  $verified = $false
  for ($attempt = 1; $attempt -le 2 -and -not $verified; $attempt++) {
    Write-Host "Downloading Brave $braveVersion (~200MB, attempt $attempt)..."
    Download-File "$base/$file" $zip
    Download-File "$base/$file.sha256" "$zip.sha256"
    $expected = ((Get-Content "$zip.sha256" -Raw) -split '\s+')[0].ToLower()
    $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
    if ($expected -and ($expected -eq $actual)) {
      $verified = $true
    } else {
      $showExp = if ($expected -and $expected.Length -ge 16) { $expected.Substring(0, 16) } else { "(empty/unreadable)" }
      $showGot = if ($actual.Length -ge 16) { $actual.Substring(0, 16) } else { $actual }
      Write-Host "Checksum mismatch (got $showGot..., want $showExp...). Retrying from scratch..." -ForegroundColor Yellow
      Remove-Item -Force $zip, "$zip.sha256" -ErrorAction SilentlyContinue
    }
  }
  if (-not $verified) { throw "Checksum mismatch for Brave $braveVersion after 2 attempts. Check your connection/proxy and rerun." }
  Write-Host "Checksum OK. Extracting..."
  if (Test-Path $BraveDir) { Remove-Item -Recurse -Force $BraveDir }
  New-Item -ItemType Directory -Force -Path $BraveDir | Out-Null
  Expand-Archive -Path (Join-Path $tmp "brave.zip") -DestinationPath $BraveDir -Force
  $exe = Join-Path $BraveDir "brave.exe"
  if (-not (Test-Path $exe)) {
    $sub = Get-ChildItem -Directory $BraveDir | Select-Object -First 1
    if ($sub -and (Test-Path (Join-Path $sub.FullName "brave.exe"))) {
      Get-ChildItem $sub.FullName | Move-Item -Destination $BraveDir -Force
      Remove-Item $sub.FullName
    }
  }
  if (-not (Test-Path (Join-Path $BraveDir "brave.exe"))) { throw "Unexpected Brave zip layout (no brave.exe)." }
  Set-Content -Path (Join-Path $BraveDir "VERSION") -Value $braveVersion -NoNewline
  Remove-Item -Recurse -Force $tmp
  Write-Host "Staged Brave $braveVersion."
}
}

# ---------- 2. yt-dlp + ffmpeg ----------
Step "yt-dlp + ffmpeg"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
function Test-Tool($path, $probe) {
  if (-not (Test-Path $path)) { return $false }
  & $path @probe >$null 2>&1
  return ($LASTEXITCODE -eq 0)
}

$ytdlp = Join-Path $BinDir "yt-dlp.exe"
if (-not (Test-Tool $ytdlp @("--version"))) {
  Write-Host "Downloading yt-dlp..."
  $ytTmp = Join-Path ([System.IO.Path]::GetTempPath()) ("yood-yt-dlp-" + [Guid]::NewGuid().ToString("N") + ".exe")
  try {
    Download-File "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" $ytTmp
    Assert-GitHubAssetDigest $ytTmp "yt-dlp.exe"
    Move-Item -Force $ytTmp $ytdlp
  } finally {
    Remove-Item -Force $ytTmp -ErrorAction SilentlyContinue
  }
  if (-not (Test-Tool $ytdlp @("--version"))) { throw "yt-dlp.exe failed to run after download." }
}
$ffmpeg = Join-Path $BinDir "ffmpeg.exe"
if (-not (Test-Tool $ffmpeg @("-version"))) {
  Write-Host "Downloading ffmpeg (essentials, ~80MB, one-time)..."
  $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("yood-ffmpeg-" + [Guid]::NewGuid().ToString("N"))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $ffmpegUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
  $ffmpegZip = Join-Path $tmp "ffmpeg.zip"
  $ffmpegSha = Join-Path $tmp "ffmpeg.zip.sha256"
  Download-File $ffmpegUrl $ffmpegZip
  Download-File "$ffmpegUrl.sha256" $ffmpegSha
  $expected = ((Get-Content $ffmpegSha -Raw) -split '\s+')[0].ToLowerInvariant()
  $actual = (Get-FileHash $ffmpegZip -Algorithm SHA256).Hash.ToLowerInvariant()
  if (-not $expected -or $expected -ne $actual) { throw "ffmpeg SHA-256 verification failed" }
  Expand-Archive -Path $ffmpegZip -DestinationPath $tmp -Force
  $found = Get-ChildItem -Recurse -Path $tmp -Filter "ffmpeg.exe" | Select-Object -First 1
  if (-not $found) { throw "ffmpeg.exe not found in essentials zip." }
  Copy-Item $found.FullName $ffmpeg -Force
  Remove-Item -Recurse -Force $tmp
}
Write-Host "Tools OK: $(& $ytdlp --version) / $((& $ffmpeg -version 2>&1 | Select-Object -First 1))"

# ---------- 3. build ----------
Step "Frontend"
Push-Location (Join-Path $WorkspaceRoot "shared\frontend")
npm install
if ($LASTEXITCODE -ne 0) { throw "npm install failed." }
npm run build
if ($LASTEXITCODE -ne 0) { throw "frontend build failed." }
Pop-Location

Step "Tauri build (NSIS installer, takes a while)"
Push-Location (Join-Path $WindowsRoot "src-tauri")
cargo tauri build
if ($LASTEXITCODE -ne 0) { throw "cargo tauri build failed (see errors above)." }
Pop-Location

Write-Host ""
Write-Host "DONE." -ForegroundColor Green
$bundleDir = Join-Path $WindowsRoot "src-tauri\target\release\bundle\nsis"
$setups = @(Get-ChildItem (Join-Path $bundleDir "*-setup.exe") -ErrorAction SilentlyContinue)
if ($setups.Count -gt 0) {
  Write-Host "Installer:"
  $setups | ForEach-Object { Write-Host "  $($_.FullName)" }
  Write-Host "Double-click the setup to install Yood (app icon, no terminal needed)."
} else {
  Write-Host "No NSIS installer found - check the build log above. Raw binary (if built):"
  $exePath = Join-Path $WindowsRoot 'src-tauri\target\release\yood.exe'
  Write-Host "  $exePath"
}
