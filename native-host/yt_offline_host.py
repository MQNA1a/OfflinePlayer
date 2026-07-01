#!/usr/bin/env python3
"""YouTube Offline Player — Native Messaging Host.

Communicates with the Chrome extension via stdin/stdout (4-byte
length-prefixed JSON).  Uses yt-dlp to download videos and a detached
HTTP server (yt_server.py) to serve them locally.
"""

import json
import os
import socket
import struct
import subprocess
import sys
import threading
import time

# ── Force IPv4 for all DNS resolution ─────────────────────────
# Prevents intermittent getaddrinfo failures on IPv6 networks
_orig_getaddrinfo = socket.getaddrinfo

def _ipv4_only_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    return _orig_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)

socket.getaddrinfo = _ipv4_only_getaddrinfo

# ── DNS cache for frequently resolved hosts ──────────────────
# Some YouTube CDN hostnames fail DNS resolution intermittently;
# cache successful lookups to avoid repeated failures.
_dns_cache = {}
_dns_cache_lock = threading.Lock()
_dns_cache_ttl = 300  # 5 minutes

def _cached_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    cache_key = (host, port)
    now = time.time()
    with _dns_cache_lock:
        if cache_key in _dns_cache:
            ts, addrs = _dns_cache[cache_key]
            if now - ts < _dns_cache_ttl:
                return addrs

    # Try up to 3 times for flaky CDN DNS
    last_err = None
    for attempt in range(3):
        try:
            result = _ipv4_only_getaddrinfo(host, port, family, type, proto, flags)
            with _dns_cache_lock:
                _dns_cache[cache_key] = (now, result)
            return result
        except socket.gaierror as e:
            last_err = e
            time.sleep(0.5 * (attempt + 1))

    if last_err:
        raise last_err

socket.getaddrinfo = _cached_getaddrinfo

# ── Configuration ──────────────────────────────────────────────
VIDEO_DIR = os.path.join(os.path.expanduser("~"), "YouTube Offline", "videos")
HTTP_PORT = 8462
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
SERVER_SCRIPT = os.path.join(SCRIPT_DIR, "yt_server.py")
FFMPEG_PATH = os.path.join(SCRIPT_DIR, "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg")
CONFIG_PATH = os.path.join(SCRIPT_DIR, "config.json")

# Ensure yt-dlp can find ffmpeg
if os.path.exists(FFMPEG_PATH):
    os.environ["PATH"] = SCRIPT_DIR + os.pathsep + os.environ.get("PATH", "")


def load_config():
    """Load configuration from config.json (proxy, etc.)."""
    defaults = {"proxy": ""}
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                defaults.update(json.load(f))
        except Exception:
            pass
    return defaults

# ── Thread-safe messaging & cancel state ──────────────────────
_send_lock = threading.Lock()
_cancel_event = threading.Event()

def send_message(msg):
    """Send one length-prefixed JSON message to stdout (thread-safe)."""
    encoded = json.dumps(msg).encode("utf-8")
    with _send_lock:
        sys.stdout.buffer.write(struct.pack("=I", len(encoded)))
        sys.stdout.buffer.write(encoded)
        sys.stdout.buffer.flush()

def read_message():
    """Read one length-prefixed JSON message from stdin."""
    raw_len = sys.stdin.buffer.read(4)
    if len(raw_len) < 4:
        return None
    msg_len = struct.unpack("=I", raw_len)[0]
    if msg_len == 0:
        return None
    data = sys.stdin.buffer.read(msg_len)
    return json.loads(data.decode("utf-8"))


# send_message is defined above (thread-safe version)


# ── HTTP server management ────────────────────────────────────

def is_server_running():
    import socket
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    result = sock.connect_ex(("127.0.0.1", HTTP_PORT))
    sock.close()
    return result == 0


def ensure_server():
    """Start the local HTTP server if it is not already running."""
    if is_server_running():
        return True
    try:
        popen_kwargs = dict(stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if sys.platform == "win32":
            popen_kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW | 0x00000008  # DETACHED_PROCESS
        else:
            popen_kwargs["start_new_session"] = True
        subprocess.Popen(
            [
                sys.executable,
                SERVER_SCRIPT,
                "--port", str(HTTP_PORT),
                "--dir", VIDEO_DIR,
            ],
            **popen_kwargs,
        )
        # Wait up to 5 s for the server to come up
        for _ in range(10):
            time.sleep(0.5)
            if is_server_running():
                return True
        return False
    except Exception:
        return False


# ── Download ──────────────────────────────────────────────────

QUALITY_FORMATS = {
    "1080": "bestvideo[ext=mp4][height<=1080]+bestaudio[ext=m4a]/best[ext=mp4][height<=1080]/best[height<=1080]",
    "720":  "bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4][height<=720]/best[height<=720]",
    "480":  "bestvideo[ext=mp4][height<=480]+bestaudio[ext=m4a]/best[ext=mp4][height<=480]/best[height<=480]",
    "360":  "bestvideo[ext=mp4][height<=360]+bestaudio[ext=m4a]/best[ext=mp4][height<=360]/best[height<=360]",
}
DEFAULT_FORMAT = "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"


def download_video(url, site=None, metadata=None, quality="auto"):
    """Download *url* with yt-dlp and stream progress back to the extension."""
    ensure_server()
    from yt_dlp import YoutubeDL

    video_id = None

    # Suppress all yt-dlp console output (stderr included)
    class _SilentLogger:
        def debug(self, msg): pass
        def warning(self, msg): pass
        def error(self, msg): pass
        def critical(self, msg): pass

    def progress_hook(d):
        nonlocal video_id
        if _cancel_event.is_set():
            raise Exception("DOWNLOAD_CANCELLED")
        if d["status"] == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            downloaded = d.get("downloaded_bytes", 0)
            percent = (downloaded / total * 100) if total else 0
            speed = d.get("_speed_str", "").strip()
            eta = d.get("_eta_str", "").strip()
            send_message({
                "type": "progress",
                "videoId": video_id or "",
                "percent": round(percent, 1),
                "speed": speed,
                "eta": eta,
            })
        elif d["status"] == "finished":
            send_message({
                "type": "progress",
                "videoId": video_id or "",
                "percent": 100,
                "speed": "",
                "eta": "",
            })

    config = load_config()
    proxy_url = config.get("proxy", "")

    video_format = QUALITY_FORMATS.get(quality, DEFAULT_FORMAT)

    ydl_opts = {
        "format": video_format,
        "merge_output_format": "mp4",
        "postprocessor_args": ["-movflags", "faststart"],
        "outtmpl": os.path.join(VIDEO_DIR, "%(id)s.%(ext)s"),
        "progress_hooks": [progress_hook],
        "noprogress": True,
        "quiet": True,
        "no_warnings": True,
        "logger": _SilentLogger(),
        "ffmpeg_location": FFMPEG_PATH if os.path.exists(FFMPEG_PATH) else None,
        "retries": 10,
        "fragment_retries": 10,
        "extractor_retries": 10,
        "file_access_retries": 10,
        "continuedl": True,
        "http_chunk_size": 10485760,
        "socket_timeout": 60,
        "source_address": "0.0.0.0",
        "geo_verification_proxy": None,
    }

    if proxy_url:
        ydl_opts["proxy"] = proxy_url

    try:
        # Redirect stderr to suppress yt-dlp's raw error output
        # (yt-dlp writes "ERROR: ..." directly to stderr, bypassing the logger)
        _real_stderr = sys.stderr
        _devnull = open(os.devnull, "w")
        sys.stderr = _devnull
        try:
            with YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
        finally:
            sys.stderr = _real_stderr
            _devnull.close()

        video_id = info["id"]

        # Resolve the actual file path (may be .mp4 after merge)
        filename = ydl.prepare_filename(info)
        if not filename.endswith(".mp4"):
            mp4_path = os.path.splitext(filename)[0] + ".mp4"
            if os.path.exists(mp4_path):
                filename = mp4_path
            elif os.path.exists(filename):
                pass
            else:
                base = os.path.splitext(filename)[0]
                for ext in (".mp4", ".mkv", ".webm"):
                    candidate = base + ext
                    if os.path.exists(candidate):
                        filename = candidate
                        break

        file_size = os.path.getsize(filename) if os.path.exists(filename) else 0
        video_url = f"http://localhost:{HTTP_PORT}/{os.path.basename(filename)}"

        send_message({
            "type": "complete",
            "videoId": video_id,
            "title": info.get("title", ""),
            "author": info.get("uploader", "") or info.get("channel", ""),
            "thumbnail": info.get("thumbnail", ""),
            "duration": int(info.get("duration", 0) or 0),
            "fileSize": file_size,
            "videoUrl": video_url,
            "qualityLabel": f"{info.get('height', '?')}p",
        })

        # Save metadata sidecar for restoration after extension reinstall
        save_metadata(video_id, {
            "videoId": video_id,
            "title": info.get("title", ""),
            "author": info.get("uploader", "") or info.get("channel", ""),
            "thumbnail": info.get("thumbnail", ""),
            "lengthSeconds": int(info.get("duration", 0) or 0),
            "downloadDate": int(time.time() * 1000),
            "status": "complete",
            "fileSize": file_size,
            "videoUrl": video_url,
            "qualityLabel": f"{info.get('height', '?')}p",
            "source": site or "youtube",
        })
    except Exception as e:
        err_str = str(e)
        if _cancel_event.is_set() or "DOWNLOAD_CANCELLED" in err_str:
            # Clean up partial files
            if video_id:
                for ext in (".mp4", ".mkv", ".webm", ".part", ".m4a", ".mp4.part", ".temp"):
                    partial = os.path.join(VIDEO_DIR, f"{video_id}{ext}")
                    if os.path.exists(partial):
                        try: os.remove(partial)
                        except: pass
                for f in os.listdir(VIDEO_DIR):
                    if f.startswith(video_id) and (f.endswith(".part") or f.endswith(".temp") or ".part" in f):
                        try: os.remove(os.path.join(VIDEO_DIR, f))
                        except: pass
            send_message({
                "type": "cancelled",
                "videoId": video_id or "",
            })
            _cancel_event.clear()
            return

        # Network errors
        if "IncompleteRead" in err_str or "read error" in err_str.lower():
            send_message({
                "type": "error",
                "videoId": video_id or "",
                "errorCode": "errNetworkDisconnected",
                "error": "",
            })
            return

        # DNS resolution errors
        if "getaddrinfo" in err_str or "Errno 11001" in err_str:
            send_message({
                "type": "error",
                "videoId": video_id or "",
                "errorCode": "errDnsError",
                "error": "",
            })
            return

        # Connection errors
        if "Connection refused" in err_str or "ConnectionError" in err_str:
            send_message({
                "type": "error",
                "videoId": video_id or "",
                "errorCode": "errConnectionRefused",
                "error": "",
            })
            return

        # Timeout errors
        if "timed out" in err_str.lower() or "timeout" in err_str.lower():
            send_message({
                "type": "error",
                "videoId": video_id or "",
                "errorCode": "errTimeout",
                "error": "",
            })
            return

        # Other errors
        send_message({
            "type": "error",
            "videoId": video_id or "",
            "error": str(e),
        })
        return


# ── Metadata sidecar ──────────────────────────────────────────

def save_metadata(video_id, metadata):
    """Save video metadata as a JSON sidecar file for restoration after extension reinstall."""
    meta_path = os.path.join(VIDEO_DIR, f"{video_id}.json")
    try:
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(metadata, f, ensure_ascii=False, indent=2)
    except Exception:
        pass


def load_metadata(video_id):
    """Load video metadata from JSON sidecar file, or empty dict if not found."""
    meta_path = os.path.join(VIDEO_DIR, f"{video_id}.json")
    if os.path.exists(meta_path):
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


# ── List ──────────────────────────────────────────────────────

def list_videos():
    """Return a list of downloaded videos with metadata from JSON sidecars."""
    videos = []
    if os.path.exists(VIDEO_DIR):
        for f in sorted(os.listdir(VIDEO_DIR)):
            if f.endswith((".mp4", ".mkv", ".webm")):
                vid = os.path.splitext(f)[0]
                filepath = os.path.join(VIDEO_DIR, f)
                meta = load_metadata(vid)
                videos.append({
                    "videoId": vid,
                    "title": meta.get("title", ""),
                    "author": meta.get("author", ""),
                    "thumbnail": meta.get("thumbnail", ""),
                    "lengthSeconds": meta.get("lengthSeconds", 0),
                    "downloadDate": meta.get("downloadDate", 0),
                    "status": "complete",
                    "fileSize": os.path.getsize(filepath),
                    "videoUrl": f"http://localhost:{HTTP_PORT}/{f}",
                    "qualityLabel": meta.get("qualityLabel", ""),
                    "source": meta.get("source", "youtube"),
                })
    return videos


# ── Delete ────────────────────────────────────────────────────

def delete_video(video_id):
    """Delete the video file and metadata sidecar for *video_id*."""
    deleted = False
    for ext in (".mp4", ".mkv", ".webm"):
        filepath = os.path.join(VIDEO_DIR, f"{video_id}{ext}")
        if os.path.exists(filepath):
            os.remove(filepath)
            deleted = True
    # Delete metadata JSON sidecar
    meta_path = os.path.join(VIDEO_DIR, f"{video_id}.json")
    if os.path.exists(meta_path):
        os.remove(meta_path)
    return deleted


# ── Main loop ─────────────────────────────────────────────────

def main():
    os.makedirs(VIDEO_DIR, exist_ok=True)

    while True:
        msg = read_message()
        if msg is None:
            break

        action = msg.get("action", "")

        if action == "download":
            _cancel_event.clear()
            thread = threading.Thread(
                target=download_video,
                args=(msg["url"], msg.get("site"), msg.get("metadata"), msg.get("quality", "auto")),
                daemon=True,
            )
            thread.start()

        elif action == "cancel":
            _cancel_event.set()

        elif action == "list":
            ensure_server()
            send_message({
                "type": "list",
                "videos": list_videos(),
            })

        elif action == "delete":
            delete_video(msg.get("videoId", ""))
            send_message({
                "type": "deleted",
                "videoId": msg.get("videoId", ""),
            })

        elif action == "status":
            running = ensure_server()
            send_message({
                "type": "status",
                "serverRunning": running,
                "port": HTTP_PORT,
            })


if __name__ == "__main__":
    main()
