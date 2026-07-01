#!/usr/bin/env python3
"""Local HTTP server for serving downloaded video files.

Started as a detached subprocess by yt_offline_host.py so that it
survives native-messaging-port disconnects.  Supports Range requests
for video seeking.
"""

import argparse
import json
import os
import sys
import mimetypes
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class CORSRequestHandler(SimpleHTTPRequestHandler):
    """SimpleHTTPRequestHandler with CORS headers and Range request support."""

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Range")
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        if self.path == '/__list__':
            self._handle_list_request()
            return
        return super().do_GET()

    def _handle_list_request(self):
        """Return a JSON list of all downloaded videos with metadata sidecars."""
        videos = []
        dir_path = self.directory

        if dir_path and os.path.exists(dir_path):
            for f in sorted(os.listdir(dir_path)):
                if f.endswith(('.mp4', '.mkv', '.webm')):
                    vid = os.path.splitext(f)[0]
                    filepath = os.path.join(dir_path, f)

                    # Load metadata sidecar if it exists
                    meta = {}
                    meta_path = os.path.join(dir_path, f'{vid}.json')
                    if os.path.exists(meta_path):
                        try:
                            with open(meta_path, 'r', encoding='utf-8') as mf:
                                meta = json.load(mf)
                        except Exception:
                            pass

                    port = self.server.server_address[1]
                    source = meta.get('source', 'youtube')
                    thumbnail = meta.get('thumbnail', '')
                    if not thumbnail and source == 'youtube':
                        thumbnail = f'https://img.youtube.com/vi/{vid}/hqdefault.jpg'

                    videos.append({
                        'videoId': vid,
                        'title': meta.get('title', ''),
                        'author': meta.get('author', ''),
                        'thumbnail': thumbnail,
                        'lengthSeconds': meta.get('lengthSeconds', 0),
                        'downloadDate': meta.get('downloadDate', 0),
                        'status': 'complete',
                        'fileSize': os.path.getsize(filepath),
                        'videoUrl': f'http://localhost:{port}/{f}',
                        'qualityLabel': meta.get('qualityLabel', ''),
                        'source': source,
                    })

        response = json.dumps({'type': 'list', 'videos': videos}).encode('utf-8')
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def send_head(self):
        """Handle GET/HEAD with Range request support for video seeking."""
        path = self.translate_path(self.path)

        if not os.path.exists(path):
            self.send_error(404, "File not found")
            return None

        if os.path.isdir(path):
            return super().send_head()

        file_size = os.path.getsize(path)
        content_type = mimetypes.guess_type(path)[0] or "application/octet-stream"

        range_header = self.headers.get("Range")

        if range_header and range_header.startswith("bytes="):
            range_spec = range_header[6:]
            start_str, end_str = range_spec.split("-")

            start = int(start_str) if start_str else 0
            end = int(end_str) if end_str else file_size - 1

            if start >= file_size:
                self.send_error(416, "Requested Range Not Satisfiable")
                self.send_header("Content-Range", f"bytes */{file_size}")
                return None

            end = min(end, file_size - 1)
            length = end - start + 1

            self.send_response(206)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(length))
            self.send_header("Content-Range", f"bytes {start}-{end}/{file_size}")
            self.end_headers()

            f = open(path, "rb")
            f.seek(start)
            return f

        # No Range header — send full file
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(file_size))
        self.end_headers()

        return open(path, "rb")


def main():
    parser = argparse.ArgumentParser(description="YouTube Offline video server")
    parser.add_argument("--port", type=int, default=8462)
    parser.add_argument("--dir", type=str, required=True)
    args = parser.parse_args()

    os.makedirs(args.dir, exist_ok=True)

    handler = partial(CORSRequestHandler, directory=args.dir)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    print(f"[yt_server] Serving {args.dir} on http://127.0.0.1:{args.port}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
