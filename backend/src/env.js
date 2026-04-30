const fs = require("fs");

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

module.exports = {
  parseEnvFile
};
