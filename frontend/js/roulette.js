(function (window) {
  "use strict";

  var app = window.RouletteApp;
  var state = app.state;
  var fallbackConfig = app.config.fallbackConfig;
  var readCssPixels = app.utils.readCssPixels;
  var safePlaySound = app.utils.safePlaySound;
  var cardSoundAnimationFrame = null;
  var lastSoundCardIndex = null;

  function startRoulette(spinContext) {
    spinContext = normalizeSpinContext(spinContext);

    if (state.isSpinning) {
      state.queuedSpins += 1;
      state.queuedSpinContexts.push(spinContext);
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
    updateTitle(spinContext);
    showOverlay();

    var reel = buildReel(winner);
    renderReel(reel.items, reel.winnerIndex);

    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        spinToWinner(reel.winnerIndex, winner, spinContext);
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

    while (items.length < totalItems) {
      shufflePrizes(sourcePrizes).forEach(function (prize) {
        if (items.length < totalItems) {
          items.push(prize);
        }
      });
    }

    items[winnerIndex] = winner;

    return {
      items: items,
      winnerIndex: winnerIndex
    };
  }

  function shufflePrizes(prizes) {
    var shuffled = prizes.slice();

    for (var i = shuffled.length - 1; i > 0; i -= 1) {
      var swapIndex = Math.floor(Math.random() * (i + 1));
      var currentPrize = shuffled[i];

      shuffled[i] = shuffled[swapIndex];
      shuffled[swapIndex] = currentPrize;
    }

    return shuffled;
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

  function normalizeSpinContext(spinContext) {
    if (!spinContext || typeof spinContext !== "object") {
      return {
        donorName: "",
        spinIndex: 0,
        spinCount: 0
      };
    }

    return {
      donorName: spinContext.donorName || "",
      spinIndex: Math.max(0, Math.floor(Number(spinContext.spinIndex) || 0)),
      spinCount: Math.max(0, Math.floor(Number(spinContext.spinCount) || 0))
    };
  }

  function spinToWinner(winnerIndex, winner, spinContext) {
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
    startCardChangeSoundWatcher(track);
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
    stopCardChangeSoundWatcher();
    state.elements.resultName.textContent = winner.name || "Приз";
    state.elements.resultPanel.classList.add("is-visible");

    window.setTimeout(function () {
      window.setTimeout(function () {
        hideOverlay();
        state.isSpinning = false;
        startNextQueuedSpin();
      }, Math.max(0, Number(state.config.closeDelayMs) || 0));
    }, Math.max(0, Number(state.config.resultDisplayMs) || fallbackConfig.resultDisplayMs));
  }

  function startCardChangeSoundWatcher(track) {
    stopCardChangeSoundWatcher();

    lastSoundCardIndex = calculateCurrentCardIndex(track);
    cardSoundAnimationFrame = window.requestAnimationFrame(function watchCardChange() {
      var currentIndex = calculateCurrentCardIndex(track);

      if (currentIndex !== lastSoundCardIndex) {
        lastSoundCardIndex = currentIndex;
        safePlaySound(state.config.sound);
      }

      if (state.isSpinning) {
        cardSoundAnimationFrame = window.requestAnimationFrame(watchCardChange);
      }
    });
  }

  function stopCardChangeSoundWatcher() {
    if (cardSoundAnimationFrame !== null && typeof window.cancelAnimationFrame === "function") {
      window.cancelAnimationFrame(cardSoundAnimationFrame);
    }

    cardSoundAnimationFrame = null;
    lastSoundCardIndex = null;
  }

  function calculateCurrentCardIndex(track) {
    var windowElement = track.parentElement;
    var transform = window.getComputedStyle(track).transform;
    var windowWidth = windowElement ? windowElement.clientWidth : 0;

    return calculateCardIndexFromTransform(transform, state.itemWidth, windowWidth);
  }

  function calculateCardIndexFromTransform(transform, itemWidth, windowWidth) {
    var safeItemWidth = Math.max(1, Number(itemWidth) || 1);
    var windowCenter = Math.max(0, Number(windowWidth) || 0) / 2;
    var translateX = parseTranslateX(transform);

    return Math.max(0, Math.floor((windowCenter - translateX) / safeItemWidth));
  }

  function parseTranslateX(transform) {
    var matrixMatch;

    if (!transform || transform === "none") {
      return 0;
    }

    matrixMatch = transform.match(/^matrix\(([^)]+)\)$/);

    if (matrixMatch) {
      return Number(matrixMatch[1].split(",")[4]) || 0;
    }

    matrixMatch = transform.match(/^matrix3d\(([^)]+)\)$/);

    if (matrixMatch) {
      return Number(matrixMatch[1].split(",")[12]) || 0;
    }

    return 0;
  }

  function startNextQueuedSpin() {
    if (state.queuedSpins <= 0) {
      return;
    }

    state.queuedSpins -= 1;
    startRoulette(state.queuedSpinContexts.shift());
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
    updateTitle();
  }

  function updateTitle(spinContext) {
    if (!state.elements.title) {
      return;
    }

    var donorName = spinContext && spinContext.donorName;
    var spinIndex = spinContext && spinContext.spinIndex;
    var spinCount = spinContext && spinContext.spinCount;
    var title = donorName
      ? "Рулетка призов для " + donorName
      : "Рулетка призов";

    if (spinCount > 1 && spinIndex > 0) {
      title += " - " + spinIndex + "/" + spinCount;
    }

    state.elements.title.textContent = title;
  }

  app.roulette = {
    buildReel: buildReel,
    buildPrizeImageSrc: buildPrizeImageSrc,
    calculateCardIndexFromTransform: calculateCardIndexFromTransform,
    calculatePrizeStopOffset: calculatePrizeStopOffset,
    pickWeightedPrize: pickWeightedPrize,
    startRoulette: startRoulette
  };
}(window));
