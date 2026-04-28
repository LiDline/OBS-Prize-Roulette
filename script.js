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

  window.handleDonation = function (donation) {
    var donationData = normalizeDonation(donation);
    var numericAmount = donationData.amount;
    var threshold = Number(state.config.donationThreshold) || 0;

    if (!Number.isFinite(numericAmount)) {
      console.warn("Donation amount is not a valid number:", donation);
      return false;
    }

    if (numericAmount >= threshold) {
      return app.roulette.startRoulette({
        donorName: donationData.username
      });
    }

    console.warn("Donation below threshold:", numericAmount, "required:", threshold);
    return false;
  };

  function normalizeDonation(donation) {
    if (donation && typeof donation === "object") {
      return {
        amount: Number(donation.amount),
        username: donation.username || donation.name || ""
      };
    }

    return {
      amount: Number(donation),
      username: ""
    };
  }

  async function init() {
    cacheElements();
    state.config = await app.config.loadConfig();
    state.itemWidth = app.utils.readCssPixels("--card-width") + app.utils.readCssPixels("--card-gap");
    app.debug.setupPanel();
    app.donationAlerts.init();
  }

  function cacheElements() {
    state.elements.overlay = document.getElementById("rouletteOverlay");
    state.elements.title = document.getElementById("rouletteTitle");
    state.elements.track = document.getElementById("reelTrack");
    state.elements.resultPanel = document.getElementById("resultPanel");
    state.elements.resultName = document.getElementById("resultName");
    state.elements.debugPanel = document.getElementById("debugPanel");
    state.elements.oddsOutput = document.getElementById("oddsOutput");
    state.elements.donationAmount = document.getElementById("donationAmount");
    state.elements.simulateDonationButton = document.getElementById("simulateDonationButton");
  }
}(window, document));
