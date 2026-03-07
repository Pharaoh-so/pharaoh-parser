// CommonJS require patterns
const path = require("path");
const { readFileSync, writeFileSync } = require("fs");
const { add, multiply } = require("./helpers");
const config = require("./config.json");

function processFile(filePath) {
	const fullPath = path.resolve(filePath);
	const content = readFileSync(fullPath, "utf-8");
	return add(content.length, 1);
}

module.exports = { processFile };
