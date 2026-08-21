const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

test("manifest overrides the new tab and installs both account-safe page adapters", () => {
  assert.equal(manifest.chrome_url_overrides.newtab, "newtab.html");
  assert.ok(manifest.content_scripts.some((entry) => entry.matches.some((match) => match.includes("bilibili.com/watchlater"))));
  assert.ok(manifest.content_scripts.some((entry) => entry.matches.some((match) => match.includes("youtube.com/playlist"))));
  for (const entry of manifest.content_scripts) {
    assert.ok(entry.js.includes("source-accounts.js"));
    assert.ok(entry.js.includes("source-adapters.js"));
    assert.ok(entry.js.includes("source-action-runtime.js"));
  }
});

test("manifest does not request cookie, identity, history, or request interception permissions", () => {
  const forbidden = ["cookies", "identity", "history", "webRequest", "webRequestBlocking"];
  for (const permission of forbidden) assert.ok(!manifest.permissions.includes(permission), permission);
});

test("AI hosts are optional rather than blanket install-time access", () => {
  assert.ok(manifest.optional_host_permissions.includes("https://*/*"));
  assert.ok(!manifest.host_permissions.includes("https://*/*"));
});

test("platform removal adapters use page controls rather than direct write requests", () => {
  const adapters = `${read("bilibili-content.js")}\n${read("youtube-content.js")}\n${read("source-adapters.js")}\n${read("source-action-runtime.js")}`;
  assert.doesNotMatch(adapters, /method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
  assert.match(adapters, /menuItem\.click\(\)/);
  assert.doesNotMatch(read("bilibili-content.js"), /class\*=['"]more/i);
});
