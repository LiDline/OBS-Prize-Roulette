const { createServer } = require("./src/app");
const { DEFAULT_HOST, DEFAULT_PORT } = require("./src/constants");
const { parseEnvFile } = require("./src/env");
const { generateManifest } = require("./scripts/generate-uploaded-images-manifest");
const path = require("path");

function refreshUploadedImagesManifest(options) {
  const projectRoot = options.rootDir || path.resolve(__dirname, "..");
  const frontendDir = options.frontendDir || path.join(projectRoot, "frontend");
  const uploadsDir = options.uploadsDir || path.join(projectRoot, "uploads");

  generateManifest({
    uploadsDir: uploadsDir,
    outputPath: path.join(frontendDir, "js", "uploaded-images.js"),
    uploadsUrl: "uploads"
  });
}

function startServer(options) {
  options = options || {};

  const configuredPort = options.port !== undefined ? options.port : process.env.PORT;
  const port = configuredPort !== undefined ? Number(configuredPort) : DEFAULT_PORT;
  const host = options.host || process.env.HOST || DEFAULT_HOST;
  const log = options.log || console.log;

  refreshUploadedImagesManifest(options);

  return new Promise(function (resolve, reject) {
    const instance = createServer(options).listen(port, host, function () {
      log("OBS Prize Roulette server: http://" + host + ":" + instance.address().port + "/");
      resolve(instance);
    });

    instance.on("error", reject);
  });
}

if (require.main === module) {
  startServer().catch(function (error) {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  createServer,
  parseEnvFile,
  refreshUploadedImagesManifest,
  startServer
};
