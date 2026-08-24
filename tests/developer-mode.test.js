const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("developer mode is opt-in and exposes reload controls without new permissions", () => {
  const service = read("src/background/service.js");
  const options = read("src/ui/options.html");
  const newtab = read("src/ui/newtab.html");
  const popup = read("src/ui/popup.html");
  const scripts = `${read("src/ui/newtab.js")}\n${read("src/ui/popup.js")}`;
  const manifest = JSON.parse(read("manifest.json"));

  assert.match(service, /developerMode:\s*Boolean\(/);
  assert.match(options, /id="developerMode"/);
  assert.match(newtab, /id="reloadExtension"/);
  assert.match(popup, /id="developerActions"/);
  assert.equal((scripts.match(/RELOAD_EXTENSION/g) || []).length, 2);
  assert.match(service, /chrome\.runtime\.reload\(\)/);
  assert.ok(!manifest.permissions.includes("management"));
});

test("popup and settings open the relocated dashboard entry point", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const scripts = `${read("src/ui/popup.js")}\n${read("src/ui/options.js")}`;
  const dashboardPath = manifest.chrome_url_overrides.newtab;

  assert.equal(dashboardPath, "src/ui/newtab.html");
  assert.equal(scripts.split(`chrome.runtime.getURL("${dashboardPath}")`).length - 1, 2);
});
