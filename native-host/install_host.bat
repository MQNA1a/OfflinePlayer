@echo off
setlocal enabledelayedexpansion

echo ============================================
echo   Video Offline — Native Host Installer
echo ============================================
echo.

REM ── Extension ID (fixed via manifest key) ───────────────────
set EXT_ID=odlkeiabnfbglokmmpillbfmdhlkmcpl

REM ── 1. Python check ──────────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found.
    echo Please install Python 3.8+ from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do set PYVER=%%v
echo [OK] %PYVER% found.
echo.

REM ── 2. yt-dlp install ────────────────────────────────────────
echo Installing yt-dlp and dependencies...
pip install yt-dlp --quiet --upgrade
if errorlevel 1 (
    echo [ERROR] Failed to install yt-dlp.
    pause
    exit /b 1
)
echo [OK] yt-dlp installed.
echo.

REM ── 2b. Force yt-dlp to latest version ──────────────────────
echo Forcing yt-dlp to latest version...
python -m pip install -U yt-dlp --quiet
echo [OK] yt-dlp updated.
echo.

REM ── 3. ffmpeg check ──────────────────────────────────────────
where ffmpeg >nul 2>&1
if errorlevel 1 (
    echo [WARNING] ffmpeg not found in PATH.
    echo ffmpeg is required for merging video+audio (1080p+ downloads).
    echo Download from: https://ffmpeg.org/download.html
    echo Extract and add the bin folder to your PATH.
    echo.
    choice /c YN /m "Continue without ffmpeg (downloads will be limited to 720p)"
    if errorlevel 2 exit /b 0
) else (
    echo [OK] ffmpeg found.
)
echo.

REM ── 4. Copy host files to AppData ────────────────────────────
set HOST_DIR=%APPDATA%\YouTubeOffline
mkdir "%HOST_DIR%" 2>nul
echo Copying host files to %HOST_DIR% ...
copy /Y "%~dp0yt_offline_host.py" "%HOST_DIR%\" >nul
copy /Y "%~dp0yt_server.py" "%HOST_DIR%\" >nul
copy /Y "%~dp0run_host.bat" "%HOST_DIR%\" >nul
copy /Y "%~dp0config.json" "%HOST_DIR%\" >nul
echo [OK] Files copied.
echo.

REM ── 5. Create manifest with correct extension ID ─────────────
echo Using Extension ID: %EXT_ID%
set MANIFEST=%HOST_DIR%\host_manifest.json
(
echo {
echo   "name": "com.youtubeoffline",
echo   "description": "YouTube Offline Player Native Host",
echo   "path": "%HOST_DIR%\\run_host.bat",
echo   "type": "stdio",
echo   "allowed_origins": ["chrome-extension://%EXT_ID%/"]
echo }
) > "%MANIFEST%"

echo [OK] Manifest created at %MANIFEST%
echo.

REM ── 6. Register in Windows Registry ──────────────────────────
echo Registering native messaging host in registry...
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\com.youtubeoffline" /ve /t REG_SZ /d "%MANIFEST%" /f >nul
if errorlevel 1 (
    echo [ERROR] Failed to write to registry.
    pause
    exit /b 1
)
echo [OK] Registry updated.
echo.

REM ── 7. Create video directory ────────────────────────────────
set VIDEO_DIR=%USERPROFILE%\YouTube Offline\videos
mkdir "%VIDEO_DIR%" 2>nul
echo [OK] Video directory: %VIDEO_DIR%
echo.

REM ── 8. Create startup entry for auto-launch ────────────────
echo Creating startup entry...
copy /Y "%~dp0start_server.vbs" "%HOST_DIR%\" >nul
set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT=%STARTUP_DIR%\YouTubeOfflineServer.lnk
powershell -NoProfile -Command "$shell = New-Object -ComObject WScript.Shell; $lnk = $shell.CreateShortcut('%SHORTCUT%'); $lnk.TargetPath = 'wscript.exe'; $lnk.Arguments = '\"%HOST_DIR%\start_server.vbs\"'; $lnk.WindowStyle = 7; $lnk.Description = 'YouTube Offline Server'; $lnk.Save()"
echo [OK] Startup entry created.
echo.

REM ── 9. Start HTTP server ────────────────────────────────────
echo Starting HTTP server on port 8462...
start "YouTube Offline Server" /min python "%HOST_DIR%\yt_server.py" --port 8462 --dir "%VIDEO_DIR%"
timeout /t 2 /nobreak >nul
echo [OK] Server started.
echo.

REM ── Done ─────────────────────────────────────────────────────
echo ============================================
echo   Installation complete!
echo ============================================
echo.
echo   Video directory: %VIDEO_DIR%
echo   HTTP server:     http://localhost:8462
echo   Host manifest:   %MANIFEST%
echo   Extension ID:    %EXT_ID%
echo.
echo   Next steps:
echo   1. Load the extension in chrome://extensions (Developer mode ^> Load unpacked)
echo   2. Open a YouTube video and click "Save Offline"
echo.
pause
