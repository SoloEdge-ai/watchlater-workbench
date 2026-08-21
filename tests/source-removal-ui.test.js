const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("workbench offers local-only and explicitly bound platform removal for one video", () => {
  const html = read("newtab.html");
  const script = read("newtab.js");
  assert.match(html, /id="archiveDialog"/);
  assert.match(html, /id="archiveLocalOnly"/);
  assert.match(html, /id="archiveFromSource"/);
  assert.match(script, /START_SOURCE_REMOVE/);
  assert.match(script, /sourceBindings/);
  assert.doesNotMatch(script, /START_SOURCE_REMOVE[\s\S]{0,120}\bids\b/);
});

test("settings exposes per-platform binding export and clear controls", () => {
  const html = read("options.html");
  const script = read("options.js");
  assert.match(html, /id="sourceBindings"/);
  assert.match(script, /EXPORT_SOURCE_LIBRARY/);
  assert.match(script, /CLEAR_SOURCE_BINDING/);
  assert.match(script, /expectedAccountId/);
});
