@echo off
REM Wrapper that Chrome launches via the native-messaging host manifest.
REM Adds ffmpeg to PATH so yt-dlp can find it for merging.

cd /d "%~dp0"
set PATH=%~dp0;%PATH%
python "yt_offline_host.py"
