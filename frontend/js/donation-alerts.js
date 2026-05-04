(function (window) {
  "use strict";

  var app = window.RouletteApp;
  var state = app.state;
  var PROXY_BASE_URL = "/api/donationalerts";
  var APPLICATION_ID_STORAGE_KEY = "donationAlertsApplicationId";
  var CLIENT_SECRET_STORAGE_KEY = "donationAlertsClientSecret";
  var ACCESS_TOKEN_STORAGE_KEY = "donationAlertsAccessToken";
  var REFRESH_TOKEN_STORAGE_KEY = "donationAlertsRefreshToken";
  var ACCESS_TOKEN_EXPIRES_AT_STORAGE_KEY = "donationAlertsAccessTokenExpiresAt";
  var authCheckInFlight = false;

  function initDonationAlerts() {
    captureDonationAlertsAccessToken().then(function () {
      connectLocalDonationAlertsEvents();
    }).catch(function (error) {
      console.error("DonationAlerts connection failed.", error);
      showDonationAlertsStatusModal("error", "Не удалось подключить DonationAlerts");
      showDonationAlertsTokenPanel();
    });
  }

  async function captureDonationAlertsAccessToken() {
    var search = window.location && window.location.search ? window.location.search.replace(/^\?/, "") : "";
    var hash = window.location && window.location.hash ? window.location.hash.replace(/^#/, "") : "";
    var params;
    var authorizationCode;
    var token;
    var tokenFromHash = false;
    var tokenResponse;

    if (search) {
      params = new URLSearchParams(search);
      authorizationCode = params.get("code");
    }

    if (authorizationCode) {
      tokenResponse = await donationAlertsProxyRequest("/token", {
        method: "POST",
        body: JSON.stringify({
          authorizationCode: authorizationCode,
          clientId: readSavedDonationAlertsApplicationId(),
          clientSecret: readSavedDonationAlertsClientSecret(),
          redirectUri: getDonationAlertsRedirectUrl()
        })
      });

      saveDonationAlertsTokenResponse(tokenResponse);

      if (window.history && typeof window.history.replaceState === "function") {
        window.history.replaceState(null, document.title, getDonationAlertsRedirectUrl());
      }

      showDonationAlertsStatusModal("success", "DonationAlerts подключен");
      return true;
    }

    if (hash) {
      params = new URLSearchParams(hash);
      token = params.get("access_token");
      tokenFromHash = Boolean(token);
    }

    if (!token) {
      token = readSavedDonationAlertsAccessToken();
    }

    if (!token) {
      return null;
    }

    try {
      tokenResponse = await donationAlertsProxyRequest("/token", {
        method: "POST",
        body: JSON.stringify({
          accessToken: token,
          refreshToken: readSavedDonationAlertsRefreshToken(),
          clientId: readSavedDonationAlertsApplicationId(),
          clientSecret: readSavedDonationAlertsClientSecret()
        })
      });
    } catch (error) {
      if (!tokenFromHash) {
        removeSavedDonationAlertsTokens();
      }

      throw error;
    }

    saveDonationAlertsTokenResponse(Object.assign({ accessToken: token }, tokenResponse));

    if (tokenFromHash && window.history && typeof window.history.replaceState === "function") {
      window.history.replaceState(null, document.title, getDonationAlertsRedirectUrl());
    }

    if (tokenFromHash) {
      showDonationAlertsStatusModal("success", "DonationAlerts подключен");
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

    state.donationAlerts.events.addEventListener("status", function (event) {
      handleDonationAlertsConnectionStatus(event.data);
    });

    state.donationAlerts.events.addEventListener("token", function (event) {
      saveDonationAlertsTokenResponse(parseDonationAlertsJsonEvent(event.data));
    });

    state.donationAlerts.events.addEventListener("error", function () {
      console.warn("DonationAlerts local event stream interrupted; waiting for browser reconnect.");
      checkDonationAlertsAuthAfterStreamError();
    });
  }

  function handleDonationAlertsConnectionStatus(rawData) {
    var status = parseDonationAlertsJsonEvent(rawData);

    if (!status) {
      return;
    }

    if (status.status === "disconnected" || status.status === "reconnecting") {
      state.donationAlerts.connectionWasInterrupted = true;
      showDonationAlertsStatusModal("error", "Соединение с DonationAlerts потеряно. Переподключаюсь...");
      return;
    }

    if (status.status === "connected" && state.donationAlerts.connectionWasInterrupted) {
      state.donationAlerts.connectionWasInterrupted = false;
      showDonationAlertsStatusModal("success", "DonationAlerts снова подключен");
    }
  }

  function checkDonationAlertsAuthAfterStreamError() {
    if (authCheckInFlight) {
      return;
    }

    authCheckInFlight = true;

    donationAlertsProxyRequest("/auth", {
      method: "GET"
    }).then(function (response) {
      saveDonationAlertsTokenResponse(response);
    }).catch(function (error) {
      if (error && error.status === 401) {
        console.error("DonationAlerts auth check failed after local event stream error.", error);
        return restoreDonationAlertsBackendMemoryAfterRestart();
      }

      console.warn("DonationAlerts auth check could not confirm token loss; keeping EventSource reconnect active.", error);
    }).finally(function () {
      authCheckInFlight = false;
    });
  }

  function restoreDonationAlertsBackendMemoryAfterRestart() {
    var token = readSavedDonationAlertsAccessToken();

    if (!token) {
      showDonationAlertsTokenPanelAfterAuthLoss();
      return Promise.resolve();
    }

    return donationAlertsProxyRequest("/token", {
      method: "POST",
      body: JSON.stringify({
        accessToken: token,
        refreshToken: readSavedDonationAlertsRefreshToken(),
        clientId: readSavedDonationAlertsApplicationId(),
        clientSecret: readSavedDonationAlertsClientSecret()
      })
    }).then(function (response) {
      saveDonationAlertsTokenResponse(Object.assign({ accessToken: token }, response));

      if (state.donationAlerts.events && typeof state.donationAlerts.events.close === "function") {
        state.donationAlerts.events.close();
      }

      connectLocalDonationAlertsEvents();
      showDonationAlertsStatusModal("success", "Соединение с DonationAlerts восстановлено");
    }).catch(function (restoreError) {
      if (restoreError && (restoreError.status === 400 || restoreError.status === 401)) {
        console.error("DonationAlerts saved token restore failed after backend restart.", restoreError);
        removeSavedDonationAlertsTokens();
        showDonationAlertsTokenPanelAfterAuthLoss();
        return;
      }

      console.warn("DonationAlerts saved token restore could not confirm token loss; keeping EventSource reconnect active.", restoreError);
    });
  }

  function showDonationAlertsTokenPanelAfterAuthLoss() {
    if (state.donationAlerts.events && typeof state.donationAlerts.events.close === "function") {
      state.donationAlerts.events.close();
    }

    showDonationAlertsTokenPanel();
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
      var error = new Error("DonationAlerts proxy " + path + " failed with HTTP " + response.status);
      error.status = response.status;
      throw error;
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

  function parseDonationAlertsJsonEvent(rawData) {
    try {
      return JSON.parse(rawData);
    } catch (error) {
      console.warn("DonationAlerts event is not valid JSON.", rawData, error);
      return null;
    }
  }

  function showDonationAlertsTokenPanel() {
    var doc = window.document || document;
    var panel;
    var title;
    var clientRow;
    var clientHeader;
    var clientLabel;
    var clientHelp;
    var clientHelpTrigger;
    var clientHelpTooltip;
    var clientHelpTextBeforeLink;
    var clientHelpLink;
    var clientHelpTextAfterLink;
    var clientInput;
    var clientInputControl;
    var secretRow;
    var secretLabel;
    var secretInput;
    var secretInputControl;
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

    clientRow = doc.createElement("div");
    clientRow.className = "donation-auth-row";
    clientHeader = doc.createElement("span");
    clientHeader.className = "donation-auth-label-line";
    clientLabel = doc.createElement("label");
    clientLabel.htmlFor = "donation-alerts-client-id";
    clientLabel.textContent = "ID приложения";
    clientHelp = doc.createElement("span");
    clientHelp.className = "donation-auth-help";
    clientHelpTrigger = doc.createElement("span");
    clientHelpTrigger.className = "donation-auth-help-trigger";
    clientHelpTrigger.textContent = "?";
    clientHelpTooltip = doc.createElement("span");
    clientHelpTooltip.className = "donation-auth-help-tooltip";
    clientHelpTextBeforeLink = doc.createElement("span");
    clientHelpTextBeforeLink.textContent = "Создать ID приложения можно ";
    clientHelpLink = doc.createElement("a");
    clientHelpLink.href = "https://www.donationalerts.com/application/clients";
    clientHelpLink.target = "_blank";
    clientHelpLink.rel = "noreferrer";
    clientHelpLink.textContent = "тут";
    clientHelpTextAfterLink = doc.createElement("span");
    clientHelpTextAfterLink.textContent = ". URL редиректа укажите " + redirectUrl;
    clientHelpTooltip.appendChild(clientHelpTextBeforeLink);
    clientHelpTooltip.appendChild(clientHelpLink);
    clientHelpTooltip.appendChild(clientHelpTextAfterLink);
    clientHelp.appendChild(clientHelpTrigger);
    clientHelp.appendChild(clientHelpTooltip);
    clientInput = doc.createElement("input");
    clientInput.id = "donation-alerts-client-id";
    clientInput.type = "password";
    clientInput.value = readSavedDonationAlertsApplicationId();
    clientInputControl = createDonationAlertsSecretInputControl(doc, clientInput, "ID приложения");
    clientHeader.appendChild(clientLabel);
    clientHeader.appendChild(clientHelp);
    clientRow.appendChild(clientHeader);
    clientRow.appendChild(clientInputControl);
    panel.appendChild(clientRow);

    secretRow = doc.createElement("div");
    secretRow.className = "donation-auth-row";
    secretLabel = doc.createElement("span");
    secretLabel.textContent = "Ключ API";
    secretInput = doc.createElement("input");
    secretInput.type = "password";
    secretInput.value = readSavedDonationAlertsClientSecret();
    secretInputControl = createDonationAlertsSecretInputControl(doc, secretInput, "Ключ API");
    secretRow.appendChild(secretLabel);
    secretRow.appendChild(secretInputControl);
    panel.appendChild(secretRow);

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
      saveDonationAlertsApplicationId(clientInput.value);
      link.href = getDonationAlertsAuthorizeUrl(redirectUrl, clientInput.value);
    });

    secretInput.addEventListener("input", function () {
      saveDonationAlertsClientSecret(secretInput.value);
    });

    doc.body.appendChild(panel);
    state.donationAlerts.authPanel = panel;
  }

  function createDonationAlertsSecretInputControl(doc, input, label) {
    var control = doc.createElement("div");
    var toggle = doc.createElement("button");

    control.className = "donation-auth-secret-control";
    toggle.className = "donation-auth-visibility-toggle";
    toggle.type = "button";
    toggle.textContent = "👁";
    toggle.title = "Показать " + label;
    toggle.setAttribute("aria-label", "Показать " + label);

    toggle.addEventListener("click", function () {
      var revealed = input.type === "password";

      input.type = revealed ? "text" : "password";
      toggle.title = (revealed ? "Скрыть " : "Показать ") + label;
      toggle.setAttribute("aria-label", toggle.title);
    });

    control.appendChild(input);
    control.appendChild(toggle);

    return control;
  }

  function showDonationAlertsStatusModal(type, message) {
    var doc = window.document || document;
    var modal;
    var text;
    var closeButton;
    var closeModal;

    if (!doc || !doc.body) {
      return;
    }

    if (state.donationAlerts.statusModal && typeof state.donationAlerts.statusModal.remove === "function") {
      state.donationAlerts.statusModal.remove();
    }

    modal = doc.createElement("section");
    modal.className = "donation-auth-status-modal donation-auth-status-modal-" + type;

    text = doc.createElement("span");
    text.className = "donation-auth-status-message";
    text.textContent = message;
    modal.appendChild(text);

    closeModal = function () {
      if (state.donationAlerts.statusModal !== modal) {
        return;
      }

      if (typeof modal.remove === "function") {
        modal.remove();
      }

      state.donationAlerts.statusModal = null;
    };

    closeButton = doc.createElement("button");
    closeButton.type = "button";
    closeButton.className = "donation-auth-status-close";
    closeButton.textContent = "Закрыть";
    closeButton.addEventListener("click", closeModal);
    modal.appendChild(closeButton);

    doc.body.appendChild(modal);
    state.donationAlerts.statusModal = modal;

    if (typeof window.setTimeout === "function") {
      window.setTimeout(closeModal, 3000);
    }
  }

  function getDonationAlertsRedirectUrl() {
    var location = window.location;

    return location.origin + location.pathname;
  }

  function getDonationAlertsAuthorizeUrl(redirectUrl, applicationId) {
    var params = new URLSearchParams({
      client_id: applicationId || "",
      redirect_uri: redirectUrl,
      response_type: "code",
      scope: "oauth-user-show oauth-donation-subscribe"
    });

    return "https://www.donationalerts.com/oauth/authorize?" + params.toString().replace(/\+/g, "%20");
  }

  function readSavedDonationAlertsApplicationId() {
    try {
      if (!window.localStorage) {
        return "";
      }

      return window.localStorage.getItem(APPLICATION_ID_STORAGE_KEY) || "";
    } catch (error) {
      console.warn("DonationAlerts application id could not be read from localStorage.", error);
      return "";
    }
  }

  function saveDonationAlertsApplicationId(applicationId) {
    try {
      if (!window.localStorage) {
        return;
      }

      window.localStorage.setItem(APPLICATION_ID_STORAGE_KEY, applicationId || "");
    } catch (error) {
      console.warn("DonationAlerts application id could not be saved to localStorage.", error);
    }
  }

  function readSavedDonationAlertsClientSecret() {
    try {
      if (!window.localStorage) {
        return "";
      }

      return window.localStorage.getItem(CLIENT_SECRET_STORAGE_KEY) || "";
    } catch (error) {
      console.warn("DonationAlerts client secret could not be read from localStorage.", error);
      return "";
    }
  }

  function saveDonationAlertsClientSecret(clientSecret) {
    try {
      if (!window.localStorage) {
        return;
      }

      window.localStorage.setItem(CLIENT_SECRET_STORAGE_KEY, clientSecret || "");
    } catch (error) {
      console.warn("DonationAlerts client secret could not be saved to localStorage.", error);
    }
  }

  function readSavedDonationAlertsAccessToken() {
    try {
      if (!window.localStorage) {
        return "";
      }

      return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) || "";
    } catch (error) {
      console.warn("DonationAlerts access token could not be read from localStorage.", error);
      return "";
    }
  }

  function saveDonationAlertsAccessToken(accessToken) {
    try {
      if (!window.localStorage) {
        return;
      }

      window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, accessToken || "");
    } catch (error) {
      console.warn("DonationAlerts access token could not be saved to localStorage.", error);
    }
  }

  function readSavedDonationAlertsRefreshToken() {
    try {
      if (!window.localStorage) {
        return "";
      }

      return window.localStorage.getItem(REFRESH_TOKEN_STORAGE_KEY) || "";
    } catch (error) {
      console.warn("DonationAlerts refresh token could not be read from localStorage.", error);
      return "";
    }
  }

  function saveDonationAlertsRefreshToken(refreshToken) {
    try {
      if (!window.localStorage) {
        return;
      }

      window.localStorage.setItem(REFRESH_TOKEN_STORAGE_KEY, refreshToken || "");
    } catch (error) {
      console.warn("DonationAlerts refresh token could not be saved to localStorage.", error);
    }
  }

  function saveDonationAlertsTokenResponse(response) {
    if (!response || typeof response !== "object") {
      return;
    }

    if (response.accessToken) {
      saveDonationAlertsAccessToken(response.accessToken);
    }

    if (response.refreshToken) {
      saveDonationAlertsRefreshToken(response.refreshToken);
    }

    if (response.expiresIn) {
      saveDonationAlertsAccessTokenExpiresAt(response.expiresIn);
    }
  }

  function saveDonationAlertsAccessTokenExpiresAt(expiresIn) {
    try {
      if (!window.localStorage) {
        return;
      }

      window.localStorage.setItem(
        ACCESS_TOKEN_EXPIRES_AT_STORAGE_KEY,
        String(Date.now() + Math.max(1, Number(expiresIn)) * 1000)
      );
    } catch (error) {
      console.warn("DonationAlerts access token expiry could not be saved to localStorage.", error);
    }
  }

  function removeSavedDonationAlertsTokens() {
    try {
      if (!window.localStorage) {
        return;
      }

      window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
      window.localStorage.removeItem(REFRESH_TOKEN_STORAGE_KEY);
      window.localStorage.removeItem(ACCESS_TOKEN_EXPIRES_AT_STORAGE_KEY);
    } catch (error) {
      console.warn("DonationAlerts tokens could not be removed from localStorage.", error);
    }
  }

  app.donationAlerts = {
    init: initDonationAlerts
  };
}(window));
