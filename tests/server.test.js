const assert = require("assert");
const http = require("http");

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
  const donationAlerts = createDonationAlertsStub();
  const donationAlertsServer = await listen(donationAlerts.app);
  const donationAlertsUrl = "http://127.0.0.1:" + donationAlertsServer.address().port;

  const overlayServer = server.createServer({
    rootDir: process.cwd(),
    env: {
      DONATIONALERTS_API_BASE_URL: donationAlertsUrl
    }
  });
  const overlayInstance = await listen(overlayServer);
  const overlayUrl = "http://127.0.0.1:" + overlayInstance.address().port;

  try {
    const auth = await requestJson(overlayUrl, "/api/donationalerts/auth", {
      headers: { Authorization: "Bearer access-token" }
    });
    assert.strictEqual(auth.status, 200, "auth endpoint responds with success");
    assert.deepStrictEqual(auth.body, {
      userId: 321,
      socketConnectionToken: "socket-token"
    });

    const subscribe = await requestJson(overlayUrl, "/api/donationalerts/subscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer access-token"
      },
      body: JSON.stringify({
        channels: ["$alerts:donation_321"],
        client: "client-id"
      })
    });
    assert.strictEqual(subscribe.status, 200, "subscribe endpoint responds with success");
    assert.deepStrictEqual(subscribe.body, {
      channels: [
        {
          channel: "$alerts:donation_321",
          token: "channel-token"
        }
      ]
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
      "server sends authorized API requests to DonationAlerts"
    );
  } finally {
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
    assert.strictEqual(envTokenAuth.status, 401, "auth rejects requests without browser access token");
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
  const browserTokenOverlayServer = server.createServer({
    rootDir: process.cwd(),
    env: {
      DONATIONALERTS_API_BASE_URL: browserTokenDonationAlertsUrl
    }
  });
  const browserTokenOverlayInstance = await listen(browserTokenOverlayServer);
  const browserTokenOverlayUrl = "http://127.0.0.1:" + browserTokenOverlayInstance.address().port;

  try {
    const browserTokenAuth = await requestJson(browserTokenOverlayUrl, "/api/donationalerts/auth", {
      headers: { Authorization: "Bearer browser-token" }
    });
    assert.strictEqual(browserTokenAuth.status, 200, "auth accepts browser-provided access token");

    const browserTokenSubscribe = await requestJson(browserTokenOverlayUrl, "/api/donationalerts/subscribe", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer browser-token"
      },
      body: JSON.stringify({
        channels: ["$alerts:donation_321"],
        client: "client-id"
      })
    });
    assert.strictEqual(browserTokenSubscribe.status, 200, "subscribe accepts browser-provided access token");

    assert.deepStrictEqual(
      browserTokenDonationAlerts.requests.map(function (request) {
        return request.authorization;
      }),
      ["Bearer browser-token", "Bearer browser-token"],
      "server forwards browser-provided access token to DonationAlerts"
    );
  } finally {
    await close(browserTokenOverlayInstance);
    await close(browserTokenDonationAlertsServer);
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
    const timeoutResponse = await requestJson(timeoutOverlayUrl, "/api/donationalerts/auth", {
      headers: { Authorization: "Bearer access-token" }
    });
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
