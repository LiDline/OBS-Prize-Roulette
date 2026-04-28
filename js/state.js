(function (window) {
  "use strict";

  window.RouletteApp = window.RouletteApp || {};
  window.RouletteApp.state = {
    config: window.RouletteApp.config.fallbackConfig,
    isSpinning: false,
    elements: {},
    itemWidth: 238,
    donationAlerts: {
      socket: null,
      messageId: 1,
      reconnectTimer: null
    }
  };
}(window));
