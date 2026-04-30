const { createServer } = require("./src/app");
const { DEFAULT_HOST, DEFAULT_PORT } = require("./src/constants");
const { parseEnvFile } = require("./src/env");

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
