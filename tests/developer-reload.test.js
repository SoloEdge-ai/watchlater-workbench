const test = require("node:test");
const assert = require("node:assert/strict");

test("background reload requires developer mode and a trusted extension page", async () => {
  let enabled = false;
  let reloads = 0;
  global.WLWCore = require("../core.js");
  global.WLWDatabase = {};
  global.WLWCollectors = {};
  global.chrome = {
    runtime: { getURL: (path = "") => `chrome-extension://test/${path}`, reload: () => { reloads += 1; } },
    storage: { local: { get: async () => ({ wlwDeveloperMode: enabled }) } }
  };
  delete require.cache[require.resolve("../service.js")];
  require("../service.js");
  const sender = { url: "chrome-extension://test/newtab.html" };

  await assert.rejects(() => global.WLWService.scheduleExtensionReload(sender), /启用开发模式/);
  await assert.rejects(() => global.WLWService.scheduleExtensionReload({ url: "https://example.com/" }), /扩展页面/);
  enabled = true;
  assert.deepEqual(await global.WLWService.scheduleExtensionReload(sender), { reloading: true });
  await new Promise((resolve) => setTimeout(resolve, 220));
  assert.equal(reloads, 1);
});
