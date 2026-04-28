(function (window) {
  "use strict";

  function safePlaySound(src) {
    if (!src) {
      return Promise.resolve(false);
    }

    try {
      var audio = new Audio(src);
      audio.preload = "auto";
      var playResult = audio.play();

      if (playResult && typeof playResult.catch === "function") {
        return playResult.catch(function (error) {
          console.warn("Sound playback failed:", src, error);
          return false;
        });
      }

      return Promise.resolve(true);
    } catch (error) {
      console.warn("Sound playback failed:", src, error);
      return Promise.resolve(false);
    }
  }

  function readCssPixels(variableName) {
    var value = getComputedStyle(document.documentElement).getPropertyValue(variableName);
    var parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  window.RouletteApp = window.RouletteApp || {};
  window.RouletteApp.utils = {
    readCssPixels: readCssPixels,
    safePlaySound: safePlaySound
  };
}(window));
