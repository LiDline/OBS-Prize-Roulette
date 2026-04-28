const fs = require("fs");
const path = require("path");

function generateManifest(options) {
  const uploadsDir = options.uploadsDir;
  const outputPath = options.outputPath;
  const uploadsUrl = options.uploadsUrl || "uploads";
  const images = fs.readdirSync(uploadsDir, { withFileTypes: true })
    .filter(function (entry) {
      return entry.isFile() && path.extname(entry.name).toLowerCase() === ".png";
    })
    .map(function (entry) {
      return uploadsUrl + "/" + entry.name;
    })
    .sort(function (left, right) {
      return left.localeCompare(right, "ru");
    });

  const content = [
    "(function (window) {",
    "  \"use strict\";",
    "",
    "  window.RouletteApp = window.RouletteApp || {};",
    "  window.RouletteApp.uploadedPrizeImages = " + JSON.stringify(images, null, 2).replace(/\n/g, "\n  ") + ";",
    "}(window));",
    ""
  ].join("\n");

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, content);
}

if (require.main === module) {
  generateManifest({
    uploadsDir: path.join(__dirname, "..", "uploads"),
    outputPath: path.join(__dirname, "..", "js", "uploaded-images.js"),
    uploadsUrl: "uploads"
  });
}

module.exports = {
  generateManifest
};
