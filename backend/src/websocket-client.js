const crypto = require("crypto");
const net = require("net");
const tls = require("tls");
const { URL } = require("url");

function createWebSocketClient(socketUrl) {
  const requestUrl = new URL(socketUrl);
  const listeners = {
    open: [],
    message: [],
    error: [],
    close: []
  };
  const key = crypto.randomBytes(16).toString("base64");
  const port = Number(requestUrl.port) || (requestUrl.protocol === "wss:" ? 443 : 80);
  const socket = requestUrl.protocol === "wss:"
    ? tls.connect(port, requestUrl.hostname, { servername: requestUrl.hostname })
    : net.connect(port, requestUrl.hostname);
  let buffer = Buffer.alloc(0);
  let handshaken = false;
  let handshakeSent = false;

  function emit(eventName, value) {
    listeners[eventName].forEach(function (listener) {
      listener(value);
    });
  }

  function sendHandshake() {
    if (handshakeSent) {
      return;
    }

    handshakeSent = true;
    const pathWithSearch = requestUrl.pathname + requestUrl.search;

    socket.write([
      "GET " + pathWithSearch + " HTTP/1.1",
      "Host: " + requestUrl.host,
      "Upgrade: websocket",
      "Connection: Upgrade",
      "Sec-WebSocket-Key: " + key,
      "Sec-WebSocket-Version: 13",
      "",
      ""
    ].join("\r\n"));
  }

  socket.on("connect", sendHandshake);
  socket.on("secureConnect", sendHandshake);

  socket.on("data", function (chunk) {
    buffer = Buffer.concat([buffer, chunk]);

    if (!handshaken) {
      const headerEnd = buffer.indexOf("\r\n\r\n");

      if (headerEnd === -1) {
        return;
      }

      const header = buffer.slice(0, headerEnd).toString("utf8");

      if (header.indexOf(" 101 ") === -1) {
        emit("error", new Error("WebSocket handshake failed."));
        socket.destroy();
        return;
      }

      handshaken = true;
      buffer = buffer.slice(headerEnd + 4);
      emit("open");
    }

    readWebSocketFrames();
  });

  socket.on("error", function (error) {
    emit("error", error);
  });

  socket.on("close", function () {
    emit("close");
  });

  function readWebSocketFrames() {
    while (buffer.length >= 2) {
      const firstByte = buffer[0];
      const secondByte = buffer[1];
      const opcode = firstByte & 0x0f;
      let length = secondByte & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (buffer.length < offset + 2) {
          return;
        }

        length = buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (buffer.length < offset + 8) {
          return;
        }

        length = Number(buffer.readBigUInt64BE(offset));
        offset += 8;
      }

      if (buffer.length < offset + length) {
        return;
      }

      const payload = buffer.slice(offset, offset + length);
      buffer = buffer.slice(offset + length);

      if (opcode === 1) {
        emit("message", { data: payload.toString("utf8") });
      } else if (opcode === 8) {
        socket.end();
      } else if (opcode === 9) {
        writeWebSocketFrame(socket, 10, payload);
      }
    }
  }

  return {
    addEventListener: function (eventName, listener) {
      if (listeners[eventName]) {
        listeners[eventName].push(listener);
      }
    },
    send: function (message) {
      writeWebSocketFrame(socket, 1, Buffer.from(message));
    },
    close: function () {
      socket.end();
    }
  };
}

function writeWebSocketFrame(socket, opcode, payload) {
  const mask = crypto.randomBytes(4);
  let header;

  if (payload.length < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | payload.length;
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 0x80 | 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }

  const maskedPayload = Buffer.alloc(payload.length);

  for (let i = 0; i < payload.length; i += 1) {
    maskedPayload[i] = payload[i] ^ mask[i % 4];
  }

  socket.write(Buffer.concat([header, mask, maskedPayload]));
}

module.exports = {
  createWebSocketClient
};
