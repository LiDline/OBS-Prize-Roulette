const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

function loadScript(options) {
  options = options || {};
  const startedSpins = [];
  const documentListeners = {};
  const context = {
    console,
    document: {
      addEventListener: function (eventName, callback) {
        documentListeners[eventName] = callback;
      },
      getElementById: function () {
        return null;
      }
    },
    window: {
      RouletteApp: {
        state: {
          config: {
            donationThreshold: Object.prototype.hasOwnProperty.call(options, "donationThreshold")
              ? options.donationThreshold
              : 500
          },
          elements: {}
        },
        roulette: {
          startRoulette: function (spinContext) {
            startedSpins.push(spinContext || {});
            return true;
          }
        },
        config: {
          loadConfig: async function () {
            return {};
          }
        },
        utils: {
          readCssPixels: function () {
            return 0;
          }
        },
        debug: {
          setupPanel: function () {}
        },
        donationAlerts: {
          init: function () {}
        }
      }
    }
  };

  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "..", "script.js"), "utf8"),
    context,
    { filename: "script.js" }
  );

  return {
    window: context.window,
    startedSpins
  };
}

const loaded = loadScript({ donationThreshold: 500 });

assert.strictEqual(
  loaded.window.handleDonation({ amount: 1000, username: "testName" }),
  true,
  "donation with two full thresholds starts spins"
);
assert.strictEqual(loaded.startedSpins.length, 2, "two full thresholds start two spins");
assert.deepStrictEqual(
  loaded.startedSpins.map(function (spinContext) {
    return spinContext.donorName;
  }),
  ["testName", "testName"],
  "each spin keeps donor context"
);
assert.deepStrictEqual(
  loaded.startedSpins.map(function (spinContext) {
    return {
      spinIndex: spinContext.spinIndex,
      spinCount: spinContext.spinCount
    };
  }),
  [
    { spinIndex: 1, spinCount: 2 },
    { spinIndex: 2, spinCount: 2 }
  ],
  "each spin keeps donation spin counter"
);

loaded.startedSpins.length = 0;
assert.strictEqual(
  loaded.window.handleDonation({ amount: 1499, username: "testName" }),
  true,
  "donation remainder is ignored after full thresholds"
);
assert.strictEqual(loaded.startedSpins.length, 2, "remainder does not add an extra spin");

loaded.startedSpins.length = 0;
assert.strictEqual(
  loaded.window.handleDonation({ amount: 499, username: "testName" }),
  false,
  "donation below threshold does not start spins"
);
assert.strictEqual(loaded.startedSpins.length, 0, "below-threshold donation starts no spins");

const invalidThresholdLoaded = loadScript({ donationThreshold: 0 });

assert.strictEqual(
  invalidThresholdLoaded.window.handleDonation({ amount: 500, username: "testName" }),
  false,
  "invalid threshold does not start spins"
);
assert.strictEqual(
  invalidThresholdLoaded.startedSpins.length,
  0,
  "invalid threshold starts no spins"
);
