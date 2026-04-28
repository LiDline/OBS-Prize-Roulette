(function (window) {
  "use strict";

  var app = window.RouletteApp;
  var state = app.state;

  function setupDebugPanel() {
    var params = new URLSearchParams(window.location.search);
    var enabled = params.get("debug") === "1";

    if (!enabled) {
      return;
    }

    state.elements.debugPanel.classList.add("is-enabled");
    state.elements.oddsOutput.textContent = formatOdds();
    state.elements.simulateDonationButton.addEventListener("click", function () {
      window.handleDonation({
        amount: state.elements.donationAmount.value,
        username: "testName"
      });
    });
  }

  function formatOdds() {
    var prizes = Array.isArray(state.config.prizes) ? state.config.prizes : [];
    var validPrizes = prizes.filter(function (prize) {
      return Number(prize.weight) > 0;
    });
    var totalWeight = validPrizes.reduce(function (sum, prize) {
      return sum + Number(prize.weight);
    }, 0);

    if (totalWeight <= 0) {
      return "Нет призов с корректным weight.";
    }

    return validPrizes.map(function (prize) {
      var chance = (Number(prize.weight) / totalWeight) * 100;
      return prize.name + ": " + chance.toFixed(2) + "%";
    }).join("\n");
  }

  app.debug = {
    setupPanel: setupDebugPanel
  };
}(window));
