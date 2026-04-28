const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function createClassList() {
  const names = new Set();

  return {
    add: function (name) {
      names.add(name);
    },
    remove: function (name) {
      names.delete(name);
    },
    contains: function (name) {
      return names.has(name);
    }
  };
}

function createElement(tagName) {
  const element = {
    tagName,
    children: [],
    className: "",
    classList: createClassList(),
    dataset: {},
    parentElement: null,
    style: {},
    textContent: "",
    attributes: {},
    setAttribute: function (name, value) {
      element.attributes[name] = value;
      element[name] = value;
    },
    remove: function () {
      if (!element.parentElement) {
        return;
      }

      element.parentElement.children = element.parentElement.children.filter(function (child) {
        return child !== element;
      });
      element.parentElement = null;
    },
    appendChild: function (child) {
      if (child.tagName === "fragment") {
        child.children.slice().forEach(function (fragmentChild) {
          element.appendChild(fragmentChild);
        });
        child.children = [];
        return child;
      }

      child.parentElement = element;
      element.children.push(child);
      return child;
    },
    get offsetWidth() {
      return 0;
    },
    get clientWidth() {
      return 600;
    }
  };

  Object.defineProperty(element, "innerHTML", {
    get: function () {
      return "";
    },
    set: function () {
      element.children = [];
    }
  });

  return element;
}

function createDocument() {
  const elements = {
    rouletteOverlay: createElement("div"),
    reelTrack: createElement("div"),
    resultPanel: createElement("div"),
    resultName: createElement("span")
  };
  const reelWindow = createElement("div");
  reelWindow.appendChild(elements.reelTrack);

  return {
    documentElement: createElement("html"),
    createDocumentFragment: function () {
      return createElement("fragment");
    },
    createElement,
    getElementById: function (id) {
      return elements[id] || null;
    }
  };
}

function loadRoulette(options) {
  options = options || {};
  const document = createDocument();
  const pendingTimers = [];
  const playedSounds = [];
  const context = {
    console,
    document,
    window: {},
    requestAnimationFrame: function (callback) {
      callback();
    },
    Audio: function Audio(src) {
      playedSounds.push(src);
      this.play = function () {
        return Promise.resolve();
      };
    }
  };

  context.window.document = document;
  context.window.setTimeout = function (callback) {
    pendingTimers.push(callback);
    return pendingTimers.length;
  };
  context.window.requestAnimationFrame = context.requestAnimationFrame;
  context.window.Math = Object.create(Math);
  context.window.Math.random = function () {
    return options.random ? options.random() : 0;
  };

  if (options.random) {
    context.Math = context.window.Math;
  }
  context.window.RouletteApp = {};
  context.window.RouletteApp.uploadedPrizeImages = [
    "uploads/Тестовый приз.png"
  ];
  context.window.getComputedStyle = function () {
    return {
      getPropertyValue: function (name) {
        if (name === "--card-width") {
          return "220px";
        }

        if (name === "--card-gap") {
          return "18px";
        }

        return "0px";
      }
    };
  };
  context.getComputedStyle = context.window.getComputedStyle;
  context.runTimers = function () {
    while (pendingTimers.length) {
      pendingTimers.shift()();
    }
  };
  context.playedSounds = playedSounds;

  ["js/config.js", "js/state.js", "js/utils.js", "js/roulette.js"].forEach(function (file) {
    vm.runInNewContext(
      fs.readFileSync(path.join(__dirname, "..", file), "utf8"),
      context,
      { filename: file }
    );
  });

  context.window.RouletteApp.state.elements.overlay = document.getElementById("rouletteOverlay");
  context.window.RouletteApp.state.elements.track = document.getElementById("reelTrack");
  context.window.RouletteApp.state.elements.resultPanel = document.getElementById("resultPanel");
  context.window.RouletteApp.state.elements.resultName = document.getElementById("resultName");

  return {
    app: context.window.RouletteApp,
    context
  };
}

const loaded = loadRoulette();
const roulette = loaded.app.roulette;

assert.strictEqual(typeof roulette.calculatePrizeStopOffset, "function");
assert.strictEqual(typeof roulette.buildReel, "function");

const cardWidth = 220;
const edgePadding = 28;
const attempts = 80;
const offsets = new Set();

for (let i = 0; i < attempts; i += 1) {
  const offset = roulette.calculatePrizeStopOffset(cardWidth);

  assert.ok(offset >= -cardWidth / 2 + edgePadding, "offset stays inside left safe edge");
  assert.ok(offset <= cardWidth / 2 - edgePadding, "offset stays inside right safe edge");
  offsets.add(offset);
}

assert.ok(offsets.size > 1, "stop offset varies between spins");

const shuffledLoaded = loadRoulette({
  random: (function () {
    const values = [
      0, 0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95,
      0, 0.95, 0.85, 0.75, 0.65, 0.55, 0.45, 0.35, 0.25, 0.15, 0.05
    ];
    let index = 0;

    return function () {
      const value = values[index % values.length];
      index += 1;
      return value;
    };
  }())
});
const shuffledRoulette = shuffledLoaded.app.roulette;
const shuffledWinner = { id: 1, name: "A", weight: 1 };
shuffledLoaded.app.state.config = Object.assign({}, shuffledLoaded.app.state.config, {
  prizes: [
    shuffledWinner,
    { id: 2, name: "B", weight: 1 },
    { id: 3, name: "C", weight: 1 },
    { id: 4, name: "D", weight: 1 }
  ]
});

const firstReel = shuffledRoulette.buildReel(shuffledWinner);
const secondReel = shuffledRoulette.buildReel(shuffledWinner);
const firstNeighborIds = firstReel.items.slice(firstReel.winnerIndex - 3, firstReel.winnerIndex + 4).map(function (prize) {
  return prize.id;
});
const secondNeighborIds = secondReel.items.slice(secondReel.winnerIndex - 3, secondReel.winnerIndex + 4).map(function (prize) {
  return prize.id;
});

assert.strictEqual(firstReel.items[firstReel.winnerIndex], shuffledWinner, "winner stays at the target reel position");
assert.strictEqual(secondReel.items[secondReel.winnerIndex], shuffledWinner, "winner stays at the target reel position after reshuffle");
assert.notDeepStrictEqual(firstNeighborIds, secondNeighborIds, "neighboring prizes change between reel builds");

loaded.app.state.config = Object.assign({}, loaded.app.state.config, {
  prizes: [
    { id: 1, name: "Тестовый приз", weight: 1 },
    { id: 2, name: "Текстовый приз", weight: 1 }
  ],
  resultDisplayMs: 0,
  closeDelayMs: 0
});

assert.strictEqual(roulette.startRoulette(), true, "spin starts with available prize image");

const firstCard = loaded.app.state.elements.track.children.find(function (child) {
  return child.dataset.prizeId === 1;
});
const firstImage = firstCard.children.find(function (child) {
  return child.tagName === "img";
});

assert.ok(firstImage, "card includes an image");
assert.strictEqual(firstImage.src, "uploads/Тестовый приз.png", "image path is derived from prize name when file is listed");
assert.strictEqual(firstImage.alt, "Тестовый приз", "image alt uses prize name");

firstImage.onerror();

assert.ok(
  firstCard.children.some(function (child) {
    return child.className === "prize-name" && child.textContent === "Тестовый приз";
  }),
  "card falls back to prize name when image is missing"
);

const secondCard = loaded.app.state.elements.track.children.find(function (child) {
  return child.dataset.prizeId === 2;
});
const secondImage = secondCard.children.find(function (child) {
  return child.tagName === "img";
});

assert.strictEqual(secondImage, undefined, "card does not request an image when file is not listed");
assert.ok(
  secondCard.children.some(function (child) {
    return child.className === "prize-name" && child.textContent === "Текстовый приз";
  }),
  "card renders prize name immediately when image file is not listed"
);

loaded.context.runTimers();

loaded.app.state.config = Object.assign({}, loaded.app.state.config, {
  resultDisplayMs: 0,
  closeDelayMs: 0
});

const openSoundCountBeforeQueueTest = loaded.context.playedSounds.filter(function (src) {
  return src === loaded.app.state.config.sounds.open;
}).length;

assert.strictEqual(roulette.startRoulette(), true, "first spin starts immediately");
assert.strictEqual(roulette.startRoulette(), true, "second spin is queued while first spin is active");

loaded.context.runTimers();

assert.strictEqual(
  loaded.context.playedSounds.filter(function (src) {
    return src === loaded.app.state.config.sounds.open;
  }).length - openSoundCountBeforeQueueTest,
  2,
  "queued spin starts after the active spin finishes"
);
