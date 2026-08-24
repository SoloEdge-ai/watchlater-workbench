const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("workbench offers local-only and explicitly bound platform actions for one content item", () => {
  const html = read("newtab.html");
  const script = read("newtab.js");
  assert.match(html, /id="archiveDialog"/);
  assert.match(html, /id="archiveLocalOnly"/);
  assert.match(html, /id="archiveFromSource"/);
  assert.match(script, /START_SOURCE_REMOVE/);
  assert.match(script, /START_SOURCE_RESTORE/);
  assert.match(script, /sourceBindings/);
  assert.doesNotMatch(script, /START_SOURCE_REMOVE[\s\S]{0,120}\bids\b/);
});

test("workbench exposes X sync, statistics, filtering, and text-first cards", () => {
  const html = read("newtab.html");
  const script = read("newtab.js");
  const css = read("newtab.css");
  assert.match(html, /id="xCount"/);
  assert.match(html, /data-sync="x"/);
  assert.match(html, /option value="x">X<\/option>/);
  assert.match(script, /item\.bodyText/);
  assert.match(script, /item\.creatorHandle/);
  assert.match(script, /item\.quotedText/);
  assert.match(css, /post-card/);
});

test("workbench filters video and graphic content separately from platform", () => {
  const html = read("newtab.html");
  const script = read("newtab.js");
  assert.match(html, /id="contentTypeFilter"/);
  assert.match(html, /option value="video">视频<\/option>/);
  assert.match(html, /option value="post">图文<\/option>/);
  assert.match(script, /contentType:\s*"all"/);
  assert.match(script, /contentTypeFilter:\s*"contentType"/);
});

test("settings exposes per-platform binding export and clear controls", () => {
  const html = read("options.html");
  const script = read("options.js");
  assert.match(html, /id="sourceBindings"/);
  assert.match(script, /EXPORT_SOURCE_LIBRARY/);
  assert.match(script, /CLEAR_SOURCE_BINDING/);
  assert.match(script, /expectedAccountId/);
});
