const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const { MIME_TYPES } = require("./constants");
const { writeText } = require("./http-response");

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

module.exports = {
  serveStaticRequest
};
