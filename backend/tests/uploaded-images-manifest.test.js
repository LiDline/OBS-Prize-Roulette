const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const generator = require("../scripts/generate-uploaded-images-manifest");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "roulette-images-"));
const uploadsDir = path.join(tmpDir, "uploads");
const outputPath = path.join(tmpDir, "js", "uploaded-images.js");

fs.mkdirSync(uploadsDir);
fs.mkdirSync(path.dirname(outputPath));
fs.writeFileSync(path.join(uploadsDir, "B.png"), "");
fs.writeFileSync(path.join(uploadsDir, "A.png"), "");
fs.writeFileSync(path.join(uploadsDir, "ignore.txt"), "");
fs.mkdirSync(path.join(uploadsDir, "nested"));

generator.generateManifest({
  uploadsDir,
  outputPath,
  uploadsUrl: "uploads"
});

const context = { window: {} };
vm.runInNewContext(fs.readFileSync(outputPath, "utf8"), context);

assert.deepStrictEqual(
  Array.from(context.window.RouletteApp.uploadedPrizeImages),
  ["uploads/A.png", "uploads/B.png"],
  "manifest contains sorted PNG files from uploads"
);
