const test = require("node:test");
const assert = require("node:assert/strict");
const Runtime = require("../src/content/source-action-runtime.js");

test("page action removes only after the background claims the matching account", async () => {
  const messages = [];
  let removed = "";
  const adapter = {
    platform: "youtube",
    label: "YouTube 稍后观看",
    identifyAccount: async () => ({ id: "handle:@peng", name: "Peng" }),
    removeVideo: async (videoId) => { removed = videoId; }
  };
  const result = await Runtime.run(adapter, {
    send: async (message) => {
      messages.push(message);
      if (message.type === "CLAIM_SOURCE_ACTION") {
        return { ok: true, action: { id: "youtube:1", videoId: "video123" } };
      }
      return { ok: true };
    },
    overlay: { update() {}, remove() {} }
  });

  assert.equal(result.completed, true);
  assert.equal(removed, "video123");
  assert.deepEqual(messages.map((message) => message.type), ["CLAIM_SOURCE_ACTION", "SOURCE_ACTION_COMPLETE"]);
});

test("a rejected account claim never invokes the page removal adapter", async () => {
  let removeCalls = 0;
  const result = await Runtime.run({
    platform: "bilibili",
    label: "B站稍后再看",
    identifyAccount: async () => ({ id: "mid:2", name: "Other" }),
    removeVideo: async () => { removeCalls += 1; }
  }, {
    send: async () => ({ ok: false, error: "当前账号与目标账号不一致" }),
    overlay: { update() {}, remove() {} }
  });

  assert.equal(result.completed, false);
  assert.equal(removeCalls, 0);
});

test("a page failure is reported without claiming platform success", async () => {
  const messages = [];
  const result = await Runtime.run({
    platform: "youtube",
    label: "YouTube 稍后观看",
    identifyAccount: async () => ({ id: "handle:@peng", name: "Peng" }),
    removeVideo: async () => { throw new Error("未找到精确删除菜单"); }
  }, {
    send: async (message) => {
      messages.push(message);
      return message.type === "CLAIM_SOURCE_ACTION"
        ? { ok: true, action: { id: "youtube:1", videoId: "video123" } }
        : { ok: true };
    },
    overlay: { update() {}, remove() {} }
  });

  assert.equal(result.completed, false);
  assert.deepEqual(messages.map((message) => message.type), ["CLAIM_SOURCE_ACTION", "SOURCE_ACTION_FAILED"]);
});

test("visiting a platform page without a pending action stays silent", async () => {
  const result = await Runtime.run({
    platform: "youtube",
    label: "YouTube 稍后观看",
    identifyAccount: async () => ({ id: "handle:@peng", name: "Peng" }),
    removeVideo: async () => { throw new Error("must not run"); }
  }, { send: async () => ({ ok: true, action: null }) });
  assert.equal(result.idle, true);
});

test("page runtime dispatches an X restore through the generic action interface", async () => {
  let performed = "";
  const action = { id: "x:action", operation: "restore", sourceItemId: "209", title: "Post" };
  const result = await Runtime.run({
    platform: "x",
    label: "X 收藏",
    identifyAccount: async () => ({ id: "handle:@peng", name: "Peng" }),
    performAction: async (claimed) => { performed = claimed.operation; }
  }, {
    overlay: { update() {}, remove() {} },
    send: async (message) => {
      if (message.type === "CLAIM_SOURCE_ACTION") return { ok: true, action };
      if (message.type === "SOURCE_ACTION_COMPLETE") return { ok: true };
      throw new Error(`unexpected ${message.type}`);
    }
  });

  assert.equal(result.completed, true);
  assert.equal(performed, "restore");
});

test("restart recovery passes the already-missing allowance to the adapter", async () => {
  let options;
  const result = await Runtime.run({
    platform: "youtube",
    label: "YouTube 稍后观看",
    identifyAccount: async () => ({ id: "handle:@peng", name: "Peng" }),
    removeVideo: async (_videoId, value) => { options = value; }
  }, {
    send: async (message) => message.type === "CLAIM_SOURCE_ACTION"
      ? { ok: true, action: { id: "youtube:1", videoId: "video123", allowAlreadyMissing: true } }
      : { ok: true },
    overlay: { update() {}, remove() {} }
  });
  assert.equal(result.completed, true);
  assert.equal(options.allowAlreadyMissing, true);
});
