(function (window) {
  "use strict";

  var pendingAutoplaySoundSrcs = [];
  var autoplayUnlockListenersAttached = false;

  function safePlaySound(src) {
    if (!src) {
      return Promise.resolve(false);
    }

    return playSound(src, true);
  }

  function playSound(src, retryAfterUserGesture) {
    try {
      var audio = new Audio(src);
      audio.preload = "auto";
      var playResult = audio.play();

      if (playResult && typeof playResult.catch === "function") {
        return playResult.catch(function (error) {
          if (isAutoplayBlocked(error)) {
            if (retryAfterUserGesture) {
              queueAutoplayRetry(src);
            }

            return false;
          }

          console.warn("Sound playback failed:", src, error);
          return false;
        });
      }

      return Promise.resolve(true);
    } catch (error) {
      if (isAutoplayBlocked(error)) {
        if (retryAfterUserGesture) {
          queueAutoplayRetry(src);
        }

        return Promise.resolve(false);
      }

      console.warn("Sound playback failed:", src, error);
      return Promise.resolve(false);
    }
  }

  function isAutoplayBlocked(error) {
    var message = error && error.message ? String(error.message) : "";

    return Boolean(error && error.name === "NotAllowedError")
      || message.indexOf("user didn't interact") !== -1
      || message.indexOf("user did not interact") !== -1;
  }

  function queueAutoplayRetry(src) {
    if (pendingAutoplaySoundSrcs.indexOf(src) === -1) {
      pendingAutoplaySoundSrcs.push(src);
    }

    attachAutoplayUnlockListeners();
  }

  function attachAutoplayUnlockListeners() {
    if (autoplayUnlockListenersAttached || typeof document === "undefined" || typeof document.addEventListener !== "function") {
      return;
    }

    autoplayUnlockListenersAttached = true;
    document.addEventListener("pointerdown", retryBlockedAutoplaySounds, true);
    document.addEventListener("mousedown", retryBlockedAutoplaySounds, true);
    document.addEventListener("touchstart", retryBlockedAutoplaySounds, true);
    document.addEventListener("keydown", retryBlockedAutoplaySounds, true);
  }

  function retryBlockedAutoplaySounds() {
    var blockedSources = pendingAutoplaySoundSrcs.slice();

    pendingAutoplaySoundSrcs = [];
    detachAutoplayUnlockListeners();
    blockedSources.forEach(function (src) {
      playSound(src, false);
    });
  }

  function detachAutoplayUnlockListeners() {
    if (!autoplayUnlockListenersAttached || typeof document === "undefined" || typeof document.removeEventListener !== "function") {
      return;
    }

    autoplayUnlockListenersAttached = false;
    document.removeEventListener("pointerdown", retryBlockedAutoplaySounds, true);
    document.removeEventListener("mousedown", retryBlockedAutoplaySounds, true);
    document.removeEventListener("touchstart", retryBlockedAutoplaySounds, true);
    document.removeEventListener("keydown", retryBlockedAutoplaySounds, true);
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
