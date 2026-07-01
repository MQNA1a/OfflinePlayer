' Silently launch yt_server.py on login (no console window)
Set sh = CreateObject("WScript.Shell")
appData = sh.ExpandEnvironmentStrings("%APPDATA%")
sh.Run "python """ & appData & "\YouTubeOffline\yt_server.py"" --port 8462 --dir """ & sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\YouTube Offline\videos""", 0, False
