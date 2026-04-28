(function (window, document) {
  "use strict";

  var app = window.RouletteApp;
  var state = app.state;

  document.addEventListener("DOMContentLoaded", init);

  window.startRoulette = function () {
    return app.roulette.startRoulette();
  };

  window.testSpin = function () {
    return app.roulette.startRoulette();
  };

  window.handleDonation = function (amount) {
    var numericAmount = Number(amount);
    var threshold = Number(state.config.donationThreshold) || 0;

    if (!Number.isFinite(numericAmount)) {
      console.warn("Donation amount is not a valid number:", amount);
      return false;
    }

    if (numericAmount >= threshold) {
      return app.roulette.startRoulette();
    }

    console.warn("Donation below threshold:", numericAmount, "required:", threshold);
    return false;
  };

  async function init() {
    cacheElements();
    app.debug.setupPanel();
    state.config = await app.config.loadConfig();
    state.itemWidth = app.utils.readCssPixels("--card-width") + app.utils.readCssPixels("--card-gap");
    app.donationAlerts.init();
  }

  function cacheElements() {
    state.elements.overlay = document.getElementById("rouletteOverlay");
    state.elements.track = document.getElementById("reelTrack");
    state.elements.resultPanel = document.getElementById("resultPanel");
    state.elements.resultName = document.getElementById("resultName");
    state.elements.debugPanel = document.getElementById("debugPanel");
    state.elements.toggleDebugPanel = document.getElementById("toggleDebugPanel");
    state.elements.testSpinButton = document.getElementById("testSpinButton");
    state.elements.showOddsButton = document.getElementById("showOddsButton");
    state.elements.oddsOutput = document.getElementById("oddsOutput");
    state.elements.donationAmount = document.getElementById("donationAmount");
    state.elements.simulateDonationButton = document.getElementById("simulateDonationButton");
  }
}(window, document));
