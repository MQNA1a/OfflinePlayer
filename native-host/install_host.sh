#!/bin/bash
set -e

echo "============================================"
echo "  Video Offline — Native Host Installer"
echo "  (macOS / Linux)"
echo "============================================"
echo ""

# ── Extension ID (fixed via manifest key) ───────────────────
EXT_ID="odlkeiabnfbglokmmpillbfmdhlkmcpl"

# ── 1. Python check ──────────────────────────────────────────
if ! command -v python3 &>/dev/null; then
    echo "[ERROR] Python 3 not found."
    echo "Please install Python 3.8+ from https://www.python.org/downloads/"
    echo "  macOS:  brew install python3"
    echo "  Ubuntu: sudo apt install python3 python3-pip"
    echo ""
    exit 1
fi
PYVER=$(python3 --version 2>&1)
echo "[OK] $PYVER found."
echo ""

# ── 2. yt-dlp install ────────────────────────────────────────
echo "Installing yt-dlp and dependencies..."
pip3 install yt-dlp --quiet --upgrade 2>/dev/null || python3 -m pip install yt-dlp --quiet --upgrade
echo "[OK] yt-dlp installed."
echo ""

# ── 3. ffmpeg check ──────────────────────────────────────────
if ! command -v ffmpeg &>/dev/null; then
    echo "[WARNING] ffmpeg not found in PATH."
    echo "ffmpeg is required for merging video+audio (1080p+ downloads)."
    echo "  macOS:  brew install ffmpeg"
    echo "  Ubuntu: sudo apt install ffmpeg"
    echo ""
    read -p "Continue without ffmpeg? (downloads limited to 720p) [y/N] " yn
    [[ "$yn" =~ ^[Yy]$ ]] || exit 0
else
    echo "[OK] ffmpeg found."
fi
echo ""

# ── 4. Determine host directory & platform paths ─────────────
HOST_DIR="$HOME/.youtube-offline"
mkdir -p "$HOST_DIR"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Copying host files to $HOST_DIR ..."
cp -f "$SCRIPT_DIR/yt_offline_host.py" "$HOST_DIR/"
cp -f "$SCRIPT_DIR/yt_server.py" "$HOST_DIR/"
cp -f "$SCRIPT_DIR/run_host.sh" "$HOST_DIR/"
cp -f "$SCRIPT_DIR/config.json" "$HOST_DIR/" 2>/dev/null || echo '{"proxy": ""}' > "$HOST_DIR/config.json"
chmod +x "$HOST_DIR/run_host.sh"
echo "[OK] Files copied."
echo ""

# ── 5. Video directory ────────────────────────────────────────
VIDEO_DIR="$HOME/YouTube Offline/videos"
mkdir -p "$VIDEO_DIR"
echo "[OK] Video directory: $VIDEO_DIR"
echo ""

# ── 6. Create host manifest ──────────────────────────────────
MANIFEST="$HOST_DIR/host_manifest.json"
HOST_PATH="$HOST_DIR/run_host.sh"

cat > "$MANIFEST" << EOF
{
  "name": "com.youtubeoffline",
  "description": "YouTube Offline Player Native Host",
  "path": "$HOST_PATH",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://${EXT_ID}/"]
}
EOF

echo "[OK] Manifest created at $MANIFEST"
echo "     Extension ID: $EXT_ID"
echo ""

# ── 7. Register native messaging host ────────────────────────
OS_TYPE="$(uname -s)"
case "$OS_TYPE" in
    Darwin)
        NM_DIR="$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
        ;;
    Linux)
        NM_DIR="$HOME/.config/google-chrome/NativeMessagingHosts"
        ;;
    *)
        echo "[WARNING] Unsupported OS: $OS_TYPE"
        echo "Please register the manifest manually."
        echo ""
        exit 0
        ;;
esac

mkdir -p "$NM_DIR"
cp -f "$MANIFEST" "$NM_DIR/com.youtubeoffline.json"
echo "[OK] Native messaging host registered at $NM_DIR/com.youtubeoffline.json"
echo ""

# ── 8. Start HTTP server ─────────────────────────────────────
echo "Starting HTTP server on port 8462..."
# Check if server is already running
if ! lsof -i :8462 &>/dev/null 2>&1 && ! nc -z localhost 8462 2>/dev/null; then
    nohup python3 "$HOST_DIR/yt_server.py" --port 8462 --dir "$VIDEO_DIR" \
        >/dev/null 2>&1 &
    sleep 2
    echo "[OK] Server started."
else
    echo "[OK] Server already running."
fi
echo ""

# ── 9. Auto-launch on login ──────────────────────────────────
case "$OS_TYPE" in
    Darwin)
        PLIST_DIR="$HOME/Library/LaunchAgents"
        mkdir -p "$PLIST_DIR"
        PLIST="$PLIST_DIR/com.youtubeoffline.server.plist"
        cat > "$PLIST" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.youtubeoffline.server</string>
    <key>ProgramArguments</key>
    <array>
        <string>python3</string>
        <string>${HOST_DIR}/yt_server.py</string>
        <string>--port</string>
        <string>8462</string>
        <string>--dir</string>
        <string>${VIDEO_DIR}</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>
EOF
        echo "[OK] LaunchAgent created at $PLIST"
        ;;
    Linux)
        AUTOSTART_DIR="$HOME/.config/autostart"
        mkdir -p "$AUTOSTART_DIR"
        DESKTOP_FILE="$AUTOSTART_DIR/youtube-offline-server.desktop"
        cat > "$DESKTOP_FILE" << EOF
[Desktop Entry]
Type=Application
Name=YouTube Offline Server
Exec=python3 ${HOST_DIR}/yt_server.py --port 8462 --dir "${VIDEO_DIR}"
Hidden=false
NoDisplay=true
X-GNOME-Autostart-enabled=true
EOF
        echo "[OK] Autostart entry created at $DESKTOP_FILE"
        ;;
esac
echo ""

# ── Done ─────────────────────────────────────────────────────
echo "============================================"
echo "  Installation complete!"
echo "============================================"
echo ""
echo "  Video directory: $VIDEO_DIR"
echo "  HTTP server:     http://localhost:8462"
echo "  Host manifest:   $MANIFEST"
echo "  Extension ID:    $EXT_ID"
echo ""
echo "  Next steps:"
echo "  1. Load the extension in chrome://extensions (Developer mode > Load unpacked)"
echo "  2. Open a YouTube video and click \"Save Offline\""
echo ""
