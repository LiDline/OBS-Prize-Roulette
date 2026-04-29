const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { URLSearchParams } = require("url");
const vm = require("vm");

const sentSocketMessages = [];
const socketListeners = {};
const fetchCalls = [];
const createdElements = [];
const storedValues = {};

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
  URLSearchParams,
  fetch: function (url, options) {
    return context.window.fetch(url, options);
  },
  WebSocket: MockWebSocket,
  window: {
    document: {
      body: {
        appendChild: function (element) {
          createdElements.push(element);
        }
      },
      createElement: function (tagName) {
        var element = {
          tagName: tagName.toUpperCase(),
          children: [],
          className: "",
          textContent: "",
          type: "",
          value: "",
          readOnly: false,
          href: "",
          target: "",
          rel: "",
          appendChild: function (child) {
            this.children.push(child);
          },
          addEventListener: function (eventName, callback) {
            this["on" + eventName] = callback;
          }
        };

        createdElements.push(element);
        return element;
      }
    },
    localStorage: {
      getItem: function (key) {
        return storedValues[key] || null;
      },
      setItem: function (key, value) {
        storedValues[key] = String(value);
      },
      removeItem: function (key) {
        delete storedValues[key];
      }
    },
    location: {
      origin: "http://127.0.0.1:3000",
      pathname: "/",
      search: "",
      hash: ""
    },
    history: {
      replaceState: function () {}
    },
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
context.document = context.window.document;

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

  context.window.fetch = function () {
    return Promise.resolve({
      ok: false,
      status: 401,
      json: function () {
        return Promise.resolve({ error: "invalid token" });
      }
    });
  };
  context.window.RouletteApp.state.donationAlerts.socket = null;
  context.window.RouletteApp.donationAlerts.init();
  await flushPromises();

  var authPanel = createdElements.find(function (element) {
    return element.className === "donation-auth-panel";
  });
  var panelInputs = createdElements.filter(function (element) {
    return element.tagName === "INPUT";
  });
  var authLink = createdElements.find(function (element) {
    return element.tagName === "A" && element.textContent === "Получить токен";
  });

  assert.ok(authPanel, "client shows DonationAlerts token panel when auth fails");
  assert.strictEqual(panelInputs[0].value, "", "token panel leaves application id empty");
  assert.strictEqual(panelInputs[0].readOnly, false, "token panel lets the user edit application id");
  assert.strictEqual(panelInputs[1].value, "http://127.0.0.1:3000/", "token panel shows redirect url");
  assert.strictEqual(panelInputs[1].readOnly, true, "token panel keeps redirect url read-only");

  panelInputs[0].value = "18762";
  panelInputs[0].oninput();

  assert.strictEqual(
    authLink.href,
    "https://www.donationalerts.com/oauth/authorize?client_id=18762&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2F&response_type=token&scope=oauth-user-show%20oauth-donation-subscribe",
    "token panel links to DonationAlerts OAuth"
  );
}()).catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
