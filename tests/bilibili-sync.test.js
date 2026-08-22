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

test("Bilibili full sync can use the logged-in page when the service-worker fetch fails", async () => {
  let capturedAdapter;
  let backgroundRequests = 0;
  const apiBody = { code: 0, data: { count: 405, list: makeList(405) } };
  const context = {
    WLWCollectors: Collectors,
    WLWSourceAdapters: require("../source-adapters.js"),
    WLWCollectorRuntime: { start: (adapter) => { capturedAdapter = adapter; } },
    WLWSourceActionRuntime: { start() {} },
    document: { body: { innerText: "稍后再看 · 405" }, querySelectorAll: () => [] },
    fetch: async (url) => {
      assert.equal(String(url), "https://api.bilibili.com/x/v2/history/toview/web?jsonp=jsonp");
      return { ok: true, json: async () => apiBody };
    },
    chrome: {
      runtime: {
        sendMessage: async (message) => {
          if (message.type === "FETCH_BILI_WATCH_LATER") {
            backgroundRequests += 1;
            return { ok: false, error: "Failed to fetch" };
          }
          return { ok: false };
        }
      }
    }
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "bilibili-content.js"), "utf8"), context);

  const snapshot = await capturedAdapter.fetchAll();

  assert.equal(snapshot.expectedCount, 405);
  assert.equal(snapshot.items.length, 405);
  assert.equal(backgroundRequests, 0);
});

test("Bilibili full sync falls back to the service worker when the page request fails", async () => {
  let capturedAdapter;
  const items = Collectors.normalizeBilibiliApiResponse({ code: 0, data: { list: makeList(405) } });
  const context = {
    WLWCollectors: Collectors,
    WLWSourceAdapters: require("../source-adapters.js"),
    WLWCollectorRuntime: { start: (adapter) => { capturedAdapter = adapter; } },
    WLWSourceActionRuntime: { start() {} },
    document: { body: { innerText: "稍后再看 · 405" }, querySelectorAll: () => [] },
    fetch: async () => { throw new TypeError("Failed to fetch"); },
    chrome: {
      runtime: {
        sendMessage: async (message) => {
          assert.equal(message.type, "FETCH_BILI_WATCH_LATER");
          return { ok: true, items, expectedCount: 405 };
        }
      }
    }
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "bilibili-content.js"), "utf8"), context);

  const snapshot = await capturedAdapter.fetchAll();

  assert.equal(snapshot.expectedCount, 405);
  assert.equal(snapshot.items.length, 405);
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

test("Bilibili removal follows the official grid delete control on the exact video wrapper", async () => {
  const videoId = "BV1Direct123";
  let present = true;
  let capturedAdapter;
  let directClicks = 0;
  const directAction = {
    getAttribute: (name) => name === "class" ? "video-card__delete" : "",
    click() { directClicks += 1; present = false; }
  };
  const anchor = {
    href: `https://www.bilibili.com/list/watchlater/?bvid=${videoId}`,
    parentElement: null,
    closest: () => null
  };
  const innerCard = {
    innerText: "目标视频标题 作者 12:34",
    parentElement: null,
    scrollIntoView() {},
    querySelectorAll: () => [anchor]
  };
  const card = {
    className: "video-card video-card--grid",
    innerText: "目标视频标题 作者 12:34",
    parentElement: null,
    scrollIntoView() {},
    getAttribute: (name) => name === "class" ? "video-card video-card--grid" : "",
    querySelectorAll: (selector) => selector.includes("video-card__delete") ? [directAction] : [anchor]
  };
  const body = {
    innerText: `稍后再看 · 405 ${"x".repeat(1200)}`,
    parentElement: null,
    querySelectorAll: () => present ? [anchor] : []
  };
  const wrappers = Array.from({ length: 10 }, () => ({
    innerText: "目标视频标题",
    parentElement: null,
    querySelectorAll: () => [anchor]
  }));
  anchor.parentElement = wrappers[0];
  for (let index = 0; index < wrappers.length - 1; index += 1) wrappers[index].parentElement = wrappers[index + 1];
  wrappers.at(-1).parentElement = innerCard;
  innerCard.parentElement = card;
  anchor.closest = (selector) => selector === ".bili-video-card" ? innerCard : selector === ".video-card" ? card : null;
  card.parentElement = body;
  const document = {
    body,
    documentElement: { scrollHeight: 1000 },
    querySelectorAll: () => present ? [anchor] : []
  };
  const context = {
    WLWCollectors: Collectors,
    WLWSourceAdapters: require("../source-adapters.js"),
    WLWCollectorRuntime: { start: (adapter) => { capturedAdapter = adapter; } },
    WLWSourceActionRuntime: { start() {} },
    document,
    window: { scrollY: 0, innerHeight: 1000, scrollTo() {} },
    chrome: { runtime: { sendMessage: async () => ({ ok: false }) } },
    fetch: async () => { throw new Error("unused"); }
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "bilibili-content.js"), "utf8"), context);

  const result = await capturedAdapter.removeVideo(videoId);

  assert.equal(result.removed, true);
  assert.equal(directClicks, 1);
});
