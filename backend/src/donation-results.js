const fs = require("fs");
const path = require("path");
const { writeJson } = require("./http-response");

const CSV_HEADER = "created_at,donor_name,donation_amount,spin_index,spin_count,prize_id,prize_name\n";

async function handleDonationResult(request, response, options) {
  try {
    const body = await readRequestJson(request);
    const csvPath = options.csvPath;
    const now = options.now || function () {
      return new Date();
    };
    const row = [
      now().toISOString(),
      body.donorName || "",
      body.donationAmount,
      body.spinIndex,
      body.spinCount,
      body.prizeId,
      body.prizeName || ""
    ].map(formatCsvCell).join(",") + "\n";

    ensureCsvFile(csvPath);
    fs.appendFileSync(csvPath, row);
    writeJson(response, 200, { ok: true });
  } catch (error) {
    writeJson(response, error.statusCode || 400, {
      error: error.message || "Request body must contain valid JSON."
    });
  }
}

function ensureCsvFile(csvPath) {
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });

  if (!fs.existsSync(csvPath) || fs.statSync(csvPath).size === 0) {
    fs.writeFileSync(csvPath, CSV_HEADER);
  }
}

function formatCsvCell(value) {
  if (value === undefined || value === null) {
    return "\"\"";
  }

  return "\"" + String(value).replace(/"/g, "\"\"") + "\"";
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

module.exports = {
  handleDonationResult
};
