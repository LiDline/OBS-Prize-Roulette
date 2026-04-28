(function (window) {
  "use strict";

  var app = window.RouletteApp;
  var state = app.state;

  function initDonationAlerts() {
    var settings = state.config.donationAlerts || {};

    if (!settings.enabled) {
      return;
    }

    if (!settings.accessToken || settings.accessToken === "PASTE_DONATIONALERTS_ACCESS_TOKEN_HERE") {
      console.warn("DonationAlerts integration is enabled, but accessToken is still a placeholder.");
      return;
    }

    if (typeof WebSocket === "undefined") {
      console.warn("DonationAlerts integration requires WebSocket support.");
      return;
    }

    connectDonationAlerts(settings).catch(function (error) {
      console.error("DonationAlerts connection failed.", error);
      scheduleDonationAlertsReconnect(settings);
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
    if (settings.userId && settings.socketConnectionToken) {
      return {
        userId: settings.userId,
        socketConnectionToken: settings.socketConnectionToken
      };
    }

    var profile = await donationAlertsApiRequest(settings, "/user/oauth", {
      method: "GET"
    });
    var profileData = profile && profile.data ? profile.data : {};

    if (!profileData.id || !profileData.socket_connection_token) {
      throw new Error("DonationAlerts /user/oauth response does not contain id or socket_connection_token.");
    }

    return {
      userId: profileData.id,
      socketConnectionToken: profileData.socket_connection_token
    };
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
    window.handleDonation(donation.amount);
  }

  async function subscribeDonationAlertsChannel(settings, channel, clientId) {
    try {
      var response = await donationAlertsApiRequest(settings, "/centrifuge/subscribe", {
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

  async function donationAlertsApiRequest(settings, path, options) {
    var response = await fetch(settings.apiBaseUrl + path, {
      method: options.method,
      headers: {
        "Authorization": "Bearer " + settings.accessToken,
        "Content-Type": "application/json"
      },
      body: options.body || undefined
    });

    if (!response.ok) {
      throw new Error("DonationAlerts API " + path + " failed with HTTP " + response.status);
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
        scheduleDonationAlertsReconnect(settings);
      });
    }, Math.max(1000, Number(settings.reconnectDelayMs) || 5000));
  }

  function nextDonationAlertsMessageId() {
    state.donationAlerts.messageId += 1;
    return state.donationAlerts.messageId;
  }

  app.donationAlerts = {
    init: initDonationAlerts
  };
}(window));
