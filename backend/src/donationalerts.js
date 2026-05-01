const http = require("http");
const https = require("https");
const { URL } = require("url");

const {
  DEFAULT_API_BASE_URL,
  DEFAULT_EVENTS_HEARTBEAT_MS,
  DEFAULT_OAUTH_TOKEN_URL,
  DEFAULT_SOCKET_URL
} = require("./constants");
const { writeJson } = require("./http-response");

async function handleDonationAlertsToken(request, response, env, memory, donationAlertsSocketFactory) {
  try {
    const body = await readRequestJson(request);
    const accessToken = typeof body.accessToken === "string" ? body.accessToken.trim() : "";
    const authorizationCode = typeof body.authorizationCode === "string" ? body.authorizationCode.trim() : "";
    const refreshToken = typeof body.refreshToken === "string" ? body.refreshToken.trim() : "";
    const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
    const clientSecret = typeof body.clientSecret === "string" ? body.clientSecret.trim() : "";

    if (authorizationCode) {
      const redirectUri = typeof body.redirectUri === "string" ? body.redirectUri.trim() : "";

      if (!clientId || !clientSecret || !redirectUri) {
        writeJson(response, 400, {
          error: "DonationAlerts client id, client secret, and redirect uri are required."
        });
        return;
      }

      const tokenData = await donationAlertsOAuthTokenRequest(env, {
        grant_type: "authorization_code",
        code: authorizationCode,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri
      });

      storeDonationAlertsTokens(memory, {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        clientId,
        clientSecret,
        expiresIn: tokenData.expires_in
      });
      await connectDonationAlerts(env, memory, donationAlertsSocketFactory);
      writeJson(response, 200, getDonationAlertsTokenResponse(memory));
      return;
    }

    if (!accessToken) {
      writeJson(response, 400, {
        error: "DonationAlerts access token is required."
      });
      return;
    }

    storeDonationAlertsTokens(memory, {
      accessToken,
      refreshToken,
      clientId,
      clientSecret,
      expiresIn: body.expiresIn
    });
    await connectDonationAlerts(env, memory, donationAlertsSocketFactory);
    writeJson(response, 200, getDonationAlertsTokenResponse(memory));
  } catch (error) {
    writeJson(response, error.statusCode || 400, {
      error: error.message || "Request body must contain valid JSON."
    });
  }
}

function handleDonationAlertsEvents(request, response, env, memory) {
  if (!memory.donationAlertsAccessToken) {
    writeJson(response, 401, {
      error: "DonationAlerts access token is required."
    });
    return;
  }

  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.write(": connected\n\n");

  memory.donationAlertsEventClients.push(response);
  const heartbeatMs = Math.max(1, Number(env.DONATIONALERTS_EVENTS_HEARTBEAT_MS) || DEFAULT_EVENTS_HEARTBEAT_MS);
  const heartbeat = setInterval(function () {
    response.write(": ping\n\n");
  }, heartbeatMs);

  function cleanup() {
    clearInterval(heartbeat);
    memory.donationAlertsEventClients = memory.donationAlertsEventClients.filter(function (client) {
      return client !== response;
    });
  }

  request.on("close", cleanup);
  response.on("error", cleanup);
}

async function handleDonationAlertsAuth(request, response, env, memory) {
  try {
    const profile = await donationAlertsApiRequestWithRefresh(env, memory, "/user/oauth", {
      method: "GET"
    });
    const profileData = profile && profile.data ? profile.data : {};

    if (!profileData.id || !profileData.socket_connection_token) {
      throw new Error("DonationAlerts /user/oauth response does not contain id or socket_connection_token.");
    }

    writeJson(response, 200, {
      userId: profileData.id,
      socketConnectionToken: profileData.socket_connection_token,
      accessToken: memory.donationAlertsAccessToken,
      refreshToken: memory.donationAlertsRefreshToken,
      expiresIn: memory.donationAlertsTokenExpiresIn
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

    const subscription = await donationAlertsApiRequestWithRefresh(env, memory, "/centrifuge/subscribe", {
      method: "POST",
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

async function connectDonationAlerts(env, memory, donationAlertsSocketFactory) {
  if (memory.donationAlertsReconnectTimer) {
    clearTimeout(memory.donationAlertsReconnectTimer);
    memory.donationAlertsReconnectTimer = null;
  }

  memory.donationAlertsConnectionId = (memory.donationAlertsConnectionId || 0) + 1;
  const connectionId = memory.donationAlertsConnectionId;
  const previousSocket = memory.donationAlertsSocket;
  const profile = await donationAlertsApiRequestWithRefresh(env, memory, "/user/oauth", {
    method: "GET"
  });
  const profileData = profile && profile.data ? profile.data : {};
  const channel = "$alerts:donation_" + profileData.id;
  const socketUrl = env.DONATIONALERTS_SOCKET_URL || DEFAULT_SOCKET_URL;

  if (!profileData.id || !profileData.socket_connection_token) {
    throw new Error("DonationAlerts /user/oauth response does not contain id or socket_connection_token.");
  }

  if (previousSocket && typeof previousSocket.close === "function") {
    previousSocket.close();
  }

  memory.donationAlertsMessageId = 1;
  memory.donationAlertsSocket = donationAlertsSocketFactory(socketUrl);

  memory.donationAlertsSocket.addEventListener("open", function () {
    if (connectionId !== memory.donationAlertsConnectionId) {
      return;
    }

    broadcastDonationAlertsStatus(memory, {
      status: "connected",
      message: "DonationAlerts backend connected"
    });
    sendDonationAlertsSocketMessage(memory, {
      params: {
        token: profileData.socket_connection_token
      },
      id: nextDonationAlertsMessageId(memory)
    });
  });

  memory.donationAlertsSocket.addEventListener("message", function (event) {
    if (connectionId !== memory.donationAlertsConnectionId) {
      return;
    }

    handleDonationAlertsSocketMessage(env, memory, channel, event.data || event);
  });

  memory.donationAlertsSocket.addEventListener("error", function (error) {
    console.error("DonationAlerts WebSocket error.", error);
    scheduleDonationAlertsReconnect(env, memory, donationAlertsSocketFactory, connectionId);
  });

  memory.donationAlertsSocket.addEventListener("close", function () {
    scheduleDonationAlertsReconnect(env, memory, donationAlertsSocketFactory, connectionId);
  });
}

function scheduleDonationAlertsReconnect(env, memory, donationAlertsSocketFactory, connectionId) {
  const reconnectDelayMs = Math.max(1, Number(env.DONATIONALERTS_RECONNECT_DELAY_MS) || 1000);

  if (connectionId !== memory.donationAlertsConnectionId || memory.donationAlertsReconnectTimer) {
    return;
  }

  broadcastDonationAlertsStatus(memory, {
    status: "disconnected",
    message: "DonationAlerts backend connection lost"
  });

  memory.donationAlertsReconnectTimer = setTimeout(function () {
    memory.donationAlertsReconnectTimer = null;

    if (connectionId !== memory.donationAlertsConnectionId || !memory.donationAlertsAccessToken) {
      return;
    }

    broadcastDonationAlertsStatus(memory, {
      status: "reconnecting",
      message: "DonationAlerts backend reconnecting"
    });

    connectDonationAlerts(env, memory, donationAlertsSocketFactory).catch(function (error) {
      console.error("DonationAlerts WebSocket reconnect failed.", error);
      scheduleDonationAlertsReconnect(env, memory, donationAlertsSocketFactory, memory.donationAlertsConnectionId);
    });
  }, reconnectDelayMs);

  if (typeof memory.donationAlertsReconnectTimer.unref === "function") {
    memory.donationAlertsReconnectTimer.unref();
  }
}

async function handleDonationAlertsSocketMessage(env, memory, channel, rawData) {
  const message = parseDonationAlertsSocketData(rawData);
  const clientId = message && message.result && message.result.client;
  const donation = extractDonationAlertsDonation(message);

  if (!message) {
    return;
  }

  if (clientId) {
    const subscription = await donationAlertsApiRequestWithRefresh(env, memory, "/centrifuge/subscribe", {
      method: "POST",
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

async function donationAlertsApiRequestWithRefresh(env, memory, pathname, options) {
  try {
    return await donationAlertsApiRequest(env, pathname, {
      method: options.method,
      accessToken: memory.donationAlertsAccessToken,
      body: options.body
    });
  } catch (error) {
    if (error.statusCode !== 401 || !memory.donationAlertsRefreshToken) {
      throw error;
    }

    await refreshDonationAlertsAccessToken(env, memory);
    return donationAlertsApiRequest(env, pathname, {
      method: options.method,
      accessToken: memory.donationAlertsAccessToken,
      body: options.body
    });
  }
}

async function refreshDonationAlertsAccessToken(env, memory) {
  if (!memory.donationAlertsClientId || !memory.donationAlertsClientSecret) {
    const error = new Error("DonationAlerts client id and client secret are required to refresh access token.");
    error.statusCode = 401;
    throw error;
  }

  const tokenData = await donationAlertsOAuthTokenRequest(env, {
    grant_type: "refresh_token",
    refresh_token: memory.donationAlertsRefreshToken,
    client_id: memory.donationAlertsClientId,
    client_secret: memory.donationAlertsClientSecret,
    scope: "oauth-user-show oauth-donation-subscribe"
  });

  storeDonationAlertsTokens(memory, {
    accessToken: tokenData.access_token,
    refreshToken: tokenData.refresh_token || memory.donationAlertsRefreshToken,
    clientId: memory.donationAlertsClientId,
    clientSecret: memory.donationAlertsClientSecret,
    expiresIn: tokenData.expires_in
  });
  broadcastDonationAlertsToken(memory);
}

function donationAlertsOAuthTokenRequest(env, params) {
  const tokenUrl = new URL(env.DONATIONALERTS_OAUTH_TOKEN_URL || DEFAULT_OAUTH_TOKEN_URL);
  const transport = tokenUrl.protocol === "http:" ? http : https;
  const timeoutMs = Math.max(1, Number(env.DONATIONALERTS_REQUEST_TIMEOUT_MS) || 10000);
  const body = new URLSearchParams(params).toString();

  return new Promise(function (resolve, reject) {
    const tokenRequest = transport.request({
      method: "POST",
      hostname: tokenUrl.hostname,
      port: tokenUrl.port,
      path: tokenUrl.pathname + tokenUrl.search,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body)
      }
    }, function (tokenResponse) {
      let responseBody = "";

      tokenResponse.on("data", function (chunk) {
        responseBody += chunk;
      });

      tokenResponse.on("end", function () {
        if (tokenResponse.statusCode < 200 || tokenResponse.statusCode >= 300) {
          const error = new Error("DonationAlerts OAuth token request failed with HTTP " + tokenResponse.statusCode);
          error.statusCode = tokenResponse.statusCode;
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

    tokenRequest.on("error", reject);
    tokenRequest.setTimeout(timeoutMs, function () {
      const error = new Error("DonationAlerts OAuth token request timed out.");
      error.statusCode = 504;
      tokenRequest.destroy(error);
    });
    tokenRequest.write(body);
    tokenRequest.end();
  });
}

function storeDonationAlertsTokens(memory, tokens) {
  memory.donationAlertsAccessToken = tokens.accessToken || "";
  memory.donationAlertsRefreshToken = tokens.refreshToken || "";
  memory.donationAlertsClientId = tokens.clientId || "";
  memory.donationAlertsClientSecret = tokens.clientSecret || "";
  memory.donationAlertsTokenExpiresIn = Number(tokens.expiresIn) || null;
}

function getDonationAlertsTokenResponse(memory) {
  const response = {
    ok: true
  };

  if (memory.donationAlertsAccessToken && memory.donationAlertsRefreshToken) {
    response.accessToken = memory.donationAlertsAccessToken;
  }

  if (memory.donationAlertsRefreshToken) {
    response.refreshToken = memory.donationAlertsRefreshToken;
  }

  if (memory.donationAlertsTokenExpiresIn) {
    response.expiresIn = memory.donationAlertsTokenExpiresIn;
  }

  return response;
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

function broadcastDonationAlertsStatus(memory, status) {
  const payload = "event: status\n" + "data: " + JSON.stringify(status) + "\n\n";

  memory.donationAlertsEventClients.forEach(function (client) {
    client.write(payload);
  });
}

function broadcastDonationAlertsToken(memory) {
  const payload = "event: token\n" + "data: " + JSON.stringify(getDonationAlertsTokenResponse(memory)) + "\n\n";

  memory.donationAlertsEventClients.forEach(function (client) {
    client.write(payload);
  });
}

function nextDonationAlertsMessageId(memory) {
  memory.donationAlertsMessageId += 1;
  return memory.donationAlertsMessageId;
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

module.exports = {
  handleDonationAlertsAuth,
  handleDonationAlertsEvents,
  handleDonationAlertsSubscribe,
  handleDonationAlertsToken
};
