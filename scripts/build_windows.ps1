# Build standalone Windows edition of Quran Reel Generator (zero installs required on target PC).
# Run from the 'Project Development' directory on Windows 10/11 (PowerShell):
#   powershell -ExecutionPolicy Bypass -File scripts\build_windows.ps1
$ErrorActionPreference = "Stop"

$Proj = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $Proj

Write-Host "=== 1. Building React frontend ==="
Push-Location (Join-Path $Proj "frontend")
if (-not (Test-Path "node_modules")) { npm ci }
npm run build
Pop-Location

Write-Host "=== 2. Installing Python packaging tools & static FFmpeg ==="
python -m pip install --upgrade pip
python -m pip install -r requirements.txt pywebview pyinstaller static-ffmpeg

# Pre-fetch static ffmpeg/ffprobe first so download logs don't pollute stdout paths
python -c "import static_ffmpeg; static_ffmpeg.add_paths()"
$FfmpegPath = (python -c "import static_ffmpeg; print(static_ffmpeg.run.get_or_fetch_platform_executables_else_raise()[0])" | Select-Object -Last 1).Trim()
$FfprobePath = (python -c "import static_ffmpeg; print(static_ffmpeg.run.get_or_fetch_platform_executables_else_raise()[1])" | Select-Object -Last 1).Trim()
if (-not (Test-Path $FfmpegPath)) { throw "Could not locate static ffmpeg at: $FfmpegPath" }
if (-not (Test-Path $FfprobePath)) { throw "Could not locate static ffprobe at: $FfprobePath" }
Write-Host "Bundling static ffmpeg:  $FfmpegPath"
Write-Host "Bundling static ffprobe: $FfprobePath"

# Verify Pillow RAQM support on Windows
python -c "from PIL import features; print('Pillow RAQM:', features.check('raqm'))"

Write-Host "=== 3. Building Quran Reel Generator.exe with PyInstaller ==="
$AddDataArgs = @(
    "--add-data", "$Proj\frontend\dist;bundle_data\frontend\dist",
    "--add-data", "$Proj\static;bundle_data\static",
    "--add-data", "$Proj\templates;bundle_data\templates",
    "--add-data", "$Proj\LICENSE;bundle_data",
    "--add-data", "$Proj\THIRD_PARTY_NOTICES.md;bundle_data"
)
if (Test-Path (Join-Path $Proj "USER_GUIDE.html")) {
    $AddDataArgs += @("--add-data", "$Proj\USER_GUIDE.html;bundle_data")
}
if (Test-Path (Join-Path $Proj "docs\guide_screenshots")) {
    $AddDataArgs += @("--add-data", "$Proj\docs\guide_screenshots;bundle_data\docs\guide_screenshots")
}

foreach ($rel in @("Assets\fonts", "Assets\Quran Text", "Assets\Quran Timing", "Assets\licences", "Assets\Background Templates", "Assets\audio")) {
    $full = Join-Path $Proj $rel
    if (Test-Path $full) {
        $AddDataArgs += @("--add-data", "$full;bundle_data\$rel")
    }
}
$Banner = Join-Path $Proj "Assets\Banner.png"
if (-not (Test-Path $Banner)) { $Banner = Join-Path $Proj "Assets\banner.png" }
if (Test-Path $Banner) {
    $AddDataArgs += @("--add-data", "$Banner;bundle_data\Assets")
}

$IconPath = Join-Path $Proj "Assets\AppIcon.ico"
$IconArgs = @()
if (Test-Path $IconPath) {
    $IconArgs = @("--icon", $IconPath)
}

$VersionFile = Join-Path $Proj "scripts\win_version_info.txt"
$VersionArgs = @()
if (Test-Path $VersionFile) {
    $VersionArgs = @("--version-file", $VersionFile)
}

$DistDir = Join-Path $Proj "dist_win"
$WorkDir = Join-Path $Proj "build_win"
if (Test-Path $DistDir) { Remove-Item -Recurse -Force $DistDir }
if (Test-Path $WorkDir) { Remove-Item -Recurse -Force $WorkDir }

python -m PyInstaller `
    --noconfirm `
    --windowed `
    --name "Quran Reel Generator" `
    @IconArgs `
    @VersionArgs `
    --distpath $DistDir `
    --workpath $WorkDir `
    --paths $Proj `
    --add-binary "$FfmpegPath;bin" `
    --add-binary "$FfprobePath;bin" `
    @AddDataArgs `
    --hidden-import app `
    --hidden-import quran `
    --hidden-import quran_display `
    --hidden-import quran_assets `
    --hidden-import renderer `
    --hidden-import draft_store `
    --hidden-import audio_sources `
    --hidden-import reciter_manager `
    --hidden-import pause_detect `
    --collect-submodules webview `
    --collect-data webview `
    --collect-binaries PIL `
    "$Proj\scripts\app_bundle_main.py"
if ($LASTEXITCODE -ne 0) { throw "PyInstaller build failed with exit code $LASTEXITCODE" }

Write-Host "=== 4. Packaging Quran-Reel-Generator-Windows.zip ==="
$ZipOut = Join-Path $Proj "Quran-Reel-Generator-Windows.zip"
if (Test-Path $ZipOut) { Remove-Item -Force $ZipOut }
Compress-Archive -Path (Join-Path $DistDir "Quran Reel Generator") -DestinationPath $ZipOut -CompressionLevel Optimal

Write-Host "Done! Created: $ZipOut"
