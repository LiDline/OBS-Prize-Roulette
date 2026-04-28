const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadRoulette() {
  const context = {
    console,
    window: {},
    Audio: function Audio() {}
  };

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

  ["js/config.js", "js/state.js", "js/utils.js", "js/roulette.js"].forEach(function (file) {
    vm.runInNewContext(
      fs.readFileSync(path.join(__dirname, "..", file), "utf8"),
      context,
      { filename: file }
    );
  });

  return context.window.RouletteApp.roulette;
}

const roulette = loadRoulette();

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
