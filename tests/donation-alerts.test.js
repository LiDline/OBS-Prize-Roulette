const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sentSocketMessages = [];
const socketListeners = {};
const fetchCalls = [];

function MockWebSocket(url) {
  this.url = url;
  this.readyState = MockWebSocket.OPEN;
}

MockWebSocket.OPEN = 1;
MockWebSocket.prototype.addEventListener = function (eventName, callback) {
  socketListeners[eventName] = callback;
};
MockWebSocket.prototype.send = function (message) {
  sentSocketMessages.push(JSON.parse(message));
};

const context = {
  console,
  fetch: function (url, options) {
    return context.window.fetch(url, options);
  },
  WebSocket: MockWebSocket,
  window: {
    setTimeout,
    RouletteApp: {
      state: {
        config: {
          donationAlerts: {
            proxyBaseUrl: "/api/donationalerts",
            socketUrl: "wss://centrifugo.donationalerts.com/connection/websocket",
            autoReconnect: false,
            reconnectDelayMs: 5000
          }
        },
        donationAlerts: {
          socket: null,
          messageId: 1,
          reconnectTimer: null
        }
      }
    },
    fetch: function (url, options) {
      fetchCalls.push({
        url,
        options
      });

      if (url === "/api/donationalerts/auth") {
        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve({
              userId: 321,
              socketConnectionToken: "socket-token"
            });
          }
        });
      }

      if (url === "/api/donationalerts/subscribe") {
        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve({
              channels: [
                {
                  channel: "$alerts:donation_321",
                  token: "channel-token"
                }
              ]
            });
          }
        });
      }

      return Promise.resolve({
        ok: false,
        status: 404,
        json: function () {
          return Promise.resolve({});
        }
      });
    }
  }
};

context.window.WebSocket = MockWebSocket;
context.window.handleDonation = function () {};

function flushPromises() {
  return new Promise(function (resolve) {
    setImmediate(resolve);
  });
}

vm.runInNewContext(
  fs.readFileSync(path.join(__dirname, "..", "js", "donation-alerts.js"), "utf8"),
  context,
  { filename: "donation-alerts.js" }
);

(async function () {
  context.window.RouletteApp.donationAlerts.init();
  await flushPromises();

  assert.deepStrictEqual(
    fetchCalls.map(function (call) {
      return call.url;
    }),
    ["/api/donationalerts/auth"],
    "client resolves auth through the local proxy endpoint"
  );

  socketListeners.open();
  socketListeners.message({
    data: JSON.stringify({
      result: {
        client: "client-id"
      }
    })
  });
  await Promise.resolve();
  await flushPromises();

  assert.strictEqual(fetchCalls[1].url, "/api/donationalerts/subscribe");
  assert.strictEqual(fetchCalls[1].options.headers.Authorization, undefined);
  assert.deepStrictEqual(JSON.parse(fetchCalls[1].options.body), {
    channels: ["$alerts:donation_321"],
    client: "client-id"
  });
  assert.deepStrictEqual(sentSocketMessages, [
    {
      params: {
        token: "socket-token"
      },
      id: 2
    },
    {
      params: {
        channel: "$alerts:donation_321",
        token: "channel-token"
      },
      method: 1,
      id: 3
    }
  ]);
}()).catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
