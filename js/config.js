(function (window) {
  "use strict";

  var fallbackConfig = {
    donationThreshold: 100,
    spinDurationMs: 6000,
    resultDisplayMs: 3000,
    closeDelayMs: 800,
    sound: "assets/card-change.mp3",
    donationAlerts: {
      accessToken: "",
      userId: "",
      socketConnectionToken: "",
      apiBaseUrl: "https://www.donationalerts.com/api/v1",
      socketUrl: "wss://centrifugo.donationalerts.com/connection/websocket",
      autoReconnect: true,
      reconnectDelayMs: 5000
    },
    prizes: [
      { id: 1, name: "Обычный приз", weight: 60 },
      { id: 2, name: "Редкий приз", weight: 25 },
      { id: 3, name: "Эпический приз", weight: 10 },
      { id: 4, name: "Легендарный приз", weight: 5 }
    ]
  };

  async function loadConfig() {
    var embeddedConfig = readEmbeddedConfig();

    if (window.location.protocol === "file:") {
      return embeddedConfig || fallbackConfig;
    }

    try {
      var response = await fetch("config.json", { cache: "no-store" });

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      var loadedConfig = await response.json();
      return mergeConfig(embeddedConfig || fallbackConfig, loadedConfig);
    } catch (error) {
      console.warn("Failed to load config.json, using embedded or fallback config.", error);
      return embeddedConfig || fallbackConfig;
    }
  }

  function readEmbeddedConfig() {
    var configElement = document.getElementById("rouletteConfig");

    if (!configElement) {
      return null;
    }

    try {
      return mergeConfig(fallbackConfig, JSON.parse(configElement.textContent));
    } catch (error) {
      console.warn("Failed to parse embedded roulette config.", error);
      return null;
    }
  }

  function mergeConfig(defaultConfig, loadedConfig) {
    return {
      donationThreshold: readNumber(loadedConfig.donationThreshold, defaultConfig.donationThreshold),
      spinDurationMs: readNumber(loadedConfig.spinDurationMs, defaultConfig.spinDurationMs),
      resultDisplayMs: readNumber(loadedConfig.resultDisplayMs, defaultConfig.resultDisplayMs),
      closeDelayMs: readNumber(loadedConfig.closeDelayMs, defaultConfig.closeDelayMs),
      sound: loadedConfig.sound || defaultConfig.sound,
      donationAlerts: Object.assign({}, defaultConfig.donationAlerts, loadedConfig.donationAlerts || {}),
      prizes: Array.isArray(loadedConfig.prizes) ? loadedConfig.prizes : defaultConfig.prizes
    };
  }

  function readNumber(value, fallback) {
    var parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  window.RouletteApp = window.RouletteApp || {};
  window.RouletteApp.config = {
    fallbackConfig: fallbackConfig,
    loadConfig: loadConfig,
    readNumber: readNumber
  };
}(window));
