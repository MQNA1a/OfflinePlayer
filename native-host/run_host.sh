#!/bin/bash
# Wrapper that Chrome launches via the native-messaging host manifest.
# Adds ffmpeg to PATH so yt-dlp can find it for merging.

cd "$(dirname "$0")"
export PATH="$(dirname "$0"):$PATH"
python3 yt_offline_host.py
