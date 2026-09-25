$ErrorActionPreference = 'Stop'

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "  AVELUT SIGNED RELEASE BUILD (APK + AAB) " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$baseDir = $PSScriptRoot
if (-not $baseDir) { $baseDir = Get-Location }

# Auto-detect JDK
$possibleJdks = @(
    "$env:JAVA_HOME",
    "C:\Users\ADMIN\.antigravity-ide\extensions\redhat.java-1.56.0-win32-x64\jre\21.0.12.1-win32-x86_64",
    "C:\Users\Hp\android-dev-tools\jdk-21",
    "C:\Program Files\Android\Android Studio\jbr",
    "C:\Program Files\Java\jdk-21"
)
$jdkDir = $possibleJdks | Where-Object { $_ -and (Test-Path "$_\bin\java.exe") } | Select-Object -First 1

# Auto-detect Android SDK
$possibleSdks = @(
    "$env:ANDROID_HOME",
    "$env:ANDROID_SDK_ROOT",
    "C:\Users\ADMIN\android-sdk",
    "C:\Users\Hp\android-dev-tools\android-sdk",
    "$env:LOCALAPPDATA\Android\Sdk"
)
$sdkDir = $possibleSdks | Where-Object { $_ -and (Test-Path "$_") } | Select-Object -First 1

if (-not $jdkDir) {
    Write-Host " ERROR: JDK 21 not found. Please install JDK or set JAVA_HOME." -ForegroundColor Red
    exit 1
}
if (-not $sdkDir) {
    Write-Host " ERROR: Android SDK not found. Please set ANDROID_HOME." -ForegroundColor Red
    exit 1
}

$cmdlineToolsDir = "$sdkDir\cmdline-tools\latest"

$env:JAVA_HOME = $jdkDir
$env:ANDROID_HOME = $sdkDir
$env:ANDROID_SDK_ROOT = $sdkDir
$env:PATH = "$jdkDir\bin;$cmdlineToolsDir\bin;$sdkDir\platform-tools;$env:PATH"

Write-Host "Using JDK: $jdkDir" -ForegroundColor Gray
Write-Host "Using SDK: $sdkDir" -ForegroundColor Gray
Write-Host "Checking Java: " -NoNewline
& "$jdkDir\bin\java.exe" -version

# Ensure local.properties
Set-Content -Path "$baseDir\android\local.properties" -Value "sdk.dir=$($sdkDir.Replace('\', '/'))" -Force

# Step 1: Web Build & Sync
Write-Host "`n[1/3] Building Web Assets & Syncing Capacitor..." -ForegroundColor Yellow
Set-Location "$baseDir"
node ./node_modules/vite/bin/vite.js build
node ./node_modules/@capacitor/cli/bin/capacitor sync android

# Step 2: Gradle Release Build
Write-Host "`n[2/3] Building Signed APK & AAB with Gradle..." -ForegroundColor Yellow
Set-Location "$baseDir\android"
.\gradlew.bat assembleRelease bundleRelease --stacktrace
Set-Location "$baseDir"

# Step 3: Verification & Output Collection
Write-Host "`n[3/3] Verifying Built Artifacts..." -ForegroundColor Yellow
$apkPath = "$baseDir\android\app\build\outputs\apk\release\app-release.apk"
$aabPath = "$baseDir\android\app\build\outputs\bundle\release\app-release.aab"

$outDir = "$baseDir\release-output"
New-Item -ItemType Directory -Path $outDir -Force | Out-Null

if (Test-Path $apkPath) {
    $apkItem = Get-Item $apkPath
    Copy-Item -Path $apkPath -Destination "$outDir\avelut-release.apk" -Force
    Write-Host " SUCCESS: Signed APK -> $outDir\avelut-release.apk ($([math]::Round($apkItem.Length / 1MB, 2)) MB)" -ForegroundColor Green
} else {
    Write-Host " FAILED: APK was not generated at $apkPath" -ForegroundColor Red
}

if (Test-Path $aabPath) {
    $aabItem = Get-Item $aabPath
    Copy-Item -Path $aabPath -Destination "$outDir\avelut-release.aab" -Force
    Write-Host " SUCCESS: Signed AAB -> $outDir\avelut-release.aab ($([math]::Round($aabItem.Length / 1MB, 2)) MB)" -ForegroundColor Green
} else {
    Write-Host " FAILED: AAB was not generated at $aabPath" -ForegroundColor Red
}

Write-Host "`n==========================================" -ForegroundColor Cyan
Write-Host "  BUILD COMPLETE!                         " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
