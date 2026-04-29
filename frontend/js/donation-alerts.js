(function (window) {
  "use strict";

  var app = window.RouletteApp;
  var state = app.state;
  var PROXY_BASE_URL = "/api/donationalerts";

  function initDonationAlerts() {
    captureDonationAlertsAccessToken().then(function () {
      connectLocalDonationAlertsEvents();
    }).catch(function (error) {
      console.error("DonationAlerts connection failed.", error);
      showDonationAlertsTokenPanel();
    });
  }

  async function captureDonationAlertsAccessToken() {
    var hash = window.location && window.location.hash ? window.location.hash.replace(/^#/, "") : "";
    var params;
    var token;

    if (!hash) {
      return null;
    }

    params = new URLSearchParams(hash);
    token = params.get("access_token");

    if (!token) {
      return null;
    }

    await donationAlertsProxyRequest("/token", {
      method: "POST",
      body: JSON.stringify({
        accessToken: token
      })
    });

    if (window.history && typeof window.history.replaceState === "function") {
      window.history.replaceState(null, document.title, getDonationAlertsRedirectUrl());
    }

    return true;
  }

  function connectLocalDonationAlertsEvents() {
    if (typeof EventSource === "undefined") {
      console.warn("DonationAlerts integration requires EventSource support.");
      return;
    }

    state.donationAlerts.events = new EventSource(PROXY_BASE_URL + "/events");

    state.donationAlerts.events.addEventListener("message", function (event) {
      var donation = parseDonationEvent(event.data);

      if (donation) {
        window.handleDonation(donation);
      }
    });

    state.donationAlerts.events.addEventListener("error", function () {
      console.error("DonationAlerts local event stream failed.");
      showDonationAlertsTokenPanel();
    });
  }

  async function donationAlertsProxyRequest(path, options) {
    var fetchImpl = window.fetch || (typeof fetch === "function" ? fetch : null);
    var response;

    if (!fetchImpl) {
      throw new Error("DonationAlerts integration requires fetch support.");
    }

    response = await fetchImpl(PROXY_BASE_URL + path, {
      method: options.method,
      headers: {
        "Content-Type": "application/json"
      },
      body: options.body || undefined
    });

    if (!response.ok) {
      throw new Error("DonationAlerts proxy " + path + " failed with HTTP " + response.status);
    }

    return response.json();
  }

  function parseDonationEvent(rawData) {
    try {
      return JSON.parse(rawData);
    } catch (error) {
      console.warn("DonationAlerts local event is not valid JSON.", rawData, error);
      return null;
    }
  }

  function showDonationAlertsTokenPanel() {
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
    clientInput.value = "";
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

  app.donationAlerts = {
    init: initDonationAlerts
  };
}(window));
