import struct, json, subprocess, sys, os

# Determine host path based on platform
if sys.platform == "win32":
    host_path = os.path.join(os.environ.get("APPDATA", ""), "YouTubeOffline", "yt_offline_host.py")
else:
    host_path = os.path.expanduser("~/.youtube-offline/yt_offline_host.py")

if not os.path.exists(host_path):
    # Fall back to local copy
    host_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "yt_offline_host.py")

msg = json.dumps({'action': 'list'}).encode('utf-8')
encoded = struct.pack('=I', len(msg)) + msg

proc = subprocess.Popen(
    [sys.executable, host_path],
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE
)
proc.stdin.write(encoded)
proc.stdin.flush()

while True:
    raw_len = proc.stdout.read(4)
    if len(raw_len) < 4:
        break
    msg_len = struct.unpack('=I', raw_len)[0]
    data = proc.stdout.read(msg_len)
    msg = json.loads(data.decode('utf-8'))
    mtype = msg.get('type', '')
    print(f'[{mtype}] {json.dumps(msg, ensure_ascii=False)[:300]}')
    if mtype in ('complete', 'error', 'list', 'status'):
        break

proc.stdin.close()
proc.terminate()
