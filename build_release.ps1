if (-not $env:JAVA_HOME -or -not (Test-Path "$env:JAVA_HOME\bin\java.exe")) {
    if (Test-Path "C:\Users\ADMIN\jdk-21\bin\java.exe") {
        $env:JAVA_HOME = "C:\Users\ADMIN\jdk-21"
        $env:PATH = "C:\Users\ADMIN\jdk-21\bin;$env:PATH"
    }
}

Write-Host "Building web bundle..." -ForegroundColor Cyan
npm run build:mobile

if ($LASTEXITCODE -ne 0) {
    Write-Host "Web build failed. Exiting." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "Syncing with Capacitor..." -ForegroundColor Cyan
npx cap sync android

if ($LASTEXITCODE -ne 0) {
    Write-Host "Capacitor sync failed. Exiting." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "Building signed release APK..." -ForegroundColor Cyan
cd android
.\gradlew.bat assembleRelease

if ($LASTEXITCODE -ne 0) {
    Write-Host "APK build failed. Exiting." -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "Build complete! The signed release APK is located at: android\app\build\outputs\apk\release\app-release.apk" -ForegroundColor Green
cd ..
