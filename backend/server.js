const fs = require("fs");
const crypto = require("crypto");
const http = require("http");
const https = require("https");
const net = require("net");
const path = require("path");
const tls = require("tls");
const { URL } = require("url");

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_API_BASE_URL = "https://www.donationalerts.com/api/v1";
const DEFAULT_SOCKET_URL = "wss://centrifugo.donationalerts.com/connection/websocket";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8"
};

function createServer(options) {
  options = options || {};

  const projectRoot = options.rootDir || path.resolve(__dirname, "..");
  const frontendDir = options.frontendDir || path.join(projectRoot, "frontend");
  const uploadsDir = options.uploadsDir || path.join(projectRoot, "uploads");
  const env = Object.assign({}, parseEnvFile(path.join(projectRoot, ".env")), process.env, options.env || {});
  const donationAlertsSocketFactory = options.donationAlertsSocketFactory || createWebSocketClient;
  const memory = {
    donationAlertsAccessToken: "",
    donationAlertsSocket: null,
    donationAlertsMessageId: 1,
    donationAlertsEventClients: []
  };

  return http.createServer(function (request, response) {
    if (request.url === "/api/donationalerts/token" && request.method === "POST") {
      handleDonationAlertsToken(request, response, env, memory, donationAlertsSocketFactory);
      return;
    }

    if (request.url === "/api/donationalerts/events" && request.method === "GET") {
      handleDonationAlertsEvents(request, response, memory);
      return;
    }

    if (request.url === "/api/donationalerts/auth" && request.method === "GET") {
      handleDonationAlertsAuth(request, response, env, memory);
      return;
    }

    if (request.url === "/api/donationalerts/subscribe" && request.method === "POST") {
      handleDonationAlertsSubscribe(request, response, env, memory);
      return;
    }

    serveStaticRequest(request, response, frontendDir, uploadsDir);
  });
}

async function handleDonationAlertsToken(request, response, env, memory, donationAlertsSocketFactory) {
  try {
    const body = await readRequestJson(request);
    const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";

    if (!accessToken) {
      writeJson(response, 400, {
        error: "DonationAlerts access token is required."
      });
      return;
    }

    memory.donationAlertsAccessToken = accessToken;
    await connectDonationAlerts(env, memory, donationAlertsSocketFactory);
    writeJson(response, 200, { ok: true });
  } catch (error) {
    writeJson(response, error.statusCode || 400, {
      error: error.message || "Request body must contain valid JSON."
    });
  }
}

function handleDonationAlertsEvents(request, response, memory) {
  if (!memory.donationAlertsAccessToken) {
    writeJson(response, 401, {
      error: "DonationAlerts access token is required."
    });
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });
  response.write("\n");

  memory.donationAlertsEventClients.push(response);

  request.on("close", function () {
    memory.donationAlertsEventClients = memory.donationAlertsEventClients.filter(function (client) {
      return client !== response;
    });
  });
}

async function connectDonationAlerts(env, memory, donationAlertsSocketFactory) {
  const profile = await donationAlertsApiRequest(env, "/user/oauth", {
    method: "GET",
    accessToken: memory.donationAlertsAccessToken
  });
  const profileData = profile && profile.data ? profile.data : {};
  const channel = "$alerts:donation_" + profileData.id;
  const socketUrl = env.DONATIONALERTS_SOCKET_URL || DEFAULT_SOCKET_URL;

  if (!profileData.id || !profileData.socket_connection_token) {
    throw new Error("DonationAlerts /user/oauth response does not contain id or socket_connection_token.");
  }

  if (memory.donationAlertsSocket && typeof memory.donationAlertsSocket.close === "function") {
    memory.donationAlertsSocket.close();
  }

  memory.donationAlertsMessageId = 1;
  memory.donationAlertsSocket = donationAlertsSocketFactory(socketUrl);

  memory.donationAlertsSocket.addEventListener("open", function () {
    sendDonationAlertsSocketMessage(memory, {
      params: {
        token: profileData.socket_connection_token
      },
      id: nextDonationAlertsMessageId(memory)
    });
  });

  memory.donationAlertsSocket.addEventListener("message", function (event) {
    handleDonationAlertsSocketMessage(env, memory, channel, event.data || event);
  });

  memory.donationAlertsSocket.addEventListener("error", function (error) {
    console.error("DonationAlerts WebSocket error.", error);
  });
}

async function handleDonationAlertsSocketMessage(env, memory, channel, rawData) {
  const message = parseDonationAlertsSocketData(rawData);
  const clientId = message && message.result && message.result.client;
  const donation = extractDonationAlertsDonation(message);

  if (!message) {
    return;
  }

  if (clientId) {
    const subscription = await donationAlertsApiRequest(env, "/centrifuge/subscribe", {
      method: "POST",
      accessToken: memory.donationAlertsAccessToken,
      body: JSON.stringify({
        channels: [channel],
        client: clientId
      })
    });
    const channels = subscription && Array.isArray(subscription.channels) ? subscription.channels : [];
    const channelSubscription = channels.find(function (item) {
      return item.channel === channel;
    }) || channels[0];

    if (!channelSubscription || !channelSubscription.token) {
      console.error("DonationAlerts subscribe response does not contain a channel token.");
      return;
    }

    sendDonationAlertsSocketMessage(memory, {
      params: {
        channel: channelSubscription.channel || channel,
        token: channelSubscription.token
      },
      method: 1,
      id: nextDonationAlertsMessageId(memory)
    });
    console.warn("DonationAlerts channel subscribed:", channelSubscription.channel || channel);
    return;
  }

  if (donation) {
    broadcastDonationAlertsEvent(memory, donation);
  }
}

function sendDonationAlertsSocketMessage(memory, message) {
  if (!memory.donationAlertsSocket || typeof memory.donationAlertsSocket.send !== "function") {
    return;
  }

  memory.donationAlertsSocket.send(JSON.stringify(message));
}

function parseDonationAlertsSocketData(rawData) {
  try {
    return JSON.parse(rawData);
  } catch (error) {
    console.warn("DonationAlerts WebSocket message is not valid JSON.", rawData, error);
    return null;
  }
}

function extractDonationAlertsDonation(message) {
  const candidates = [
    message,
    message && message.data,
    message && message.params && message.params.data,
    message && message.result && message.result.data,
    message && message.result && message.result.data && message.result.data.data,
    message && message.result && message.result.data && message.result.data.alert
  ];

  for (let i = 0; i < candidates.length; i += 1) {
    const donation = normalizeDonationAlertsDonation(candidates[i]);

    if (donation) {
      return donation;
    }
  }

  return null;
}

function normalizeDonationAlertsDonation(value) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const amount = Number(value.amount);

  if (!Number.isFinite(amount)) {
    return null;
  }

  return {
    id: value.id || null,
    username: value.username || value.name || "",
    amount: amount,
    currency: value.currency || ""
  };
}

function broadcastDonationAlertsEvent(memory, donation) {
  const payload = "data: " + JSON.stringify(donation) + "\n\n";

  memory.donationAlertsEventClients.forEach(function (client) {
    client.write(payload);
  });
}

function nextDonationAlertsMessageId(memory) {
  memory.donationAlertsMessageId += 1;
  return memory.donationAlertsMessageId;
}

async function handleDonationAlertsAuth(request, response, env, memory) {
  try {
    const profile = await donationAlertsApiRequest(env, "/user/oauth", {
      method: "GET",
      accessToken: memory.donationAlertsAccessToken
    });
    const profileData = profile && profile.data ? profile.data : {};

    if (!profileData.id || !profileData.socket_connection_token) {
      throw new Error("DonationAlerts /user/oauth response does not contain id or socket_connection_token.");
    }

    writeJson(response, 200, {
      userId: profileData.id,
      socketConnectionToken: profileData.socket_connection_token
    });
  } catch (error) {
    writeJson(response, error.statusCode || 500, {
      error: error.message
    });
  }
}

async function handleDonationAlertsSubscribe(request, response, env, memory) {
  try {
    const body = await readRequestJson(request);

    if (!Array.isArray(body.channels) || typeof body.client !== "string" || !body.client) {
      writeJson(response, 400, {
        error: "Request body must contain channels array and client string."
      });
      return;
    }

    const subscription = await donationAlertsApiRequest(env, "/centrifuge/subscribe", {
      method: "POST",
      accessToken: memory.donationAlertsAccessToken,
      body: JSON.stringify({
        channels: body.channels,
        client: body.client
      })
    });

    writeJson(response, 200, subscription);
  } catch (error) {
    writeJson(response, error.statusCode || 500, {
      error: error.message
    });
  }
}

function donationAlertsApiRequest(env, pathname, options) {
  const accessToken = options.accessToken;

  if (!accessToken) {
    const error = new Error("DonationAlerts access token is required.");
    error.statusCode = 401;
    throw error;
  }

  const apiBaseUrl = env.DONATIONALERTS_API_BASE_URL || DEFAULT_API_BASE_URL;
  const timeoutMs = Math.max(1, Number(env.DONATIONALERTS_REQUEST_TIMEOUT_MS) || 10000);
  const requestUrl = new URL(apiBaseUrl + pathname);
  const transport = requestUrl.protocol === "http:" ? http : https;
  const body = options.body || "";

  return new Promise(function (resolve, reject) {
    const apiRequest = transport.request({
      method: options.method,
      hostname: requestUrl.hostname,
      port: requestUrl.port,
      path: requestUrl.pathname + requestUrl.search,
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    }, function (apiResponse) {
      let responseBody = "";

      apiResponse.on("data", function (chunk) {
        responseBody += chunk;
      });

      apiResponse.on("end", function () {
        if (apiResponse.statusCode < 200 || apiResponse.statusCode >= 300) {
          const error = new Error("DonationAlerts API " + pathname + " failed with HTTP " + apiResponse.statusCode);
          error.statusCode = apiResponse.statusCode;
          reject(error);
          return;
        }

        try {
          resolve(responseBody ? JSON.parse(responseBody) : {});
        } catch (error) {
          reject(error);
        }
      });
    });

    apiRequest.on("error", reject);
    apiRequest.setTimeout(timeoutMs, function () {
      const error = new Error("DonationAlerts API " + pathname + " timed out.");
      error.statusCode = 504;
      apiRequest.destroy(error);
    });

    if (body) {
      apiRequest.write(body);
    }

    apiRequest.end();
  });
}

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

function readRequestJson(request) {
  return new Promise(function (resolve, reject) {
    let body = "";

    request.on("data", function (chunk) {
      body += chunk;
    });

    request.on("end", function () {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function serveStaticRequest(request, response, frontendDir, uploadsDir) {
  const requestUrl = new URL(request.url, "http://localhost");
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname.indexOf("/uploads/") === 0) {
    serveStaticFile(response, uploadsDir, pathname.slice("/uploads/".length));
    return;
  }

  serveStaticFile(response, frontendDir, pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
}

function serveStaticFile(response, baseDir, relativePath) {
  const resolvedBaseDir = path.resolve(baseDir);
  const filePath = path.resolve(resolvedBaseDir, relativePath);

  if (!filePath.startsWith(resolvedBaseDir + path.sep) && filePath !== resolvedBaseDir) {
    writeText(response, 403, "Forbidden");
    return;
  }

  fs.stat(filePath, function (statError, stats) {
    if (statError || !stats.isFile()) {
      writeText(response, 404, "Not found");
      return;
    }

    response.statusCode = 200;
    response.setHeader("Content-Type", MIME_TYPES[path.extname(filePath)] || "application/octet-stream");
    fs.createReadStream(filePath).pipe(response);
  });
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).reduce(function (result, line) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.charAt(0) === "#") {
      return result;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      return result;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if ((value.charAt(0) === "\"" && value.charAt(value.length - 1) === "\"") ||
        (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'")) {
      value = value.slice(1, -1);
    }

    result[key] = value;
    return result;
  }, {});
}

function writeJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function writeText(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(body);
}

if (require.main === module) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const host = process.env.HOST || DEFAULT_HOST;

  createServer().listen(port, host, function () {
    console.log("OBS Prize Roulette server: http://" + host + ":" + port + "/");
  });
}

module.exports = {
  createServer,
  parseEnvFile
};
