const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));

test("manifest overrides the new tab and installs both read-only collectors", () => {
  assert.equal(manifest.chrome_url_overrides.newtab, "newtab.html");
  assert.ok(manifest.content_scripts.some((entry) => entry.matches.some((match) => match.includes("bilibili.com/watchlater"))));
  assert.ok(manifest.content_scripts.some((entry) => entry.matches.some((match) => match.includes("youtube.com/playlist"))));
});

test("manifest does not request cookie, identity, history, or request interception permissions", () => {
  const forbidden = ["cookies", "identity", "history", "webRequest", "webRequestBlocking"];
  for (const permission of forbidden) assert.ok(!manifest.permissions.includes(permission), permission);
});

test("AI hosts are optional rather than blanket install-time access", () => {
  assert.ok(manifest.optional_host_permissions.includes("https://*/*"));
  assert.ok(!manifest.host_permissions.includes("https://*/*"));
});
