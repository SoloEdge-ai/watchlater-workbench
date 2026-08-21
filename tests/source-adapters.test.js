const test = require("node:test");
const assert = require("node:assert/strict");
const Adapters = require("../source-adapters.js");

test("YouTube account identity prefers a stable channel id and falls back to a handle", () => {
  const channel = { href: "https://www.youtube.com/channel/UCabc_123", textContent: "Peng Zhang" };
  const channelDocument = { querySelector: () => channel };
  assert.deepEqual(Adapters.identifyYouTubeAccount(channelDocument), {
    id: "channel:UCabc_123",
    name: "Peng Zhang",
    url: "https://www.youtube.com/channel/UCabc_123"
  });

  const handle = { href: "https://www.youtube.com/@Peng.Zhang", textContent: "Peng Zhang" };
  assert.equal(Adapters.identifyYouTubeAccount({ querySelector: () => handle }).id, "handle:@peng.zhang");
  assert.equal(Adapters.identifyYouTubeAccount({ querySelector: () => ({ href: "", textContent: "Peng Zhang" }) }), null);
});

test("Bilibili account identity requires authenticated nav data", () => {
  assert.deepEqual(Adapters.identifyBilibiliAccount({ code: 0, data: { isLogin: true, mid: 12345, uname: "张三" } }), {
    id: "mid:12345",
    name: "张三",
    url: "https://space.bilibili.com/12345"
  });
  assert.equal(Adapters.identifyBilibiliAccount({ code: 0, data: { isLogin: false } }), null);
});

test("removal labels are explicit and localized rather than fuzzy", () => {
  assert.equal(Adapters.isRemovalLabel("youtube", "Remove from Watch later"), true);
  assert.equal(Adapters.isRemovalLabel("youtube", "从“稍后观看”中移除"), true);
  assert.equal(Adapters.isRemovalLabel("youtube", "[後で見る] から削除"), true);
  assert.equal(Adapters.isRemovalLabel("bilibili", "从稍后再看中移除"), true);
  assert.equal(Adapters.isRemovalLabel("bilibili", "Remove from Watch later"), true);
  assert.equal(Adapters.isRemovalLabel("bilibili", "「後で見る」から削除"), true);
  assert.equal(Adapters.isRemovalLabel("bilibili", "移除"), false);
  assert.equal(Adapters.isRemovalLabel("youtube", "Delete playlist"), false);
  assert.equal(Adapters.isRemovalLabel("bilibili", "删除全部"), false);
});

test("shared removal workflow clicks only a known menu path and confirms disappearance", async () => {
  let present = true;
  let buttonClicks = 0;
  let menuClicks = 0;
  const card = { scrollIntoView() {} };
  const result = await Adapters.removeUsingMenu({
    locateCard: async () => card,
    findMenuButton: () => ({ click() { buttonClicks += 1; } }),
    findMenuItem: () => ({ click() { menuClicks += 1; present = false; } }),
    isPresent: () => present,
    platformLabel: "测试平台"
  });
  assert.equal(result.removed, true);
  assert.equal(buttonClicks, 1);
  assert.equal(menuClicks, 1);

  await assert.rejects(Adapters.removeUsingMenu({
    locateCard: async () => card,
    findMenuButton: () => null,
    findMenuItem: () => null,
    isPresent: () => true,
    platformLabel: "测试平台"
  }), /操作菜单/);
});

test("restart recovery can converge when the exact video is already absent", async () => {
  const result = await Adapters.removeUsingMenu({
    locateCard: async () => null,
    findMenuButton: () => { throw new Error("must not click"); },
    findMenuItem: () => { throw new Error("must not click"); },
    isPresent: () => false,
    platformLabel: "测试平台",
    allowAlreadyMissing: true
  });
  assert.equal(result.alreadyMissing, true);
});

test("video cards and removal menu items are selected by exact ids and labels", () => {
  const wantedLink = { href: "https://www.youtube.com/watch?v=wanted123&list=WL" };
  const otherLink = { href: "https://www.youtube.com/watch?v=other456&list=WL" };
  const wantedCard = { querySelector: () => wantedLink };
  const otherCard = { querySelector: () => otherLink };
  const menuItems = [
    { textContent: "Delete playlist" },
    { textContent: "Remove from Watch later" }
  ];
  const document = {
    querySelectorAll: (selector) => selector.includes("playlist-video") ? [otherCard, wantedCard] : menuItems
  };

  assert.equal(Adapters.findYouTubeCard(document, "wanted123"), wantedCard);
  assert.equal(Adapters.findYouTubeCard(document, "missing"), null);
  assert.equal(Adapters.findRemovalMenuItem(document, "youtube"), menuItems[1]);
});

test("Bilibili menu buttons require known semantics rather than fuzzy class names", () => {
  const fuzzy = { getAttribute: (name) => name === "class" ? "more-random" : "" };
  const unknownMenu = { getAttribute: (name) => name === "aria-haspopup" ? "menu" : name === "aria-label" ? "未知操作" : "" };
  const exact = { getAttribute: (name) => name === "aria-label" ? "更多操作" : "" };
  const card = { querySelectorAll: () => [fuzzy, unknownMenu, exact] };
  assert.equal(Adapters.findPlatformMenuButton(card, "bilibili"), exact);
  assert.equal(Adapters.findPlatformMenuButton({ querySelectorAll: () => [fuzzy, unknownMenu] }, "bilibili"), null);
});

test("Bilibili menu button recognizes the current official card dropdown component", () => {
  const dropdown = {
    getAttribute: (name) => name === "class" ? "bili-card-dropdown" : ""
  };
  const card = { querySelectorAll: () => [dropdown] };

  assert.equal(Adapters.findPlatformMenuButton(card, "bilibili"), dropdown);
});

test("Bilibili removal item recognizes the current official dropdown popper component", () => {
  const item = { textContent: "移出稍后再看", closest: () => null };
  const document = {
    querySelectorAll: (selector) => selector.includes(".bili-card-dropdown-popper__item") ? [item] : []
  };

  assert.equal(Adapters.findRemovalMenuItem(document, "bilibili"), item);
});

test("progressive item lookup shares one stable end-of-list policy", async () => {
  let rounds = 0;
  const environment = {
    getHeight: () => 100 + rounds,
    nearBottom: () => true,
    scrollToEnd: () => { rounds += 1; }
  };
  const found = await Adapters.findWhileScrolling(
    () => rounds === 2 ? { id: "target" } : null,
    environment,
    { delay: async () => {}, maxRounds: 5, stableRounds: 2 }
  );
  assert.deepEqual(found, { id: "target" });
});
