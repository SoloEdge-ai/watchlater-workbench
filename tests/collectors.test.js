const test = require("node:test");
const assert = require("node:assert/strict");
const collectors = require("../collectors.js");

test("Bilibili candidate becomes a normalized platform record", () => {
  const item = collectors.normalizeBilibiliCandidate({ href: "https://www.bilibili.com/video/BV1ABC123?p=1", title: "Linux 内核导读", creator: "系统作者", durationText: "01:02:03", progressText: "12:30/01:02:03", thumbnailUrl: "//i0.hdslb.com/example.jpg", nativeCategory: "计算机技术" }, 1000);
  assert.deepEqual({ id: item.id, platform: item.platform, videoId: item.videoId }, { id: "bilibili:BV1ABC123", platform: "bilibili", videoId: "BV1ABC123" });
  assert.equal(item.durationSeconds, 3723); assert.equal(item.progressSeconds, 750); assert.equal(item.thumbnailUrl, "https://i0.hdslb.com/example.jpg");
  assert.equal(item.nativeCategory, "计算机技术");
});

test("YouTube candidate strips playlist tracking and normalizes duration", () => {
  const item = collectors.normalizeYouTubeCandidate({ href: "https://www.youtube.com/watch?v=abc_DEF-12&list=WL&index=4", title: "A useful systems talk", creator: "Systems Channel", durationText: "24:10", thumbnailUrl: "https://i.ytimg.com/vi/abc_DEF-12/hqdefault.jpg" }, 2000);
  assert.equal(item.id, "youtube:abc_DEF-12"); assert.equal(item.url, "https://www.youtube.com/watch?v=abc_DEF-12"); assert.equal(item.durationSeconds, 1450);
});

test("invalid candidates are rejected", () => {
  assert.equal(collectors.normalizeBilibiliCandidate({ href: "https://example.com", title: "x" }), null);
  assert.equal(collectors.normalizeYouTubeCandidate({ href: "https://www.youtube.com/watch", title: "missing id" }), null);
});
