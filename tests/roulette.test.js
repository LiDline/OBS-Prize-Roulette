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
    appendChild: function (child) {
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

function loadRoulette() {
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
  context.window.RouletteApp = {};
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

loaded.app.state.config = Object.assign({}, loaded.app.state.config, {
  resultDisplayMs: 0,
  closeDelayMs: 0
});

assert.strictEqual(roulette.startRoulette(), true, "first spin starts immediately");
assert.strictEqual(roulette.startRoulette(), true, "second spin is queued while first spin is active");

loaded.context.runTimers();

assert.strictEqual(
  loaded.context.playedSounds.filter(function (src) {
    return src === loaded.app.state.config.sounds.open;
  }).length,
  2,
  "queued spin starts after the active spin finishes"
);
