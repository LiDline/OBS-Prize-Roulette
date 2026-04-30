const http = require("http");
const path = require("path");

const {
  handleDonationAlertsAuth,
  handleDonationAlertsEvents,
  handleDonationAlertsSubscribe,
  handleDonationAlertsToken
} = require("./donationalerts");
const { handleDonationResult } = require("./donation-results");
const { parseEnvFile } = require("./env");
const { serveStaticRequest } = require("./static");
const { createWebSocketClient } = require("./websocket-client");

function createServer(options) {
  options = options || {};

  const projectRoot = options.rootDir || path.resolve(__dirname, "..", "..");
  const frontendDir = options.frontendDir || path.join(projectRoot, "frontend");
  const uploadsDir = options.uploadsDir || path.join(projectRoot, "uploads");
  const donationResultsCsvPath = options.donationResultsCsvPath || path.join(projectRoot, "donation-results.csv");
  const env = Object.assign({}, parseEnvFile(path.join(projectRoot, ".env")), process.env, options.env || {});
  const donationAlertsSocketFactory = options.donationAlertsSocketFactory || createWebSocketClient;
  const memory = {
    donationAlertsAccessToken: "",
    donationAlertsSocket: null,
    donationAlertsMessageId: 1,
    donationAlertsEventClients: []
  };

  return http.createServer(function (request, response) {
    if (request.url === "/api/donationalerts/token" && request.method === "POST") {
      handleDonationAlertsToken(request, response, env, memory, donationAlertsSocketFactory);
      return;
    }

    if (request.url === "/api/donationalerts/events" && request.method === "GET") {
      handleDonationAlertsEvents(request, response, env, memory);
      return;
    }

    if (request.url === "/api/donationalerts/auth" && request.method === "GET") {
      handleDonationAlertsAuth(request, response, env, memory);
      return;
    }

    if (request.url === "/api/donationalerts/subscribe" && request.method === "POST") {
      handleDonationAlertsSubscribe(request, response, env, memory);
      return;
    }

    if (request.url === "/api/donation-results" && request.method === "POST") {
      handleDonationResult(request, response, {
        csvPath: donationResultsCsvPath,
        now: options.now
      });
      return;
    }

    serveStaticRequest(request, response, frontendDir, uploadsDir);
  });
}

module.exports = {
  createServer
};
