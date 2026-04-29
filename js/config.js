(function (window) {
  "use strict";

  var fallbackConfig = {
    donationThreshold: 100,
    spinDurationMs: 6000,
    resultDisplayMs: 3000,
    closeDelayMs: 800,
    sound: "assets/card-change.mp3",
    prizes: [
      { id: 1, name: "Обычный приз", weight: 60 },
      { id: 2, name: "Редкий приз", weight: 25 },
      { id: 3, name: "Эпический приз", weight: 10 },
      { id: 4, name: "Легендарный приз", weight: 5 }
    ]
  };

  async function loadConfig() {
    if (window.location.protocol === "file:") {
      return fallbackConfig;
    }

    try {
      var response = await fetch("config.json", { cache: "no-store" });

      if (!response.ok) {
        throw new Error("HTTP " + response.status);
      }

      var loadedConfig = await response.json();
      return mergeConfig(fallbackConfig, loadedConfig);
    } catch (error) {
      console.warn("Failed to load config.json, using fallback config.", error);
      return fallbackConfig;
    }
  }

  function mergeConfig(defaultConfig, loadedConfig) {
    return {
      donationThreshold: readNumber(loadedConfig.donationThreshold, defaultConfig.donationThreshold),
      spinDurationMs: readNumber(loadedConfig.spinDurationMs, defaultConfig.spinDurationMs),
      resultDisplayMs: readNumber(loadedConfig.resultDisplayMs, defaultConfig.resultDisplayMs),
      closeDelayMs: readNumber(loadedConfig.closeDelayMs, defaultConfig.closeDelayMs),
      sound: loadedConfig.sound || defaultConfig.sound,
      donationAlerts: mergeOptionalObject(defaultConfig.donationAlerts, loadedConfig.donationAlerts),
      prizes: Array.isArray(loadedConfig.prizes) ? loadedConfig.prizes : defaultConfig.prizes
    };
  }

  function mergeOptionalObject(defaultValue, loadedValue) {
    if (!defaultValue && !loadedValue) {
      return undefined;
    }

    return Object.assign({}, defaultValue || {}, loadedValue || {});
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
