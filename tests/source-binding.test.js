const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Core = require("../core.js");
const Collectors = require("../collectors.js");
const Accounts = require("../source-accounts.js");
const collectorRuntimeSource = fs.readFileSync(path.join(__dirname, "..", "collector-runtime.js"), "utf8");

function createHarness(initial = {}, items = []) {
  const data = { wlwMigratedV1: true, ...initial };
  const writes = [];
  const deletedPlatforms = [];
  const storage = {
    get: async (keys) => {
      const names = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(names.filter((key) => Object.hasOwn(data, key)).map((key) => [key, data[key]]));
    },
    set: async (patch) => Object.assign(data, patch),
    remove: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
  };
  const context = {
    URL,
    setTimeout,
    clearTimeout,
    crypto: { randomUUID: () => "uuid" },
    WLWCore: Core,
    WLWCollectors: Collectors,
    WLWSourceAccounts: Accounts,
    WLWDatabase: {
      getVideos: async () => [],
      putVideos: async (items) => writes.push(...items),
      getAllVideos: async () => items,
      completeSnapshot: async () => {},
      deletePlatform: async (platform) => { deletedPlatforms.push(platform); }
    },
    chrome: {
      storage: { local: storage },
      runtime: { getURL: (value = "") => `chrome-extension://test/${value}` },
      tabs: {},
      windows: {}
    },
    fetch: async () => { throw new Error("unexpected fetch"); }
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "service.js"), "utf8"), context);
  return { service: context.WLWService, data, writes, deletedPlatforms };
}

test("library filters video and graphic content independently from platform", async () => {
  const contentItems = [
    { id: "bilibili:BV1", platform: "bilibili", kind: "video", status: "current", title: "B站视频" },
    { id: "x:100", platform: "x", kind: "post", status: "current", title: "X 视频", mediaUrls: ["https://pbs.twimg.com/amplify_video_thumb/100/img/cover.jpg"] },
    { id: "x:101", platform: "x", kind: "post", status: "current", title: "X 图文", bodyText: "只有正文" }
  ];
  const harness = createHarness({}, contentItems);

  const videoResult = await harness.service.getLibrary({ status: "current", contentType: "video", limit: 20 });
  assert.deepEqual(videoResult.items.map((item) => item.id), ["bilibili:BV1", "x:100"]);
  assert.ok(videoResult.items.every((item) => item.contentType === "video"));

  const graphicResult = await harness.service.getLibrary({ status: "current", contentType: "post", limit: 20 });
  assert.deepEqual(graphicResult.items.map((item) => item.id), ["x:101"]);
  assert.equal(graphicResult.items[0].contentType, "post");
});

test("first complete sync requires explicit account binding before collection", async () => {
  const pending = { platform: "bilibili", sessionId: "sync-1", createdAt: Date.now(), state: "opening", count: 0 };
  const harness = createHarness({ wlwPendingSync_bilibili: pending });
  const account = { id: "mid:12345", name: "张三", url: "https://space.bilibili.com/12345" };
  const sender = { tab: { id: 7, url: "https://www.bilibili.com/watchlater/list#/list" } };

  const preview = await harness.service.handleMessage({ type: "GET_PENDING_SYNC", platform: "bilibili", account }, sender);
  assert.equal(preview.pending, null);
  assert.equal(preview.requiresBinding, true);
  assert.equal(preview.candidate.id, "mid:12345");

  const claimed = await harness.service.handleMessage({ type: "GET_PENDING_SYNC", platform: "bilibili", account, confirmBinding: true }, sender);
  assert.equal(claimed.requiresBinding, false);
  assert.equal(claimed.pending.account.id, "mid:12345");
  assert.equal(claimed.pending.tabId, 7);
});

test("a first account binding completes its full sync before incremental writes begin", () => {
  const fullSyncIndex = collectorRuntimeSource.indexOf("allowIncremental = await fullSync");
  const incrementalIndex = collectorRuntimeSource.indexOf("await incrementalScan()", fullSyncIndex);
  assert.ok(fullSyncIndex > 0);
  assert.ok(incrementalIndex > fullSyncIndex);
});

test("every source batch re-identifies the current page account", () => {
  const sendBatchesStart = collectorRuntimeSource.indexOf("async function sendBatches");
  const sendBatchesEnd = collectorRuntimeSource.indexOf("function recordChanged", sendBatchesStart);
  const implementation = collectorRuntimeSource.slice(sendBatchesStart, sendBatchesEnd);
  assert.match(implementation, /await identifyCurrentAccount\(adapter\)/);
  assert.doesNotMatch(implementation, /account\s*[,)]\s*\{/);
});

test("incremental collection from a different account is rejected before database writes", async () => {
  const binding = { platform: "youtube", id: "handle:@bound", name: "Bound", url: "https://www.youtube.com/@bound" };
  const harness = createHarness({ wlwSourceBindings: { youtube: binding } });
  const sender = { tab: { id: 8, url: "https://www.youtube.com/playlist?list=WL" } };
  const item = { id: "youtube:video123", platform: "youtube", videoId: "video123", title: "Title" };

  await assert.rejects(
    harness.service.handleMessage({ type: "SOURCE_SYNC_UPSERT", platform: "youtube", sessionId: null, account: { id: "handle:@other", name: "Other" }, items: [item] }, sender),
    /已绑定账号/
  );
  assert.equal(harness.writes.length, 0);
});

test("successful first full sync commits the binding and stamps legacy platform records", async () => {
  const account = { platform: "bilibili", id: "mid:12345", name: "张三", url: "https://space.bilibili.com/12345" };
  const pending = { platform: "bilibili", sessionId: "sync-2", createdAt: Date.now(), state: "collecting", tabId: 9, account };
  const legacy = { id: "bilibili:BVlegacy", platform: "bilibili", videoId: "BVlegacy", title: "旧记录", status: "current" };
  const harness = createHarness({ wlwPendingSync_bilibili: pending }, [legacy]);
  const sender = { tab: { id: 9, url: "https://www.bilibili.com/watchlater/list#/list" } };

  await harness.service.handleMessage({ type: "SOURCE_SYNC_COMPLETE", platform: "bilibili", sessionId: "sync-2", account, seenIds: [legacy.id] }, sender);

  assert.equal(harness.data.wlwSourceBindings.bilibili.id, "mid:12345");
  assert.equal(harness.data.wlwSourceBindings.bilibili.name, "张三");
  assert.equal(harness.writes.at(-1).sourceAccountId, "mid:12345");
  assert.equal(harness.writes.at(-1).sourceAccountName, "张三");
});

test("an explicitly empty X Bookmarks snapshot can safely complete and bind the signed-in handle", async () => {
  const account = { platform: "x", id: "handle:@fridenzhang", name: "Friden", url: "https://x.com/FridenZhang" };
  const pending = { platform: "x", sessionId: "sync-x", createdAt: Date.now(), state: "collecting", tabId: 11, account };
  const harness = createHarness({ wlwPendingSync_x: pending });
  const sender = { tab: { id: 11, url: "https://x.com/i/history" } };

  const result = await harness.service.handleMessage({
    type: "SOURCE_SYNC_COMPLETE",
    platform: "x",
    sessionId: "sync-x",
    account,
    seenIds: [],
    allowEmptySnapshot: true
  }, sender);

  assert.equal(result.completed, true);
  assert.equal(harness.data.wlwSourceBindings.x.id, "handle:@fridenzhang");
});

test("library output upgrades legacy Bilibili thumbnail URLs without requiring a resync", async () => {
  const legacy = {
    id: "bilibili:BVlegacy",
    platform: "bilibili",
    videoId: "BVlegacy",
    title: "旧记录",
    status: "current",
    thumbnailUrl: "http://i0.hdslb.com/bfs/archive/legacy.jpg"
  };
  const harness = createHarness({}, [legacy]);

  const result = await harness.service.handleMessage({ type: "GET_LIBRARY", query: {} }, { url: "chrome-extension://test/newtab.html" });

  assert.equal(result.items[0].thumbnailUrl, "https://i0.hdslb.com/bfs/archive/legacy.jpg");
});

test("source export excludes the AI key and clearing affects only the selected platform", async () => {
  const bindings = {
    bilibili: { id: "mid:12345", name: "张三" },
    youtube: { id: "handle:@peng", name: "Peng" }
  };
  const videos = [
    { id: "bilibili:BV1", platform: "bilibili", videoId: "BV1", title: "B站视频" },
    { id: "youtube:abc", platform: "youtube", videoId: "abc", title: "YouTube 视频" }
  ];
  const harness = createHarness({
    wlwSourceBindings: bindings,
    wlwSyncStatus: { bilibili: { state: "complete" }, youtube: { state: "complete" } },
    wlwSourceActionStatus: { bilibili: { state: "failed" }, youtube: { state: "complete" } },
    wlwAi: { enabled: true, baseUrl: "https://example.com/v1", model: "model", apiKey: "secret-key" }
  }, videos);
  const sender = { url: "chrome-extension://test/options.html" };

  const exported = await harness.service.handleMessage({ type: "EXPORT_SOURCE_LIBRARY", platform: "bilibili" }, sender);
  assert.deepEqual(exported.payload.items.map((item) => item.id), ["bilibili:BV1"]);
  assert.equal(exported.payload.settings.ai.apiKey, "");

  await harness.service.handleMessage({ type: "CLEAR_SOURCE_BINDING", platform: "bilibili", expectedAccountId: "mid:12345" }, sender);
  assert.deepEqual(harness.deletedPlatforms, ["bilibili"]);
  assert.equal(harness.data.wlwSourceBindings.bilibili, undefined);
  assert.equal(harness.data.wlwSourceBindings.youtube.id, "handle:@peng");
  assert.equal(harness.data.wlwSyncStatus.bilibili, undefined);
  assert.equal(harness.data.wlwSyncStatus.youtube.state, "complete");
  assert.equal(harness.data.wlwSourceActionStatus.bilibili, undefined);
  assert.equal(harness.data.wlwSourceActionStatus.youtube.state, "complete");
});

test("account clearing refuses to race an active full sync", async () => {
  const harness = createHarness({
    wlwSourceBindings: { youtube: { id: "handle:@peng", name: "Peng", platform: "youtube" } },
    wlwPendingSync_youtube: { sessionId: "sync-active", state: "collecting", tabId: 8 }
  }, [{ id: "youtube:abc", platform: "youtube", videoId: "abc" }]);
  const sender = { url: "chrome-extension://test/options.html" };

  await assert.rejects(
    harness.service.handleMessage({ type: "CLEAR_SOURCE_BINDING", platform: "youtube", expectedAccountId: "handle:@peng" }, sender),
    /完整同步正在进行/
  );
  assert.deepEqual(harness.deletedPlatforms, []);
  assert.equal(harness.data.wlwSourceBindings.youtube.id, "handle:@peng");
});
