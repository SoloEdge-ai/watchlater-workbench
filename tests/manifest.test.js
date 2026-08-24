const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
const read = (name) => fs.readFileSync(path.join(__dirname, "..", name), "utf8");

test("manifest overrides the new tab and installs all account-safe page adapters", () => {
  assert.equal(manifest.chrome_url_overrides.newtab, "src/ui/newtab.html");
  assert.ok(manifest.content_scripts.some((entry) => entry.matches.some((match) => match.includes("bilibili.com/watchlater"))));
  assert.ok(manifest.content_scripts.some((entry) => entry.matches.some((match) => match.includes("youtube.com/playlist"))));
  const xEntry = manifest.content_scripts.find((entry) => entry.matches.some((match) => match.includes("x.com/i/history")));
  assert.ok(xEntry);
  assert.ok(xEntry.matches.some((match) => match.includes("x.com/i/bookmarks")));
  assert.ok(xEntry.matches.some((match) => match.includes("x.com/*/status")));
  assert.ok(xEntry.js.includes("src/content/x-adapter.js"));
  assert.ok(xEntry.js.includes("src/content/x-content.js"));
  for (const entry of manifest.content_scripts) {
    assert.ok(entry.js.includes("src/shared/source-accounts.js"));
    assert.ok(entry.js.includes("src/shared/source-adapters.js"));
    assert.ok(entry.js.includes("src/content/source-action-runtime.js"));
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
  const adapters = `${read("src/content/bilibili-content.js")}\n${read("src/content/youtube-content.js")}\n${read("src/content/x-content.js")}\n${read("src/content/x-adapter.js")}\n${read("src/shared/source-adapters.js")}\n${read("src/content/source-action-runtime.js")}`;
  assert.doesNotMatch(adapters, /method\s*:\s*["'](?:POST|PUT|PATCH|DELETE)["']/i);
  assert.match(adapters, /menuItem\.click\(\)/);
  assert.doesNotMatch(read("src/content/bilibili-content.js"), /class\*=['"]more/i);
  assert.match(read("src/content/x-content.js"), /处于 Likes，未执行收藏同步/);
  assert.doesNotMatch(read("src/content/x-content.js"), /\.click\(\)/);
});
