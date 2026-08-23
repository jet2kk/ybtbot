# Pate Music v5.3.3 - Lavalink Bot Fixed

Fixes the crash shown in the log:
- `ERR_UNHANDLED_ERROR` from `lavalink-client` NodeManager when the WebSocket returns 502/1006.
- Removes the invalid `RepeatMode` named import.
- Uses string repeat modes: `track`, `queue`, `off`.
- Adds NodeManager `error`, `connect`, `reconnecting`, `reconnectinprogress`, `disconnect`, and `resumed` listeners before `manager.init()`.
- Temporary Lavalink outages no longer crash the process; the client keeps retrying.
- Health endpoint reports the Bot process healthy while Lavalink reconnects, preventing a Fly restart loop.
- Keeps one `play()` call for initial playback; trackEnd does not call `play()`.

Environment:
DISCORD_TOKEN=...
LAVALINK_HOST=your-render-host.onrender.com
LAVALINK_PORT=443
LAVALINK_SECURE=true
LAVALINK_PASSWORD=the-same-password-as-render
DEFAULT_PREFIX=!
PLAYING_ICON=🐱
PORT=8080

Do not put `https://` inside LAVALINK_HOST.
