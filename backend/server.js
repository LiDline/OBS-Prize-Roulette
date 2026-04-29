const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const { URL } = require("url");

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_API_BASE_URL = "https://www.donationalerts.com/api/v1";

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".txt": "text/plain; charset=utf-8"
};

function createServer(options) {
  options = options || {};

  const projectRoot = options.rootDir || path.resolve(__dirname, "..");
  const frontendDir = options.frontendDir || path.join(projectRoot, "frontend");
  const uploadsDir = options.uploadsDir || path.join(projectRoot, "uploads");
  const env = Object.assign({}, parseEnvFile(path.join(projectRoot, ".env")), process.env, options.env || {});

  return http.createServer(function (request, response) {
    if (request.url === "/api/donationalerts/auth" && request.method === "GET") {
      handleDonationAlertsAuth(request, response, env);
      return;
    }

    if (request.url === "/api/donationalerts/subscribe" && request.method === "POST") {
      handleDonationAlertsSubscribe(request, response, env);
      return;
    }

    serveStaticRequest(request, response, frontendDir, uploadsDir);
  });
}

async function handleDonationAlertsAuth(request, response, env) {
  try {
    const profile = await donationAlertsApiRequest(env, "/user/oauth", {
      method: "GET",
      accessToken: getDonationAlertsAccessToken(request)
    });
    const profileData = profile && profile.data ? profile.data : {};

    if (!profileData.id || !profileData.socket_connection_token) {
      throw new Error("DonationAlerts /user/oauth response does not contain id or socket_connection_token.");
    }

    writeJson(response, 200, {
      userId: profileData.id,
      socketConnectionToken: profileData.socket_connection_token
    });
  } catch (error) {
    writeJson(response, error.statusCode || 500, {
      error: error.message
    });
  }
}

async function handleDonationAlertsSubscribe(request, response, env) {
  try {
    const body = await readRequestJson(request);

    if (!Array.isArray(body.channels) || typeof body.client !== "string" || !body.client) {
      writeJson(response, 400, {
        error: "Request body must contain channels array and client string."
      });
      return;
    }

    const subscription = await donationAlertsApiRequest(env, "/centrifuge/subscribe", {
      method: "POST",
      accessToken: getDonationAlertsAccessToken(request),
      body: JSON.stringify({
        channels: body.channels,
        client: body.client
      })
    });

    writeJson(response, 200, subscription);
  } catch (error) {
    writeJson(response, error.statusCode || 500, {
      error: error.message
    });
  }
}

function donationAlertsApiRequest(env, pathname, options) {
  const accessToken = options.accessToken;

  if (!accessToken) {
    const error = new Error("DonationAlerts access token is required.");
    error.statusCode = 401;
    throw error;
  }

  const apiBaseUrl = env.DONATIONALERTS_API_BASE_URL || DEFAULT_API_BASE_URL;
  const timeoutMs = Math.max(1, Number(env.DONATIONALERTS_REQUEST_TIMEOUT_MS) || 10000);
  const requestUrl = new URL(apiBaseUrl + pathname);
  const transport = requestUrl.protocol === "http:" ? http : https;
  const body = options.body || "";

  return new Promise(function (resolve, reject) {
    const apiRequest = transport.request({
      method: options.method,
      hostname: requestUrl.hostname,
      port: requestUrl.port,
      path: requestUrl.pathname + requestUrl.search,
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body)
      }
    }, function (apiResponse) {
      let responseBody = "";

      apiResponse.on("data", function (chunk) {
        responseBody += chunk;
      });

      apiResponse.on("end", function () {
        if (apiResponse.statusCode < 200 || apiResponse.statusCode >= 300) {
          const error = new Error("DonationAlerts API " + pathname + " failed with HTTP " + apiResponse.statusCode);
          error.statusCode = apiResponse.statusCode;
          reject(error);
          return;
        }

        try {
          resolve(responseBody ? JSON.parse(responseBody) : {});
        } catch (error) {
          reject(error);
        }
      });
    });

    apiRequest.on("error", reject);
    apiRequest.setTimeout(timeoutMs, function () {
      const error = new Error("DonationAlerts API " + pathname + " timed out.");
      error.statusCode = 504;
      apiRequest.destroy(error);
    });

    if (body) {
      apiRequest.write(body);
    }

    apiRequest.end();
  });
}

function getDonationAlertsAccessToken(request) {
  const authorization = request.headers.authorization || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);

  if (match && match[1].trim()) {
    return match[1].trim();
  }

  return "";
}

function readRequestJson(request) {
  return new Promise(function (resolve, reject) {
    let body = "";

    request.on("data", function (chunk) {
      body += chunk;
    });

    request.on("end", function () {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });

    request.on("error", reject);
  });
}

function serveStaticRequest(request, response, frontendDir, uploadsDir) {
  const requestUrl = new URL(request.url, "http://localhost");
  const pathname = decodeURIComponent(requestUrl.pathname);

  if (pathname.indexOf("/uploads/") === 0) {
    serveStaticFile(response, uploadsDir, pathname.slice("/uploads/".length));
    return;
  }

  serveStaticFile(response, frontendDir, pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
}

function serveStaticFile(response, baseDir, relativePath) {
  const resolvedBaseDir = path.resolve(baseDir);
  const filePath = path.resolve(resolvedBaseDir, relativePath);

  if (!filePath.startsWith(resolvedBaseDir + path.sep) && filePath !== resolvedBaseDir) {
    writeText(response, 403, "Forbidden");
    return;
  }

  fs.stat(filePath, function (statError, stats) {
    if (statError || !stats.isFile()) {
      writeText(response, 404, "Not found");
      return;
    }

    response.statusCode = 200;
    response.setHeader("Content-Type", MIME_TYPES[path.extname(filePath)] || "application/octet-stream");
    fs.createReadStream(filePath).pipe(response);
  });
}

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return fs.readFileSync(filePath, "utf8").split(/\r?\n/).reduce(function (result, line) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.charAt(0) === "#") {
      return result;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      return result;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if ((value.charAt(0) === "\"" && value.charAt(value.length - 1) === "\"") ||
        (value.charAt(0) === "'" && value.charAt(value.length - 1) === "'")) {
      value = value.slice(1, -1);
    }

    result[key] = value;
    return result;
  }, {});
}

function writeJson(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function writeText(response, statusCode, body) {
  response.statusCode = statusCode;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.end(body);
}

if (require.main === module) {
  const port = Number(process.env.PORT) || DEFAULT_PORT;
  const host = process.env.HOST || DEFAULT_HOST;

  createServer().listen(port, host, function () {
    console.log("OBS Prize Roulette server: http://" + host + ":" + port + "/");
  });
}

module.exports = {
  createServer,
  parseEnvFile
};
