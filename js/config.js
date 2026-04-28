(function (window) {
  "use strict";

  var fallbackConfig = {
    donationThreshold: 100,
    spinDurationMs: 6000,
    resultDisplayMs: 3000,
    closeDelayMs: 800,
    sounds: {
      open: "assets/open.mp3",
      close: "assets/close.mp3"
    },
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
      { id: "common_1", name: "Обычный приз", rarity: "common", weight: 60, sound: "assets/common.mp3" },
      { id: "rare_1", name: "Редкий приз", rarity: "rare", weight: 25, sound: "assets/rare.mp3" },
      { id: "epic_1", name: "Эпический приз", rarity: "epic", weight: 10, sound: "assets/epic.mp3" },
      { id: "legendary_1", name: "Легендарный приз", rarity: "legendary", weight: 5, sound: "assets/legendary.mp3" }
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
      sounds: Object.assign({}, defaultConfig.sounds, loadedConfig.sounds || {}),
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
