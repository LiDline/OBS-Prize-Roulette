const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { URLSearchParams } = require("url");
const vm = require("vm");

const sentSocketMessages = [];
const socketListeners = {};
const styleCss = fs.readFileSync(path.join(__dirname, "..", "style.css"), "utf8");
const fetchCalls = [];
const createdElements = [];
const storedValues = {};
const eventSources = [];
const startedDonations = [];
const timeoutCalls = [];

function MockEventSource(url) {
  this.url = url;
  this.listeners = {};
  eventSources.push(this);
}

MockEventSource.prototype.addEventListener = function (eventName, callback) {
  this.listeners[eventName] = callback;
};
MockEventSource.prototype.close = function () {
  this.closed = true;
};

const context = {
  console,
  URLSearchParams,
  fetch: function (url, options) {
    return context.window.fetch(url, options);
  },
  EventSource: MockEventSource,
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
          removed: false,
          appendChild: function (child) {
            this.children.push(child);
          },
          remove: function () {
            this.removed = true;
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
      hash: "#access_token=memory-token"
    },
    history: {
      replaceState: function () {}
    },
    setTimeout: function (callback, delay) {
      var timeoutId = timeoutCalls.length + 1;

      timeoutCalls.push({
        id: timeoutId,
        callback,
        delay
      });

      return timeoutId;
    },
    RouletteApp: {
      state: {
        config: {
          donationAlerts: {
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

      if (url === "/api/donationalerts/token") {
        return Promise.resolve({
          ok: true,
          json: function () {
            return Promise.resolve({ ok: true });
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

context.window.EventSource = MockEventSource;
context.window.handleDonation = function (donation) {
  startedDonations.push(donation);
};
context.document = context.window.document;

function flushPromises() {
  return new Promise(function (resolve) {
    setImmediate(resolve);
  });
}

function getElementText(element) {
  return (element.textContent || "") + element.children.map(getElementText).join("");
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
    ["/api/donationalerts/token"],
    "client sends OAuth token to backend memory"
  );
  assert.deepStrictEqual(storedValues, {}, "client does not persist DonationAlerts token in localStorage");
  assert.strictEqual(fetchCalls[0].options.headers.Authorization, undefined, "token request does not echo token in Authorization header");
  assert.deepStrictEqual(JSON.parse(fetchCalls[0].options.body), {
    accessToken: "memory-token"
  });
  assert.strictEqual(eventSources.length, 1, "client opens local DonationAlerts event stream");
  assert.strictEqual(eventSources[0].url, "/api/donationalerts/events");
  assert.ok(
    createdElements.some(function (element) {
      return element.className === "donation-auth-status-message" &&
        element.textContent === "DonationAlerts подключен";
    }),
    "client shows success modal after DonationAlerts login"
  );
  var successStatusModal = createdElements.find(function (element) {
    return element.className === "donation-auth-status-modal donation-auth-status-modal-success";
  });
  assert.strictEqual(timeoutCalls[0].delay, 3000, "client schedules DonationAlerts success modal auto-close after 3 seconds");
  timeoutCalls[0].callback();
  assert.strictEqual(successStatusModal.removed, true, "client closes DonationAlerts success modal after 3 seconds");
  assert.strictEqual(
    context.window.RouletteApp.state.donationAlerts.statusModal,
    null,
    "client clears DonationAlerts status modal state after auto-close"
  );

  eventSources[0].listeners.message({
    data: JSON.stringify({
      amount: 1000,
      username: "donor",
      currency: "RUB"
    })
  });
  assert.strictEqual(startedDonations.length, 1, "client starts roulette from local backend donation events");
  assert.strictEqual(startedDonations[0].amount, 1000);
  assert.strictEqual(startedDonations[0].username, "donor");
  assert.strictEqual(startedDonations[0].currency, "RUB");

  context.window.fetch = function (url, options) {
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

    return Promise.resolve({
      ok: false,
      status: 404,
      json: function () {
        return Promise.resolve({});
      }
    });
  };
  eventSources[0].listeners.error();
  await flushPromises();

  assert.strictEqual(
    createdElements.some(function (element) {
      return element.className === "donation-auth-panel";
    }),
    false,
    "client keeps EventSource reconnecting when backend auth is still valid"
  );
  assert.strictEqual(eventSources[0].closed, undefined, "client does not close EventSource after transient stream errors");

  context.window.fetch = function (url, options) {
    fetchCalls.push({
      url,
      options
    });

    if (url === "/api/donationalerts/auth") {
      return Promise.resolve({
        ok: false,
        status: 504,
        json: function () {
          return Promise.resolve({ error: "timeout" });
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
  };
  eventSources[0].listeners.error();
  await flushPromises();

  assert.strictEqual(
    createdElements.some(function (element) {
      return element.className === "donation-auth-panel";
    }),
    false,
    "client does not ask for relogin when auth probe fails without a 401"
  );

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
  storedValues.donationAlertsApplicationId = "18762";
  context.window.RouletteApp.donationAlerts.init();
  await flushPromises();

  var authPanel = createdElements.find(function (element) {
    return element.className === "donation-auth-panel";
  });
  var errorStatusModal = createdElements.find(function (element) {
    return element.className === "donation-auth-status-message" &&
      element.textContent === "Не удалось подключить DonationAlerts";
  });
  var panelInputs = createdElements.filter(function (element) {
    return element.tagName === "INPUT";
  });
  var authLink = createdElements.find(function (element) {
    return element.tagName === "A" && element.textContent === "Получить токен";
  });
  var helpTrigger = createdElements.find(function (element) {
    return element.className === "donation-auth-help-trigger" && element.textContent === "?";
  });
  var helpTooltip = createdElements.find(function (element) {
    return element.className === "donation-auth-help-tooltip";
  });
  var helpLink = createdElements.find(function (element) {
    return element.tagName === "A" && element.textContent === "тут";
  });

  assert.ok(authPanel, "client shows DonationAlerts token panel when auth fails");
  assert.ok(errorStatusModal, "client shows error modal after DonationAlerts login fails");
  var errorStatusModalPanel = createdElements.find(function (element) {
    return element.className === "donation-auth-status-modal donation-auth-status-modal-error";
  });
  assert.strictEqual(timeoutCalls[1].delay, 3000, "client schedules DonationAlerts error modal auto-close after 3 seconds");
  timeoutCalls[1].callback();
  assert.strictEqual(errorStatusModalPanel.removed, true, "client closes DonationAlerts error modal after 3 seconds");
  assert.strictEqual(panelInputs[0].value, "18762", "token panel restores saved application id");
  assert.strictEqual(panelInputs[0].readOnly, false, "token panel lets the user edit application id");
  assert.strictEqual(panelInputs[1].value, "http://127.0.0.1:3000/", "token panel shows redirect url");
  assert.strictEqual(panelInputs[1].readOnly, true, "token panel keeps redirect url read-only");
  assert.ok(helpTrigger, "token panel shows application id help trigger");
  assert.ok(helpTooltip, "token panel includes application id help tooltip");
  assert.strictEqual(
    getElementText(helpTooltip),
    "Создать ID приложения можно тут. URL редиректа укажите http://127.0.0.1:3000/",
    "application id help tooltip explains where to create app and which redirect url to use"
  );
  assert.strictEqual(
    helpLink.href,
    "https://www.donationalerts.com/application/clients",
    "application id help tooltip links to DonationAlerts clients"
  );
  assert.ok(
    /\.donation-auth-help\s*\{[^}]*margin-left:\s*auto;/s.test(styleCss),
    "application id help trigger is aligned to the right edge"
  );
  assert.ok(
    /\.donation-auth-help::before\s*\{[^}]*position:\s*absolute;[^}]*height:\s*8px;/s.test(styleCss),
    "application id help tooltip keeps hover active between trigger and tooltip"
  );

  assert.strictEqual(
    authLink.href,
    "https://www.donationalerts.com/oauth/authorize?client_id=18762&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2F&response_type=token&scope=oauth-user-show%20oauth-donation-subscribe",
    "token panel links to DonationAlerts OAuth with saved application id"
  );

  panelInputs[0].value = "24500";
  panelInputs[0].oninput();

  assert.strictEqual(storedValues.donationAlertsApplicationId, "24500", "token panel saves changed application id");
  assert.strictEqual(
    authLink.href,
    "https://www.donationalerts.com/oauth/authorize?client_id=24500&redirect_uri=http%3A%2F%2F127.0.0.1%3A3000%2F&response_type=token&scope=oauth-user-show%20oauth-donation-subscribe",
    "token panel links to DonationAlerts OAuth"
  );
}()).catch(function (error) {
  console.error(error);
  process.exitCode = 1;
});
