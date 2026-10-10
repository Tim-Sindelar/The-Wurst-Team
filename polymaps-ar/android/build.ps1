# Builds the PolyMaps AR Android app and installs it on a phone connected with USB debugging.
# First run: downloads the Android command-line tools, the SDK packages and Gradle into %LOCALAPPDATA%.
# Needs a JDK 17+ on PATH.
#   powershell -ExecutionPolicy Bypass -File build.ps1 [-AppUrl https://...]
param([string]$AppUrl = "https://02.hackathon.ethz.ch/ar/")
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$sdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
$gradleHome = Join-Path $env:LOCALAPPDATA "gradle-dist\gradle-9.8.1"
$sdkmanager = Join-Path $sdk "cmdline-tools\latest\bin\sdkmanager.bat"
$adb = Join-Path $sdk "platform-tools\adb.exe"

if (-not (Test-Path $sdkmanager)) {
    Write-Host "Downloading Android command-line tools..." -ForegroundColor Cyan
    $zip = Join-Path $env:TEMP "android-clt.zip"
    $tmp = Join-Path $sdk "cmdline-tools\tmp"
    New-Item -ItemType Directory -Force $tmp | Out-Null
    Invoke-WebRequest "https://dl.google.com/android/repository/commandlinetools-win-16111833_latest.zip" -OutFile $zip
    Expand-Archive $zip $tmp -Force
    Move-Item (Join-Path $tmp "cmdline-tools") (Join-Path $sdk "cmdline-tools\latest")
    Remove-Item $tmp, $zip -Recurse -Force
}
if (-not (Test-Path (Join-Path $gradleHome "bin\gradle.bat"))) {
    Write-Host "Downloading Gradle 9.8.1..." -ForegroundColor Cyan
    $zip = Join-Path $env:TEMP "gradle-9.8.1-bin.zip"
    Invoke-WebRequest "https://services.gradle.org/distributions/gradle-9.8.1-bin.zip" -OutFile $zip
    Expand-Archive $zip (Split-Path $gradleHome) -Force
    Remove-Item $zip -Force
}

$env:ANDROID_HOME = $sdk
$android = Join-Path $sdk "cmdline-tools\latest\bin\android.exe"
if (-not (Test-Path $adb) -or -not (Test-Path (Join-Path $sdk "platforms\android-36")) -or -not (Test-Path (Join-Path $sdk "build-tools\36.1.0"))) {
    Write-Host "Installing platform-tools, Android 36 and build-tools 36.1.0 (by installing you accept the Android SDK terms: https://developer.android.com/studio/terms)" -ForegroundColor Cyan
    & $android --no-metrics --sdk=$sdk sdk install platform-tools platforms/android-36 build-tools/36.1.0
    if ($LASTEXITCODE -ne 0) { throw "SDK install failed." }
}

Set-Location $PSScriptRoot
Set-Content -Encoding ascii local.properties ("sdk.dir=" + ($sdk -replace '\\', '/'))
Write-Host "Building..." -ForegroundColor Cyan
& (Join-Path $gradleHome "bin\gradle.bat") --no-daemon -q ":app:assembleDebug" "-PappUrl=$AppUrl"
if ($LASTEXITCODE -ne 0) { throw "Build failed." }
$apk = Join-Path $PSScriptRoot "app\build\outputs\apk\debug\app-debug.apk"
Write-Host "APK: $apk" -ForegroundColor Green

& $adb start-server | Out-Null
$devices = & $adb devices | Select-String "\tdevice$"
if ($devices) {
    Write-Host "Installing on the phone..." -ForegroundColor Cyan
    & $adb install -r $apk
    & $adb shell monkey -p ch.ethz.polymapsar -c android.intent.category.LAUNCHER 1 | Out-Null
    Write-Host "Done: PolyMaps AR is open on the phone." -ForegroundColor Green
} else {
    Write-Host "No phone with USB debugging found (adb devices):" -ForegroundColor Yellow
    & $adb devices
    Write-Host "If it says 'unauthorized', unlock the phone and tap Allow, then run this script again."
}
