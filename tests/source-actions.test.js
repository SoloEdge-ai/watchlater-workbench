const test = require("node:test");
const assert = require("node:assert/strict");
const Accounts = require("../source-accounts.js");
const { createSourceActionCoordinator } = require("../source-actions.js");

function createHarness({ failPut = false, platform = "youtube", existingTabs = [], onCreate } = {}) {
  const isBilibili = platform === "bilibili";
  const account = isBilibili
    ? { platform, id: "mid:123", name: "Peng", url: "https://space.bilibili.com/123" }
    : { platform, id: "handle:@peng", name: "Peng", url: "https://www.youtube.com/@peng" };
  const videoId = isBilibili ? "BV1test123" : "video123";
  const recordId = `${platform}:${videoId}`;
  const data = {
    wlwSourceBindings: {
      [platform]: account
    }
  };
  const records = new Map([[recordId, {
    id: recordId, platform, videoId, title: "Test video",
    sourceAccountId: account.id, sourceAccountName: account.name, status: "current"
  }]]);
  const storage = {
    get: async (keys) => {
      const names = Array.isArray(keys) ? keys : [keys];
      return Object.fromEntries(names.filter((key) => Object.hasOwn(data, key)).map((key) => [key, data[key]]));
    },
    set: async (patch) => Object.assign(data, patch),
    remove: async (keys) => { for (const key of Array.isArray(keys) ? keys : [keys]) delete data[key]; }
  };
  let shouldFailPut = failPut;
  const db = {
    getVideo: async (id) => records.get(id) || null,
    putVideos: async (items) => {
      if (shouldFailPut) throw new Error("database unavailable");
      for (const item of items) records.set(item.id, item);
    }
  };
  const createdTabs = [];
  const removedTabs = [];
  const tabs = {
    query: async () => existingTabs,
    create: async (details) => {
      const tab = { id: 22 + createdTabs.length, windowId: 3, ...details };
      createdTabs.push(tab);
      if (onCreate) await onCreate(tab);
      return tab;
    },
    remove: async (tabId) => { removedTabs.push(tabId); },
    update: async () => {},
    reload: async () => {}
  };
  let clock = 1000;
  const coordinator = createSourceActionCoordinator({ storage, db, tabs, windows: { update: async () => {} }, Accounts, now: () => clock, uuid: () => "action" });
  return {
    coordinator, data, records, account, platform, videoId, recordId, createdTabs, removedTabs,
    setFailPut: (value) => { shouldFailPut = value; },
    setNow: (value) => { clock = value; }
  };
}

test("recovery messages during Bilibili tab startup do not open a second tab", async () => {
  let harness;
  let reentered = false;
  harness = createHarness({
    platform: "bilibili",
    onCreate: async () => {
      if (reentered) return;
      reentered = true;
      await harness.coordinator.reconcile();
    }
  });

  await harness.coordinator.start(harness.recordId);

  assert.equal(harness.createdTabs.length, 1);
});

test("one Bilibili removal opens at most one action tab", async () => {
  const harness = createHarness({ platform: "bilibili" });

  const first = harness.coordinator.start(harness.recordId);
  const second = harness.coordinator.start(harness.recordId);
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(harness.createdTabs.length, 1);
  assert.equal(firstResult.action.id, secondResult.action.id);
});

test("a newly-created action tab closes after success", async () => {
  const harness = createHarness({ platform: "bilibili" });
  const started = await harness.coordinator.start(harness.recordId);
  const tabId = started.action.tabId;
  const claimed = await harness.coordinator.claim(harness.platform, harness.account, tabId);

  await harness.coordinator.complete(harness.platform, claimed.action.id, tabId);

  assert.deepEqual(harness.removedTabs, [tabId]);
});

test("a reused user tab stays open after success", async () => {
  const existingTab = { id: 41, windowId: 7, url: "https://www.bilibili.com/watchlater/list#/list" };
  const harness = createHarness({ platform: "bilibili", existingTabs: [existingTab] });
  const started = await harness.coordinator.start(harness.recordId);
  const claimed = await harness.coordinator.claim(harness.platform, harness.account, started.action.tabId);

  await harness.coordinator.complete(harness.platform, claimed.action.id, started.action.tabId);

  assert.deepEqual(harness.removedTabs, []);
});

test("platform removal archives locally only after the matching account reports success", async () => {
  const harness = createHarness();
  const started = await harness.coordinator.start("youtube:video123");
  assert.equal(started.action.state, "opening");
  assert.equal(harness.records.get("youtube:video123").status, "current");

  const claimed = await harness.coordinator.claim("youtube", { id: "handle:@peng", name: "Peng" }, 22);
  assert.equal(claimed.action.videoId, "video123");
  assert.equal(harness.records.get("youtube:video123").status, "current");

  await harness.coordinator.complete("youtube", claimed.action.id, 22);
  const record = harness.records.get("youtube:video123");
  assert.equal(record.status, "archived");
  assert.equal(record.manualArchived, true);
  assert.equal(record.sourceRemovalState, "complete");
  assert.equal(record.sourceRemovedAt, 1000);
});

test("account mismatch fails safely before a page adapter can remove anything", async () => {
  const harness = createHarness();
  await harness.coordinator.start("youtube:video123");

  await assert.rejects(
    harness.coordinator.claim("youtube", { id: "handle:@other", name: "Other" }, 22),
    /目标账号 Peng 不一致/
  );

  const record = harness.records.get("youtube:video123");
  assert.equal(record.status, "current");
  assert.equal(record.sourceRemovalState, "failed");
  assert.equal(harness.data.wlwSourceActionStatus.youtube.state, "failed");
});

test("platform success survives a local database failure and reconciles without another page action", async () => {
  const harness = createHarness();
  await harness.coordinator.start("youtube:video123");
  const claimed = await harness.coordinator.claim("youtube", { id: "handle:@peng", name: "Peng" }, 22);
  harness.setFailPut(true);

  await assert.rejects(harness.coordinator.complete("youtube", claimed.action.id, 22), /database unavailable/);
  assert.equal(harness.data.wlwPendingSourceAction_youtube.state, "platform_succeeded");
  assert.match(harness.data.wlwPendingSourceAction_youtube.error, /本地归档待恢复/);
  assert.equal(harness.records.get("youtube:video123").status, "current");

  harness.setFailPut(false);
  await harness.coordinator.reconcile();
  assert.equal(harness.records.get("youtube:video123").status, "archived");
  assert.equal(harness.data.wlwPendingSourceAction_youtube, undefined);
  assert.equal((await harness.coordinator.claim("youtube", { id: "handle:@peng", name: "Peng" }, 22)).action, null);
});

test("expired actions and closed action tabs fail without archiving the video", async () => {
  const expired = createHarness();
  await expired.coordinator.start("youtube:video123");
  expired.setNow(1000 + 5 * 60 * 1000 + 1);
  await assert.rejects(expired.coordinator.claim("youtube", { id: "handle:@peng", name: "Peng" }, 22), /超时/);
  assert.equal(expired.records.get("youtube:video123").status, "current");
  assert.equal(expired.records.get("youtube:video123").sourceRemovalState, "failed");

  const closed = createHarness();
  await closed.coordinator.start("youtube:video123");
  await closed.coordinator.handleTabRemoved(22);
  assert.equal(closed.records.get("youtube:video123").status, "current");
  assert.match(closed.records.get("youtube:video123").sourceRemovalError, /页面已关闭/);
});

test("restart recovery re-drives an unfinished removal and marks missing targets as recoverable", async () => {
  const harness = createHarness();
  await harness.coordinator.start("youtube:video123");
  await harness.coordinator.claim("youtube", { id: "handle:@peng", name: "Peng" }, 22);
  harness.setNow(32000);

  await harness.coordinator.reconcile({ force: true });
  assert.equal(harness.data.wlwPendingSourceAction_youtube.state, "opening");
  assert.equal(harness.data.wlwPendingSourceAction_youtube.recovering, true);

  const reclaimed = await harness.coordinator.claim("youtube", { id: "handle:@peng", name: "Peng" }, 22);
  assert.equal(reclaimed.action.allowAlreadyMissing, true);
});

test("a local write failure during action creation clears the pending lock and exposes retry status", async () => {
  const harness = createHarness({ failPut: true });
  await assert.rejects(harness.coordinator.start("youtube:video123"), /database unavailable/);
  assert.equal(harness.data.wlwPendingSourceAction_youtube, undefined);
  assert.equal(harness.data.wlwSourceActionStatus.youtube.state, "failed");
  assert.match(harness.data.wlwSourceActionStatus.youtube.error, /database unavailable/);
});
