const test = require("node:test");
const assert = require("node:assert/strict");
const Accounts = require("../source-accounts.js");

test("source accounts use stable platform identifiers rather than display names", () => {
  assert.deepEqual(
    Accounts.normalizeAccount("bilibili", { id: "mid:12345", name: "张三", url: "https://space.bilibili.com/12345" }),
    { platform: "bilibili", id: "mid:12345", name: "张三", url: "https://space.bilibili.com/12345" }
  );
  assert.deepEqual(
    Accounts.normalizeAccount("youtube", { id: "channel:UCabc_123", name: "Peng Zhang", url: "https://www.youtube.com/channel/UCabc_123" }),
    { platform: "youtube", id: "channel:UCabc_123", name: "Peng Zhang", url: "https://www.youtube.com/channel/UCabc_123" }
  );
  assert.equal(Accounts.normalizeAccount("youtube", { id: "", name: "Peng Zhang" }), null);
});

test("YouTube handles compare case-insensitively while different accounts never match", () => {
  const first = Accounts.normalizeAccount("youtube", { id: "handle:@PengZhang", name: "Peng Zhang" });
  const same = Accounts.normalizeAccount("youtube", { id: "handle:@pengzhang", name: "Renamed" });
  const other = Accounts.normalizeAccount("youtube", { id: "handle:@other", name: "Peng Zhang" });
  assert.equal(first.id, "handle:@pengzhang");
  assert.equal(Accounts.accountsMatch(first, same), true);
  assert.equal(Accounts.accountsMatch(first, other), false);
  assert.equal(Accounts.accountsMatch(first, { ...first, platform: "bilibili" }), false);
});
