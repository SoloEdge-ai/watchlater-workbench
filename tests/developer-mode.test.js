const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("developer mode is opt-in and exposes reload controls without new permissions", () => {
  const service = read("service.js");
  const options = read("options.html");
  const newtab = read("newtab.html");
  const popup = read("popup.html");
  const scripts = `${read("newtab.js")}\n${read("popup.js")}`;
  const manifest = JSON.parse(read("manifest.json"));

  assert.match(service, /developerMode:\s*Boolean\(/);
  assert.match(options, /id="developerMode"/);
  assert.match(newtab, /id="reloadExtension"/);
  assert.match(popup, /id="developerActions"/);
  assert.equal((scripts.match(/RELOAD_EXTENSION/g) || []).length, 2);
  assert.match(service, /chrome\.runtime\.reload\(\)/);
  assert.ok(!manifest.permissions.includes("management"));
});
