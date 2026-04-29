(function (window) {
  "use strict";

  var app = window.RouletteApp;
  var state = app.state;
  var DONATION_ALERTS_TOKEN_KEY = "donationAlertsAccessToken";

  function initDonationAlerts() {
    var settings = state.config.donationAlerts || {};
    var hasProxy = typeof settings.proxyBaseUrl === "string" && settings.proxyBaseUrl.trim();

    if (!hasProxy) {
      return;
    }

    if (hasProxy) {
      settings.proxyBaseUrl = settings.proxyBaseUrl.trim().replace(/\/+$/, "");
    }

    if (typeof WebSocket === "undefined") {
      console.warn("DonationAlerts integration requires WebSocket support.");
      return;
    }

    captureDonationAlertsAccessToken();

    connectDonationAlerts(settings).catch(function (error) {
      console.error("DonationAlerts connection failed.", error);
      showDonationAlertsTokenPanel(settings);
    });
  }

  async function connectDonationAlerts(settings) {
    var auth = await resolveDonationAlertsAuth(settings);
    var channel = settings.channel || "$alerts:donation_" + auth.userId;
    var socket = new WebSocket(settings.socketUrl);

    state.donationAlerts.socket = socket;

    socket.addEventListener("open", function () {
      sendDonationAlertsSocketMessage(socket, {
        params: {
          token: auth.socketConnectionToken
        },
        id: nextDonationAlertsMessageId()
      });
    });

    socket.addEventListener("message", function (event) {
      handleDonationAlertsSocketMessage(event.data, settings, channel);
    });

    socket.addEventListener("close", function () {
      console.warn("DonationAlerts WebSocket closed.");
      scheduleDonationAlertsReconnect(settings);
    });

    socket.addEventListener("error", function (error) {
      console.error("DonationAlerts WebSocket error.", error);
    });
  }

  async function resolveDonationAlertsAuth(settings) {
    return donationAlertsProxyRequest(settings, "/auth", {
      method: "GET"
    });
  }

  async function handleDonationAlertsSocketMessage(rawData, settings, channel) {
    var message = parseDonationAlertsSocketData(rawData);

    if (!message) {
      return;
    }

    if (message.result && message.result.client) {
      subscribeDonationAlertsChannel(settings, channel, message.result.client);
      return;
    }

    var donation = extractDonationAlertsDonation(message);

    if (!donation) {
      return;
    }

    console.warn("DonationAlerts donation received:", donation);
    window.handleDonation(donation);
  }

  async function subscribeDonationAlertsChannel(settings, channel, clientId) {
    try {
      var response = await donationAlertsProxyRequest(settings, "/subscribe", {
        method: "POST",
        body: JSON.stringify({
          channels: [channel],
          client: clientId
        })
      });
      var channels = response && Array.isArray(response.channels) ? response.channels : [];
      var subscription = channels.find(function (item) {
        return item.channel === channel;
      }) || channels[0];

      if (!subscription || !subscription.token) {
        throw new Error("DonationAlerts subscribe response does not contain a channel token.");
      }

      sendDonationAlertsSocketMessage(state.donationAlerts.socket, {
        params: {
          channel: subscription.channel || channel,
          token: subscription.token
        },
        method: 1,
        id: nextDonationAlertsMessageId()
      });
      console.warn("DonationAlerts channel subscribed:", subscription.channel || channel);
    } catch (error) {
      console.error("DonationAlerts channel subscription failed.", error);
    }
  }

  async function donationAlertsProxyRequest(settings, path, options) {
    var fetchImpl = window.fetch || (typeof fetch === "function" ? fetch : null);
    var accessToken = getStoredDonationAlertsAccessToken();
    var headers = {
      "Content-Type": "application/json"
    };

    if (!fetchImpl) {
      throw new Error("DonationAlerts integration requires fetch support.");
    }

    if (accessToken) {
      headers.Authorization = "Bearer " + accessToken;
    }

    var response = await fetchImpl(settings.proxyBaseUrl + path, {
      method: options.method,
      headers: headers,
      body: options.body || undefined
    });

    if (!response.ok) {
      throw new Error("DonationAlerts proxy " + path + " failed with HTTP " + response.status);
    }

    return response.json();
  }

  function sendDonationAlertsSocketMessage(socket, message) {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn("DonationAlerts WebSocket is not open; message was not sent.", message);
      return;
    }

    socket.send(JSON.stringify(message));
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
    var candidates = [
      message,
      message.data,
      message.params && message.params.data,
      message.result && message.result.data,
      message.result && message.result.data && message.result.data.data,
      message.result && message.result.data && message.result.data.alert
    ];

    for (var i = 0; i < candidates.length; i += 1) {
      var donation = normalizeDonationAlertsDonation(candidates[i]);

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

    var amount = Number(value.amount);

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

  function scheduleDonationAlertsReconnect(settings) {
    if (!settings.autoReconnect || state.donationAlerts.reconnectTimer) {
      return;
    }

    state.donationAlerts.reconnectTimer = window.setTimeout(function () {
      state.donationAlerts.reconnectTimer = null;
      connectDonationAlerts(settings).catch(function (error) {
        console.error("DonationAlerts reconnect failed.", error);
        showDonationAlertsTokenPanel(settings);
      });
    }, Math.max(1000, Number(settings.reconnectDelayMs) || 5000));
  }

  function captureDonationAlertsAccessToken() {
    var hash = window.location && window.location.hash ? window.location.hash.replace(/^#/, "") : "";
    var params;
    var token;

    if (!hash) {
      return;
    }

    params = new URLSearchParams(hash);
    token = params.get("access_token");

    if (!token) {
      return;
    }

    setStoredDonationAlertsAccessToken(token);

    if (window.history && typeof window.history.replaceState === "function") {
      window.history.replaceState(null, document.title, getDonationAlertsRedirectUrl());
    }
  }

  function getStoredDonationAlertsAccessToken() {
    try {
      return window.localStorage ? window.localStorage.getItem(DONATION_ALERTS_TOKEN_KEY) : null;
    } catch (error) {
      return null;
    }
  }

  function setStoredDonationAlertsAccessToken(token) {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(DONATION_ALERTS_TOKEN_KEY, token);
      }
    } catch (error) {
      console.warn("DonationAlerts token could not be saved.", error);
    }
  }

  function clearStoredDonationAlertsAccessToken() {
    try {
      if (window.localStorage) {
        window.localStorage.removeItem(DONATION_ALERTS_TOKEN_KEY);
      }
    } catch (error) {
      console.warn("DonationAlerts token could not be cleared.", error);
    }
  }

  function showDonationAlertsTokenPanel(settings) {
    var doc = window.document || document;
    var panel;
    var title;
    var clientRow;
    var clientLabel;
    var clientInput;
    var redirectRow;
    var redirectLabel;
    var redirectInput;
    var link;
    var redirectUrl = getDonationAlertsRedirectUrl();
    var applicationId = getDonationAlertsApplicationId(settings);

    clearStoredDonationAlertsAccessToken();

    if (!doc || !doc.body || state.donationAlerts.authPanel) {
      return;
    }

    panel = doc.createElement("section");
    panel.className = "donation-auth-panel";

    title = doc.createElement("strong");
    title.textContent = "DonationAlerts";
    panel.appendChild(title);

    clientRow = doc.createElement("label");
    clientRow.className = "donation-auth-row";
    clientLabel = doc.createElement("span");
    clientLabel.textContent = "ID приложения";
    clientInput = doc.createElement("input");
    clientInput.type = "text";
    clientInput.value = applicationId;
    clientRow.appendChild(clientLabel);
    clientRow.appendChild(clientInput);
    panel.appendChild(clientRow);

    redirectRow = doc.createElement("label");
    redirectRow.className = "donation-auth-row";
    redirectLabel = doc.createElement("span");
    redirectLabel.textContent = "URL редиректа";
    redirectInput = doc.createElement("input");
    redirectInput.type = "text";
    redirectInput.value = redirectUrl;
    redirectInput.readOnly = true;
    redirectRow.appendChild(redirectLabel);
    redirectRow.appendChild(redirectInput);
    panel.appendChild(redirectRow);

    link = doc.createElement("a");
    link.className = "donation-auth-button";
    link.href = getDonationAlertsAuthorizeUrl(redirectUrl, clientInput.value);
    link.textContent = "Получить токен";
    panel.appendChild(link);

    clientInput.addEventListener("input", function () {
      link.href = getDonationAlertsAuthorizeUrl(redirectUrl, clientInput.value);
    });

    doc.body.appendChild(panel);
    state.donationAlerts.authPanel = panel;
  }

  function getDonationAlertsApplicationId(settings) {
    if (settings && typeof settings.applicationId === "string") {
      return settings.applicationId.trim();
    }

    return "";
  }

  function getDonationAlertsRedirectUrl() {
    var location = window.location;

    return location.origin + location.pathname;
  }

  function getDonationAlertsAuthorizeUrl(redirectUrl, applicationId) {
    var params = new URLSearchParams({
      client_id: applicationId || "",
      redirect_uri: redirectUrl,
      response_type: "token",
      scope: "oauth-user-show oauth-donation-subscribe"
    });

    return "https://www.donationalerts.com/oauth/authorize?" + params.toString().replace(/\+/g, "%20");
  }

  function nextDonationAlertsMessageId() {
    state.donationAlerts.messageId += 1;
    return state.donationAlerts.messageId;
  }

  app.donationAlerts = {
    init: initDonationAlerts
  };
}(window));
