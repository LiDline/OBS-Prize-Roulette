const assert = require("assert");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const EventEmitter = require("events");

const server = require("../server");

function listen(app) {
  return new Promise(function (resolve, reject) {
    const instance = app.listen(0, "127.0.0.1", function () {
      resolve(instance);
    });

    instance.on("error", reject);
  });
}

function close(instance) {
  return new Promise(function (resolve, reject) {
    instance.close(function (error) {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function requestJson(baseUrl, pathname, options) {
  options = options || {};
  const requestUrl = new URL(baseUrl + pathname);

  return new Promise(function (resolve, reject) {
    const request = http.request({
      method: options.method || "GET",
      hostname: requestUrl.hostname,
      port: requestUrl.port,
      path: requestUrl.pathname,
      headers: options.headers || {}
    }, function (response) {
      let body = "";

      response.on("data", function (chunk) {
        body += chunk;
      });

      response.on("end", function () {
        try {
          resolve({
            status: response.statusCode,
            body: body ? JSON.parse(body) : {}
          });
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("error", reject);

    if (options.body) {
      request.write(options.body);
    }

    request.end();
  });
}

function requestText(baseUrl, pathname) {
  const requestUrl = new URL(baseUrl + pathname);

  return new Promise(function (resolve, reject) {
    const request = http.request({
      method: "GET",
      hostname: requestUrl.hostname,
      port: requestUrl.port,
      path: requestUrl.pathname
    }, function (response) {
      let body = "";

      response.on("data", function (chunk) {
        body += chunk;
      });

      response.on("end", function () {
        resolve({
          status: response.statusCode,
          contentType: response.headers["content-type"],
          body: body
        });
      });
    });

    request.on("error", reject);
    request.end();
  });
}

function openEventStream(baseUrl, pathname) {
  const requestUrl = new URL(baseUrl + pathname);
  const events = [];
  const comments = [];

  const stream = {
    events,
    comments,
    close: function () {
      if (stream.request) {
        stream.request.destroy();
      }
    }
  };

  stream.ready = new Promise(function (resolve, reject) {
    const request = http.request({
      method: "GET",
      hostname: requestUrl.hostname,
      port: requestUrl.port,
      path: requestUrl.pathname,
      headers: {
        Accept: "text/event-stream"
      }
    }, function (response) {
      stream.response = response;
      resolve(stream);

      response.on("data", function (chunk) {
        String(chunk).split(/\n\n/).forEach(function (eventBlock) {
          if (!eventBlock.trim()) {
            return;
          }

          const dataLine = eventBlock.split(/\n/).find(function (line) {
            return line.indexOf("data: ") === 0;
          });
          const commentLine = eventBlock.split(/\n/).find(function (line) {
            return line.indexOf(": ") === 0;
          });

          if (dataLine) {
            events.push(JSON.parse(dataLine.slice("data: ".length)));
          } else if (commentLine) {
            comments.push(commentLine.slice(": ".length));
          }
        });
      });
    });

    request.on("error", reject);
    request.end();
    stream.request = request;
  });

  return stream;
}

function createFakeDonationAlertsSocketFactory() {
  const sockets = [];

  return {
    sockets,
    factory: function (url) {
      const socket = new EventEmitter();
      socket.url = url;
      socket.sent = [];
      socket.send = function (message) {
        socket.sent.push(JSON.parse(message));
      };
      socket.close = function () {
        socket.emit("close");
      };
      socket.addEventListener = socket.on.bind(socket);
      sockets.push(socket);
      return socket;
    }
  };
}

function waitForCondition(predicate) {
  return new Promise(function (resolve, reject) {
    const startedAt = Date.now();

    function check() {
      if (predicate()) {
        resolve();
        return;
      }

      if (Date.now() - startedAt > 1000) {
        reject(new Error("Timed out waiting for condition."));
        return;
      }

      setTimeout(check, 10);
    }

    check();
  });
}

function createDonationAlertsStub() {
  const requests = [];
  const app = http.createServer(function (request, response) {
    let body = "";

    request.on("data", function (chunk) {
      body += chunk;
    });

    request.on("end", function () {
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.authorization,
        body: body
      });

      if (request.url === "/user/oauth" && request.method === "GET") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({
          data: {
            id: 321,
            socket_connection_token: "socket-token"
          }
        }));
        return;
      }

      if (request.url === "/centrifuge/subscribe" && request.method === "POST") {
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({
          channels: [
            {
              channel: "$alerts:donation_321",
              token: "channel-token"
            }
          ]
        }));
        return;
      }

      response.statusCode = 404;
      response.end(JSON.stringify({ error: "not found" }));
    });
  });

  return {
    app,
    requests
  };
}

function createHangingDonationAlertsStub() {
  return http.createServer(function () {
  });
}

(async function () {
  const startupRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roulette-startup-"));
  const startupFrontendDir = path.join(startupRoot, "frontend");
  const startupUploadsDir = path.join(startupRoot, "uploads");
  fs.mkdirSync(startupFrontendDir, { recursive: true });
  fs.mkdirSync(startupUploadsDir);
  fs.writeFileSync(path.join(startupFrontendDir, "index.html"), "<!doctype html><title>startup</title>");
  fs.writeFileSync(path.join(startupUploadsDir, "Startup Prize.png"), "png");

  const startupInstance = await server.startServer({
    rootDir: startupRoot,
    host: "127.0.0.1",
    port: 0,
    log: function () {}
  });
  const startupUrl = "http://127.0.0.1:" + startupInstance.address().port;

  try {
    const manifest = await requestText(startupUrl, "/js/uploaded-images.js");
    assert.strictEqual(manifest.status, 200, "startup serves generated image manifest");
    assert.ok(
      manifest.body.indexOf("\"uploads/Startup Prize.png\"") !== -1,
      "startup refreshes uploaded image manifest before serving frontend"
    );
  } finally {
    await close(startupInstance);
  }

  const staticRoot = fs.mkdtempSync(path.join(os.tmpdir(), "roulette-static-"));
  const frontendDir = path.join(staticRoot, "frontend");
  const uploadsDir = path.join(staticRoot, "uploads");
  fs.mkdirSync(frontendDir);
  fs.mkdirSync(uploadsDir);
  fs.writeFileSync(path.join(frontendDir, "index.html"), "<!doctype html><title>frontend</title>");
  fs.writeFileSync(path.join(uploadsDir, "Prize.png"), "png");

  const staticOverlayServer = server.createServer({
    frontendDir,
    uploadsDir,
    env: {}
  });
  const staticOverlayInstance = await listen(staticOverlayServer);
  const staticOverlayUrl = "http://127.0.0.1:" + staticOverlayInstance.address().port;

  try {
    const index = await requestText(staticOverlayUrl, "/");
    assert.strictEqual(index.status, 200, "root serves frontend index");
    assert.strictEqual(index.body, "<!doctype html><title>frontend</title>");

    const upload = await requestText(staticOverlayUrl, "/uploads/Prize.png");
    assert.strictEqual(upload.status, 200, "uploads are served outside frontend");
    assert.strictEqual(upload.contentType, "image/png");
    assert.strictEqual(upload.body, "png");
  } finally {
    await close(staticOverlayInstance);
  }

  const donationAlerts = createDonationAlertsStub();
  const donationAlertsServer = await listen(donationAlerts.app);
  const donationAlertsUrl = "http://127.0.0.1:" + donationAlertsServer.address().port;
  const fakeSocket = createFakeDonationAlertsSocketFactory();

  const overlayServer = server.createServer({
    rootDir: process.cwd(),
    donationAlertsSocketFactory: fakeSocket.factory,
    env: {
      DONATIONALERTS_API_BASE_URL: donationAlertsUrl,
      DONATIONALERTS_SOCKET_URL: "ws://127.0.0.1/donation-alerts",
      DONATIONALERTS_EVENTS_HEARTBEAT_MS: "10"
    }
  });
  const overlayInstance = await listen(overlayServer);
  const overlayUrl = "http://127.0.0.1:" + overlayInstance.address().port;
  let eventStream = null;

  try {
    const token = await requestJson(overlayUrl, "/api/donationalerts/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: "access-token" })
    });
    assert.strictEqual(token.status, 200, "token endpoint stores access token in server memory");
    assert.deepStrictEqual(token.body, { ok: true });

    assert.strictEqual(fakeSocket.sockets.length, 1, "backend opens DonationAlerts socket after token is stored");
    assert.strictEqual(fakeSocket.sockets[0].url, "ws://127.0.0.1/donation-alerts");

    eventStream = openEventStream(overlayUrl, "/api/donationalerts/events");
    await eventStream.ready;
    await waitForCondition(function () {
      return eventStream.comments.length >= 2;
    });
    assert.deepStrictEqual(
      eventStream.comments.slice(0, 2),
      ["connected", "ping"],
      "event stream sends an initial comment and heartbeat comments"
    );

    fakeSocket.sockets[0].emit("open");
    assert.deepStrictEqual(fakeSocket.sockets[0].sent[0], {
      params: {
        token: "socket-token"
      },
      id: 2
    });

    fakeSocket.sockets[0].emit("message", {
      data: JSON.stringify({
        result: {
          client: "client-id"
        }
      })
    });
    await waitForCondition(function () {
      return fakeSocket.sockets[0].sent.length === 2;
    });
    assert.deepStrictEqual(fakeSocket.sockets[0].sent[1], {
      params: {
        channel: "$alerts:donation_321",
        token: "channel-token"
      },
      method: 1,
      id: 3
    });

    fakeSocket.sockets[0].emit("message", {
      data: JSON.stringify({
        result: {
          data: {
            amount: 1000,
            username: "donor",
            currency: "RUB"
          }
        }
      })
    });
    await waitForCondition(function () {
      return eventStream.events.length === 1;
    });
    assert.deepStrictEqual(eventStream.events[0], {
      amount: 1000,
      username: "donor",
      currency: "RUB",
      id: null
    });

    assert.deepStrictEqual(
      donationAlerts.requests.map(function (request) {
        return {
          method: request.method,
          url: request.url,
          authorization: request.authorization,
          body: request.body
        };
      }),
      [
        {
          method: "GET",
          url: "/user/oauth",
          authorization: "Bearer access-token",
          body: ""
        },
        {
          method: "POST",
          url: "/centrifuge/subscribe",
          authorization: "Bearer access-token",
          body: JSON.stringify({
            channels: ["$alerts:donation_321"],
            client: "client-id"
          })
        }
      ],
      "backend owns DonationAlerts API calls after token is stored"
    );
  } finally {
    if (eventStream) {
      eventStream.close();
    }
    await close(overlayInstance);
    await close(donationAlertsServer);
  }

  const envTokenDonationAlerts = createDonationAlertsStub();
  const envTokenDonationAlertsServer = await listen(envTokenDonationAlerts.app);
  const envTokenDonationAlertsUrl = "http://127.0.0.1:" + envTokenDonationAlertsServer.address().port;
  const legacyEnvTokenName = "DONATIONALERTS_" + "ACCESS_TOKEN";
  const envWithLegacyToken = {
    DONATIONALERTS_API_BASE_URL: envTokenDonationAlertsUrl
  };
  envWithLegacyToken[legacyEnvTokenName] = "ignored-env-token";
  const envTokenOverlayServer = server.createServer({
    rootDir: process.cwd(),
    env: envWithLegacyToken
  });
  const envTokenOverlayInstance = await listen(envTokenOverlayServer);
  const envTokenOverlayUrl = "http://127.0.0.1:" + envTokenOverlayInstance.address().port;

  try {
    const envTokenAuth = await requestJson(envTokenOverlayUrl, "/api/donationalerts/auth");
    assert.strictEqual(envTokenAuth.status, 401, "auth rejects requests without memory access token");
    assert.deepStrictEqual(envTokenAuth.body, {
      error: "DonationAlerts access token is required."
    });
    assert.deepStrictEqual(envTokenDonationAlerts.requests, [], "server ignores legacy env access token");
  } finally {
    await close(envTokenOverlayInstance);
    await close(envTokenDonationAlertsServer);
  }

  const browserTokenDonationAlerts = createDonationAlertsStub();
  const browserTokenDonationAlertsServer = await listen(browserTokenDonationAlerts.app);
  const browserTokenDonationAlertsUrl = "http://127.0.0.1:" + browserTokenDonationAlertsServer.address().port;
  const browserTokenSocket = createFakeDonationAlertsSocketFactory();
  const browserTokenOverlayServer = server.createServer({
    rootDir: process.cwd(),
    donationAlertsSocketFactory: browserTokenSocket.factory,
    env: {
      DONATIONALERTS_API_BASE_URL: browserTokenDonationAlertsUrl,
      DONATIONALERTS_SOCKET_URL: "ws://127.0.0.1/donation-alerts"
    }
  });
  const browserTokenOverlayInstance = await listen(browserTokenOverlayServer);
  const browserTokenOverlayUrl = "http://127.0.0.1:" + browserTokenOverlayInstance.address().port;

  try {
    const token = await requestJson(browserTokenOverlayUrl, "/api/donationalerts/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: "browser-token" })
    });
    assert.strictEqual(token.status, 200, "token endpoint accepts browser-provided access token once");

    assert.deepStrictEqual(
      browserTokenDonationAlerts.requests.map(function (request) {
        return request.authorization;
      }),
      ["Bearer browser-token"],
      "server authenticates DonationAlerts once when token is stored"
    );
  } finally {
    await close(browserTokenOverlayInstance);
    await close(browserTokenDonationAlertsServer);
  }

  const restartedDonationAlerts = createDonationAlertsStub();
  const restartedDonationAlertsServer = await listen(restartedDonationAlerts.app);
  const restartedDonationAlertsUrl = "http://127.0.0.1:" + restartedDonationAlertsServer.address().port;
  const beforeRestartSocket = createFakeDonationAlertsSocketFactory();
  const beforeRestartOverlayServer = server.createServer({
    rootDir: process.cwd(),
    donationAlertsSocketFactory: beforeRestartSocket.factory,
    env: {
      DONATIONALERTS_API_BASE_URL: restartedDonationAlertsUrl,
      DONATIONALERTS_SOCKET_URL: "ws://127.0.0.1/donation-alerts"
    }
  });
  const beforeRestartOverlayInstance = await listen(beforeRestartOverlayServer);
  const beforeRestartOverlayUrl = "http://127.0.0.1:" + beforeRestartOverlayInstance.address().port;

  try {
    const token = await requestJson(beforeRestartOverlayUrl, "/api/donationalerts/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: "temporary-token" })
    });
    assert.strictEqual(token.status, 200, "first server instance stores token");
  } finally {
    await close(beforeRestartOverlayInstance);
  }

  const afterRestartOverlayServer = server.createServer({
    rootDir: process.cwd(),
    env: {
      DONATIONALERTS_API_BASE_URL: restartedDonationAlertsUrl
    }
  });
  const afterRestartOverlayInstance = await listen(afterRestartOverlayServer);
  const afterRestartOverlayUrl = "http://127.0.0.1:" + afterRestartOverlayInstance.address().port;

  try {
    const requestsBeforeRestartAuth = restartedDonationAlerts.requests.length;
    const authAfterRestart = await requestJson(afterRestartOverlayUrl, "/api/donationalerts/auth");
    assert.strictEqual(authAfterRestart.status, 401, "new server instance starts without stored token");
    assert.strictEqual(
      restartedDonationAlerts.requests.length,
      requestsBeforeRestartAuth,
      "new server instance does not reuse old token"
    );
  } finally {
    await close(afterRestartOverlayInstance);
    await close(restartedDonationAlertsServer);
  }

  const hangingDonationAlertsServer = await listen(createHangingDonationAlertsStub());
  const hangingDonationAlertsUrl = "http://127.0.0.1:" + hangingDonationAlertsServer.address().port;
  const timeoutOverlayServer = server.createServer({
    rootDir: process.cwd(),
    env: {
      DONATIONALERTS_API_BASE_URL: hangingDonationAlertsUrl,
      DONATIONALERTS_REQUEST_TIMEOUT_MS: "10"
    }
  });
  const timeoutOverlayInstance = await listen(timeoutOverlayServer);
  const timeoutOverlayUrl = "http://127.0.0.1:" + timeoutOverlayInstance.address().port;

  try {
    await requestJson(timeoutOverlayUrl, "/api/donationalerts/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessToken: "access-token" })
    });
    const timeoutResponse = await requestJson(timeoutOverlayUrl, "/api/donationalerts/auth");
    assert.strictEqual(timeoutResponse.status, 504, "auth endpoint returns gateway timeout");
    assert.deepStrictEqual(timeoutResponse.body, {
      error: "DonationAlerts API /user/oauth timed out."
    });
  } finally {
    await close(timeoutOverlayInstance);
    await close(hangingDonationAlertsServer);
  }
}()).catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
