(function (window) {
  "use strict";

  var app = window.RouletteApp;
  var state = app.state;
  var fallbackConfig = app.config.fallbackConfig;
  var readCssPixels = app.utils.readCssPixels;
  var safePlaySound = app.utils.safePlaySound;

  function startRoulette() {
    if (state.isSpinning) {
      state.queuedSpins += 1;
      console.warn("Roulette is already active. Spin queued:", state.queuedSpins);
      return true;
    }

    var winner = pickWeightedPrize(state.config.prizes);

    if (!winner) {
      console.error("Roulette cannot start: all prize weights are invalid.");
      return false;
    }

    state.isSpinning = true;
    resetResult();
    safePlaySound(state.config.sounds && state.config.sounds.open);
    showOverlay();

    var reel = buildReel(winner);
    renderReel(reel.items, reel.winnerIndex);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        spinToWinner(reel.winnerIndex, winner);
      });
    });

    return true;
  }

  function pickWeightedPrize(prizes) {
    if (!Array.isArray(prizes)) {
      console.error("Config prizes must be an array.");
      return null;
    }

    var validPrizes = prizes.filter(function (prize) {
      return Number(prize.weight) > 0;
    });
    var totalWeight = validPrizes.reduce(function (sum, prize) {
      return sum + Number(prize.weight);
    }, 0);

    if (totalWeight <= 0) {
      return null;
    }

    var roll = Math.random() * totalWeight;

    for (var i = 0; i < validPrizes.length; i += 1) {
      roll -= Number(validPrizes[i].weight);

      if (roll < 0) {
        return validPrizes[i];
      }
    }

    return validPrizes[validPrizes.length - 1];
  }

  function buildReel(winner) {
    var sourcePrizes = Array.isArray(state.config.prizes) && state.config.prizes.length
      ? state.config.prizes
      : fallbackConfig.prizes;
    var items = [];
    var winnerIndex = 42;
    var totalItems = 64;

    for (var i = 0; i < totalItems; i += 1) {
      items.push(sourcePrizes[i % sourcePrizes.length]);
    }

    items[winnerIndex] = winner;

    return {
      items: items,
      winnerIndex: winnerIndex
    };
  }

  function renderReel(items, winnerIndex) {
    var fragment = document.createDocumentFragment();
    var track = state.elements.track;

    track.classList.remove("is-spinning");
    track.style.transitionDuration = "0ms";
    track.style.transform = "translate3d(0, 0, 0)";
    track.innerHTML = "";

    items.forEach(function (prize, index) {
      var card = document.createElement("div");
      card.className = "prize-card" + (index === winnerIndex ? " winner" : "");
      card.dataset.prizeId = prize.id || "";

      renderPrizeCardContent(card, prize);
      fragment.appendChild(card);
    });

    track.appendChild(fragment);
    void track.offsetWidth;
  }

  function renderPrizeCardContent(card, prize) {
    var prizeName = prize.name || "Приз";
    var imageSrc = buildPrizeImageSrc(prizeName);

    if (!hasAvailablePrizeImage(imageSrc)) {
      appendPrizeName(card, prizeName);
      return;
    }

    var image = document.createElement("img");

    image.className = "prize-image";
    image.src = imageSrc;
    image.alt = prizeName;
    image.onerror = function () {
      image.onerror = null;
      image.remove();
      appendPrizeName(card, prizeName);
    };

    card.appendChild(image);
  }

  function appendPrizeName(card, prizeName) {
    var name = document.createElement("span");

    name.className = "prize-name";
    name.textContent = prizeName;
    card.appendChild(name);
  }

  function buildPrizeImageSrc(prizeName) {
    return "uploads/" + prizeName + ".png";
  }

  function hasAvailablePrizeImage(imageSrc) {
    var uploadedImages = app.uploadedPrizeImages;

    return Array.isArray(uploadedImages) && uploadedImages.indexOf(imageSrc) !== -1;
  }

  function spinToWinner(winnerIndex, winner) {
    var track = state.elements.track;
    var windowElement = track.parentElement;
    var cardWidth = readCssPixels("--card-width");
    var windowCenter = windowElement.clientWidth / 2;
    var cardCenter = winnerIndex * state.itemWidth + cardWidth / 2;
    var stopOffset = calculatePrizeStopOffset(cardWidth);
    var finalX = windowCenter - cardCenter;
    var duration = Math.max(1000, Number(state.config.spinDurationMs) || fallbackConfig.spinDurationMs);

    track.style.transitionDuration = duration + "ms";
    track.classList.add("is-spinning");
    track.style.transform = "translate3d(" + (finalX - stopOffset) + "px, 0, 0)";

    window.setTimeout(function () {
      showResult(winner);
    }, duration + 80);
  }

  function calculatePrizeStopOffset(cardWidth) {
    var safeCardWidth = Math.max(0, Number(cardWidth) || 0);
    var edgePadding = Math.min(28, safeCardWidth / 2);
    var minOffset = -safeCardWidth / 2 + edgePadding;
    var maxOffset = safeCardWidth / 2 - edgePadding;

    return minOffset + Math.random() * (maxOffset - minOffset);
  }

  function showResult(winner) {
    state.elements.resultName.textContent = winner.name || "Приз";
    state.elements.resultPanel.classList.add("is-visible");
    safePlaySound(state.config.sound || winner.sound);

    window.setTimeout(function () {
      safePlaySound(state.config.sounds && state.config.sounds.close);
      window.setTimeout(function () {
        hideOverlay();
        state.isSpinning = false;
        startNextQueuedSpin();
      }, Math.max(0, Number(state.config.closeDelayMs) || 0));
    }, Math.max(0, Number(state.config.resultDisplayMs) || fallbackConfig.resultDisplayMs));
  }

  function startNextQueuedSpin() {
    if (state.queuedSpins <= 0) {
      return;
    }

    state.queuedSpins -= 1;
    startRoulette();
  }

  function showOverlay() {
    state.elements.overlay.classList.add("is-visible");
  }

  function hideOverlay() {
    state.elements.overlay.classList.remove("is-visible");
  }

  function resetResult() {
    state.elements.resultPanel.classList.remove("is-visible");
    state.elements.resultName.textContent = "-";
  }

  app.roulette = {
    buildPrizeImageSrc: buildPrizeImageSrc,
    calculatePrizeStopOffset: calculatePrizeStopOffset,
    pickWeightedPrize: pickWeightedPrize,
    startRoulette: startRoulette
  };
}(window));
