const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

test("X content adapter resolves the shared source-adapter global during sync", async () => {
  let capturedAdapter;
  const context = {
    document: {},
    window: {},
    location: { pathname: "/i/history" },
    WLWSourceAdapters: {
      pollUntil: async () => "likes",
      pageScrollEnvironment: () => ({}),
      findWhileScrolling: async () => null
    },
    WLWXAdapter: {
      identifyAccount: () => ({ id: "handle:@tester", name: "Tester" }),
      isBookmarksView: () => false,
      historyView: () => "likes",
      tweetArticles: () => [],
      clean: (value) => String(value || "").trim()
    },
    WLWCollectorRuntime: {
      start(adapter) { capturedAdapter = adapter; return Promise.resolve(); }
    },
    WLWSourceActionRuntime: { start() {} }
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "x-content.js"), "utf8"), context);

  await assert.rejects(capturedAdapter.fetchAll(), /处于 Likes，未执行收藏同步/);
});
