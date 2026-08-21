const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Collectors = require("../collectors.js");

function makeList(length) {
  return Array.from({ length }, (_, index) => ({
    aid: 1000 + index,
    bvid: `BV${String(index).padStart(10, "0")}`,
    title: `视频 ${index + 1}`,
    owner: { name: `UP ${index + 1}` },
    duration: 60 + index,
    progress: 0,
    add_at: 1700000000 + index,
    pubdate: 1600000000 + index,
    tname: "计算机技术",
    pic: `https://i0.hdslb.com/${index}.jpg`
  }));
}

test("Bilibili full sync uses the web endpoint and returns all 404 visible items", async () => {
  const requests = [];
  const context = {
    URL,
    setTimeout,
    clearTimeout,
    WLWCore: {
      sanitizeRules: (value) => value || [],
      mergeVideoRecord: () => {},
      enrichVideo: (value) => value,
      clean: (value) => String(value || "").trim(),
      createSerialQueue: () => (task) => task()
    },
    WLWDatabase: {},
    WLWCollectors: Collectors,
    chrome: {
      storage: {
        local: {
          get: async () => ({ wlwMigratedV1: true }),
          set: async () => {},
          remove: async () => {}
        }
      }
    },
    fetch: async (url) => {
      requests.push(url);
      const full = String(url).includes("/web?");
      return {
        ok: true,
        json: async () => ({ code: 0, data: { count: 404, list: makeList(full ? 404 : 1) } })
      };
    }
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "service.js"), "utf8"), context);

  const result = await context.WLWService.handleMessage(
    { type: "FETCH_BILI_WATCH_LATER" },
    { tab: { url: "https://www.bilibili.com/watchlater/list#/list" } }
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0], "https://api.bilibili.com/x/v2/history/toview/web?jsonp=jsonp");
  assert.equal(result.expectedCount, 404);
  assert.equal(result.items.length, 404);
});

test("Bilibili DOM scan recognizes watch-later links whose BV id is in the query", () => {
  const href = "https://www.bilibili.com/list/watchlater/?bvid=BV1Query1234&oid=123";
  const title = "查询参数形式的稍后再看视频";
  const body = { innerText: "稍后再看 · 404" };
  let capturedAdapter;
  const anchor = {
    href,
    title,
    textContent: title,
    getAttribute: () => "",
    parentElement: null
  };
  const card = {
    innerText: `${title}\n作者\n12:34`,
    parentElement: null,
    querySelectorAll: (selector) => selector.includes("bvid=") ? [anchor] : [],
    querySelector: () => null
  };
  anchor.parentElement = card;
  const context = {
    WLWCollectors: Collectors,
    WLWSourceAdapters: require("../source-adapters.js"),
    WLWCollectorRuntime: { start: (adapter) => { capturedAdapter = adapter; } },
    WLWSourceActionRuntime: { start() {} },
    document: {
      body,
      querySelectorAll: (selector) => selector.includes("bvid=") ? [anchor] : []
    }
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "bilibili-content.js"), "utf8"), context);

  const items = capturedAdapter.scan();

  assert.equal(items.length, 1);
  assert.equal(items[0].id, "bilibili:BV1Query1234");
  assert.equal(items[0].title, title);
});
