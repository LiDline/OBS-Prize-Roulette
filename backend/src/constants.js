const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_API_BASE_URL = "https://www.donationalerts.com/api/v1";
const DEFAULT_SOCKET_URL = "wss://centrifugo.donationalerts.com/connection/websocket";
const DEFAULT_EVENTS_HEARTBEAT_MS = 15000;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8"
};

module.exports = {
  DEFAULT_API_BASE_URL,
  DEFAULT_EVENTS_HEARTBEAT_MS,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_SOCKET_URL,
  MIME_TYPES
};
