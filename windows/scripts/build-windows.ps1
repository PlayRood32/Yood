
# Build Yood for Windows.
# Usage: powershell -ExecutionPolicy Bypass -File .\build-windows.ps1 [-BundleBrave]

param(
    [switch]$BundleBrave
)

$ErrorActionPreference = "Stop"

$arch = if ($env:PROCESSOR_ARCHITEW6432) {
    $env:PROCESSOR_ARCHITEW6432
} else {
    $env:PROCESSOR_ARCHITECTURE
}

if ($arch -ne "AMD64") {
    throw "Unsupported architecture: $arch. Only x86_64 is supported."
}

$WorkspaceRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSCommandPath))
$WindowsRoot = Join-Path $WorkspaceRoot "windows"
$BinDir = Join-Path $WindowsRoot "src-tauri\binaries\windows-x86_64"
$BraveDir = Join-Path $BinDir "brave"
$PinnedBrave = "1.94.121"

function Step($msg) {
    Write-Host ""
    Write-Host "==> $msg" -ForegroundColor Cyan
}

function Need($cmd, $hint) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "Missing $cmd. $hint"
    }
}

function Download-File($url, $dest) {
    $curl = Join-Path $env:SystemRoot "System32\curl.exe"

    if (Test-Path $curl) {
        & $curl -L --fail --retry 3 --retry-all-errors --proto '=https' --proto-redir '=https' --tlsv1.2 -C - `
            --speed-time 30 --speed-limit 30000 --progress-bar $url -o $dest

        if ($LASTEXITCODE -ne 0) {
            throw "Download failed: $url"
        }
    } else {
        Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
    }
}

function Assert-GitHubAssetDigest($path, $assetName) {
    $api = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest"
    $release = Invoke-RestMethod -Uri $api -Headers @{
        "User-Agent" = "Yood-build"
        "Accept" = "application/vnd.github+json"
    }

    $asset = @($release.assets | Where-Object { $_.name -eq $assetName }) | Select-Object -First 1

    if (-not $asset -or -not $asset.digest -or -not $asset.digest.StartsWith("sha256:")) {
        throw "GitHub did not provide a SHA-256 digest for $assetName"
    }

    $expected = $asset.digest.Substring(7).ToLowerInvariant()
    $actual = (Get-FileHash -Path $path -Algorithm SHA256).Hash.ToLowerInvariant()

    if ($expected -ne $actual) {
        throw "SHA-256 verification failed for $assetName"
    }
}

# Prerequisites

Step "Checking prerequisites"

Need cargo "Install Rust from https://rustup.rs/ (stable MSVC toolchain), then reopen PowerShell."
Need node "Install Node.js LTS from https://nodejs.org/, then reopen PowerShell."

cargo --version >$null 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "No default Rust toolchain. Running rustup default stable..."
    rustup default stable

    cargo --version >$null 2>&1

    if ($LASTEXITCODE -ne 0) {
        throw "Rust toolchain is not working. Reinstall from https://rustup.rs/."
    }
}

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
$hasVC = $false

if (Test-Path $vswhere) {
    $hasVC = & $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null
}

if (-not $hasVC) {
    throw "Visual Studio C++ tools not found. Install Build Tools for Visual Studio 2022 with the Desktop development with C++ workload from https://visualstudio.microsoft.com/downloads/."
}

cargo tauri --version >$null 2>&1

if ($LASTEXITCODE -ne 0) {
    Step "Installing tauri-cli"

    cargo install tauri-cli --locked

    if ($LASTEXITCODE -ne 0) {
        throw "cargo install tauri-cli failed."
    }

    $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"

    if (($($env:Path -split ';') | Where-Object { $_.Trim().ToLower() -eq $cargoBin.ToLower() }).Count -eq 0) {
        $env:Path = "$cargoBin`;$env:Path"
    }

    cargo tauri --version >$null 2>&1

    if ($LASTEXITCODE -ne 0) {
        throw "cargo-tauri is installed but not resolvable. Reopen PowerShell and try again."
    }
}

$wv = Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -ErrorAction SilentlyContinue

if (-not $wv) {
    Write-Host "WARNING: WebView2 runtime not detected." -ForegroundColor Yellow
    Write-Host "Download it from https://developer.microsoft.com/microsoft-edge/webview2/."
}

# Brave

if (-not $BundleBrave -and $env:YOOD_BUNDLE_BRAVE -ne "1") {
    Write-Host "Skipping bundled Brave. Yood will use an installed Brave when available, otherwise Tauri WebView." -ForegroundColor Yellow
} else {
    Step "Brave browser"

    $braveVersion = $env:BRAVE_VERSION

    if (-not $braveVersion -and (Test-Path (Join-Path $BraveDir "VERSION"))) {
        $stagedVer = (Get-Content (Join-Path $BraveDir "VERSION") -TotalCount 1).Trim()

        if ($stagedVer -and (Test-Path (Join-Path $BraveDir "brave.exe"))) {
            Write-Host "Reusing staged Brave $stagedVer."
            $braveVersion = $stagedVer
        }
    }

    if (-not $braveVersion) {
        try {
            $req = [System.Net.HttpWebRequest]::Create("https://github.com/brave/brave-browser/releases/latest")
            $req.AllowAutoRedirect = $false
            $req.Timeout = 30000
            $response = $req.GetResponse()
            $loc = $response.Headers["Location"]
            $response.Close()

            if ($loc -match "/tag/v([0-9]+.[0-9]+.[0-9]+)") {
                $braveVersion = $Matches[1]
            }
        } catch {
            Write-Host "Could not resolve latest Brave, using pinned $PinnedBrave." -ForegroundColor Yellow
        }

        if (-not $braveVersion) {
            $braveVersion = $PinnedBrave
        }
    }

    $stagedVersion = Join-Path $BraveDir "VERSION"
    $stagedBrave = Join-Path $BraveDir "brave.exe"

    if (-not ((Test-Path $stagedVersion) -and
        ((Get-Content $stagedVersion -TotalCount 1).Trim() -eq $braveVersion) -and
        (Test-Path $stagedBrave))) {

        $file = "brave-v$braveVersion-win32-x64.zip"
        $base = "https://github.com/brave/brave-browser/releases/download/v$braveVersion"

        $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("yood-brave-" + [Guid]::NewGuid().ToString("N"))
        New-Item -ItemType Directory -Force -Path $tmp | Out-Null

        $zip = Join-Path $tmp "brave.zip"
        $verified = $false

        for ($attempt = 1; $attempt -le 2 -and -not $verified; $attempt++) {
            Write-Host "Downloading Brave $braveVersion (attempt $attempt)..."

            Download-File "$base/$file" $zip
            Download-File "$base/$file.sha256" "$zip.sha256"

            $expected = ((Get-Content "$zip.sha256" -Raw) -split '\s+')[0].ToLowerInvariant()
            $actual = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLowerInvariant()

            if ($expected -and $expected -eq $actual) {
                $verified = $true
            } else {
                Write-Host "Checksum mismatch. Retrying..." -ForegroundColor Yellow
                Remove-Item -Force $zip, "$zip.sha256" -ErrorAction SilentlyContinue
            }
        }

        if (-not $verified) {
            throw "Checksum mismatch for Brave $braveVersion after 2 attempts."
        }

        Write-Host "Checksum OK. Extracting..."

        if (Test-Path $BraveDir) {
            Remove-Item -Recurse -Force $BraveDir
        }

        New-Item -ItemType Directory -Force -Path $BraveDir | Out-Null
        Expand-Archive -Path $zip -DestinationPath $BraveDir -Force

        $exe = Join-Path $BraveDir "brave.exe"

        if (-not (Test-Path $exe)) {
            $sub = Get-ChildItem -Directory $BraveDir | Select-Object -First 1

            if ($sub -and (Test-Path (Join-Path $sub.FullName "brave.exe"))) {
                Get-ChildItem $sub.FullName | Move-Item -Destination $BraveDir -Force
                Remove-Item $sub.FullName
            }
        }

        if (-not (Test-Path $exe)) {
            throw "Unexpected Brave zip layout (no brave.exe)."
        }

        $removed = 0
        $localesDir = Join-Path $BraveDir "locales"

        if (Test-Path $localesDir) {
            $locales = Get-ChildItem -Path $localesDir -Filter "*.pak" -File |
                Where-Object { $_.Name -notin @("en-US.pak", "he.pak") }

            foreach ($locale in $locales) {
                Remove-Item -LiteralPath $locale.FullName -Force
                $removed++
            }
        }

        $managementService = Get-ChildItem -Path $BraveDir -File |
            Where-Object { $_.BaseName -eq "chrome-management-service" }

        foreach ($item in $managementService) {
            Remove-Item -LiteralPath $item.FullName -Force
            $removed++
        }

        Write-Host "Removed $removed unused Brave files."

        Set-Content -Path $stagedVersion -Value $braveVersion -NoNewline

        Remove-Item -Recurse -Force $tmp

        Write-Host "Staged Brave $braveVersion."
    } else {
        Write-Host "Brave $braveVersion is already staged."
    }
}

# yt-dlp and ffmpeg

Step "yt-dlp and ffmpeg"

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

function Test-Tool($path, $probe) {
    if (-not (Test-Path $path)) {
        return $false
    }

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

    if (-not (Test-Tool $ytdlp @("--version"))) {
        throw "yt-dlp.exe failed to run after download."
    }
}

$ffmpeg = Join-Path $BinDir "ffmpeg.exe"

if (-not (Test-Tool $ffmpeg @("-version"))) {
    Write-Host "Downloading ffmpeg..."

    $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("yood-ffmpeg-" + [Guid]::NewGuid().ToString("N"))
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null

    try {
        $ffmpegUrl = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
        $ffmpegZip = Join-Path $tmp "ffmpeg.zip"
        $ffmpegSha = Join-Path $tmp "ffmpeg.zip.sha256"

        Download-File $ffmpegUrl $ffmpegZip
        Download-File "$ffmpegUrl.sha256" $ffmpegSha

        $expected = ((Get-Content $ffmpegSha -Raw) -split '\s+')[0].ToLowerInvariant()
        $actual = (Get-FileHash $ffmpegZip -Algorithm SHA256).Hash.ToLowerInvariant()

        if (-not $expected -or $expected -ne $actual) {
            throw "ffmpeg SHA-256 verification failed."
        }

        Expand-Archive -Path $ffmpegZip -DestinationPath $tmp -Force

        $found = Get-ChildItem -Recurse -Path $tmp -Filter "ffmpeg.exe" | Select-Object -First 1

        if (-not $found) {
            throw "ffmpeg.exe not found in essentials zip."
        }

        Copy-Item $found.FullName $ffmpeg -Force
    } finally {
        Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    }
}

Write-Host "Tools OK: $(& $ytdlp --version) / $((& $ffmpeg -version 2>&1 | Select-Object -First 1))"

# Frontend

Step "Frontend"

Push-Location (Join-Path $WorkspaceRoot "shared\frontend")

try {
    npm install

    if ($LASTEXITCODE -ne 0) {
        throw "npm install failed."
    }

    npm run build

    if ($LASTEXITCODE -ne 0) {
        throw "Frontend build failed."
    }
} finally {
    Pop-Location
}

# Tauri build

Step "Tauri build (NSIS installer)"

Push-Location (Join-Path $WindowsRoot "src-tauri")

try {
    cargo tauri build --bundles nsis
    $buildExitCode = $LASTEXITCODE
} finally {
    Pop-Location
}

if ($buildExitCode -ne 0) {
    throw "cargo tauri build --bundles nsis failed."
}

# Stage build artifacts

$bundleDir = Join-Path $WindowsRoot "src-tauri\target\release\bundle\nsis"

$setups = @(
    Get-ChildItem -Path $bundleDir -Filter "*-setup.exe" -File -ErrorAction SilentlyContinue |
        Select-Object -First 1
)

$rawExe = Join-Path $WindowsRoot "src-tauri\target\release\yood.exe"

if (-not (Test-Path $rawExe)) {
    $rawExe = Join-Path $WindowsRoot "src-tauri\target\release\yoo.exe"
}

if ($setups.Count -gt 0) {
    Write-Host ""
    Write-Host "Installer:"
    $setups | ForEach-Object {
        Write-Host "  $($_.FullName)"
    }
} else {
    Write-Host "No NSIS installer found. Raw binary:"
    Write-Host "  $rawExe"
}

$staging = Join-Path $WorkspaceRoot "build"

if (-not (Test-Path $staging)) {
    New-Item -ItemType Directory -Force $staging | Out-Null
}

Write-Host "Staging outputs into $staging" -ForegroundColor Blue

$tauriConf = Get-Content (Join-Path $WindowsRoot "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$VER = [string]$tauriConf.version

if ([string]::IsNullOrWhiteSpace($VER)) {
    $VER = "0.0.0"
}

$SetupNm = "Yood_${VER}_x86_64_setup.exe"
$RawNm = "Yood_${VER}_x86_64.exe"

foreach ($setup in $setups) {
    Copy-Item -LiteralPath $setup.FullName -Destination (Join-Path $staging $SetupNm) -Force
    Write-Host "Staged $SetupNm"
}

if (Test-Path -LiteralPath $rawExe -PathType Leaf) {
    Copy-Item -LiteralPath $rawExe -Destination (Join-Path $staging $RawNm) -Force
    Write-Host "Staged $RawNm"
}

Write-Host ""
Write-Host "DONE." -ForegroundColor Green
