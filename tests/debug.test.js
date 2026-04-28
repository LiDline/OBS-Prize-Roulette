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
    contains: function (name) {
      return names.has(name);
    }
  };
}

function createButton() {
  return {
    listeners: {},
    addEventListener: function (eventName, callback) {
      this.listeners[eventName] = callback;
    },
    click: function () {
      this.listeners.click();
    }
  };
}

const simulatedDonations = [];
const context = {
  URLSearchParams,
  window: {
    location: {
      search: "?debug=1"
    },
    RouletteApp: {
      state: {
        config: {
          prizes: [
            { name: "Тестовый приз", weight: 1 }
          ]
        },
        elements: {
          debugPanel: {
            classList: createClassList()
          },
          oddsOutput: {
            textContent: ""
          },
          donationAmount: {
            value: "500"
          },
          simulateDonationButton: createButton()
        }
      }
    },
    handleDonation: function (donation) {
      simulatedDonations.push(donation);
    }
  }
};

vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "..", "js/debug.js"), "utf8"),
  context,
  { filename: "js/debug.js" }
);

context.window.RouletteApp.debug.setupPanel();
context.window.RouletteApp.state.elements.simulateDonationButton.click();

assert.strictEqual(simulatedDonations[0].amount, "500", "debug donation uses entered amount");
assert.strictEqual(simulatedDonations[0].username, "testName", "debug donation uses testName donor stub");
