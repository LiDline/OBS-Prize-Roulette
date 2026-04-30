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

module.exports = {
  writeJson,
  writeText
};
