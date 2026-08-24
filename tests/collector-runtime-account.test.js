const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Collectors = require("../src/shared/collectors.js");

test("collector waits for the X account control before claiming a pending sync", async () => {
  let accountReadyChecks = 0;
  const messages = [];
  const document = {
    documentElement: {},
    querySelector(selector) {
      if (selector === "main") return {};
      if (selector.includes("SideNav_AccountSwitcher_Button")) {
        accountReadyChecks += 1;
        return accountReadyChecks >= 2 ? {} : null;
      }
      return null;
    }
  };
  class MutationObserver {
    constructor(callback) { this.callback = callback; }
    observe() { this.callback(); }
    disconnect() {}
  }
  const context = {
    console,
    document,
    MutationObserver,
    setTimeout: () => 1,
    clearTimeout: () => {},
    confirm: () => false,
    WLWCollectors: Collectors,
    chrome: {
      runtime: {
        sendMessage: async (message) => {
          messages.push(message);
          if (message.type === "GET_PENDING_SYNC") {
            return message.account?.id
              ? { ok: true, pending: null, allowIncremental: false }
              : { ok: false, error: "无法识别当前平台账号" };
          }
          return { ok: true };
        }
      }
    }
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "src", "content", "collector-runtime.js"), "utf8"), context);

  const account = { id: "handle:@fridenzhang", name: "Friden" };
  await context.WLWCollectorRuntime.start({
    platform: "x",
    label: "X 收藏",
    readySelector: "main",
    accountReadySelector: '[data-testid="SideNav_AccountSwitcher_Button"]',
    identifyAccount: async () => accountReadyChecks >= 2 ? account : null,
    scan: () => []
  });

  assert.equal(messages[0].type, "GET_PENDING_SYNC");
  assert.equal(messages[0].account.id, account.id);
});
