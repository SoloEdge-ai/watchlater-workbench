const test = require("node:test");
const assert = require("node:assert/strict");
const collectors = require("../collectors.js");

test("Bilibili candidate becomes a normalized platform record", () => {
  const item = collectors.normalizeBilibiliCandidate({ href: "https://www.bilibili.com/video/BV1ABC123?p=1", title: "Linux 内核导读", creator: "系统作者", durationText: "01:02:03", progressText: "12:30/01:02:03", thumbnailUrl: "//i0.hdslb.com/example.jpg", nativeCategory: "计算机技术" }, 1000);
  assert.deepEqual({ id: item.id, platform: item.platform, videoId: item.videoId }, { id: "bilibili:BV1ABC123", platform: "bilibili", videoId: "BV1ABC123" });
  assert.equal(item.kind, "video"); assert.equal(item.sourceItemId, "BV1ABC123");
  assert.equal(item.durationSeconds, 3723); assert.equal(item.progressSeconds, 750); assert.equal(item.thumbnailUrl, "https://i0.hdslb.com/example.jpg");
  assert.equal(item.nativeCategory, "计算机技术");
});

test("Bilibili API thumbnails are upgraded to HTTPS for the extension image CSP", () => {
  const [item] = collectors.normalizeBilibiliApiResponse({
    code: 0,
    data: {
      count: 1,
      list: [{
        bvid: "BV1ABC123",
        title: "Linux 内核导读",
        owner: { name: "系统作者" },
        duration: 120,
        pic: "http://i0.hdslb.com/bfs/archive/example.jpg"
      }]
    }
  }, 1000);

  assert.equal(item.thumbnailUrl, "https://i0.hdslb.com/bfs/archive/example.jpg");
});

test("YouTube candidate strips playlist tracking and normalizes duration", () => {
  const item = collectors.normalizeYouTubeCandidate({ href: "https://www.youtube.com/watch?v=abc_DEF-12&list=WL&index=4", title: "A useful systems talk", creator: "Systems Channel", durationText: "24:10", thumbnailUrl: "https://i.ytimg.com/vi/abc_DEF-12/hqdefault.jpg" }, 2000);
  assert.equal(item.id, "youtube:abc_DEF-12"); assert.equal(item.url, "https://www.youtube.com/watch?v=abc_DEF-12"); assert.equal(item.durationSeconds, 1450);
  assert.equal(item.kind, "video"); assert.equal(item.sourceItemId, "abc_DEF-12");
});

test("invalid candidates are rejected", () => {
  assert.equal(collectors.normalizeBilibiliCandidate({ href: "https://example.com", title: "x" }), null);
  assert.equal(collectors.normalizeYouTubeCandidate({ href: "https://www.youtube.com/watch", title: "missing id" }), null);
});

test("Bilibili API response preserves all 402 watch-later records", () => {
  const list = Array.from({ length: 402 }, (_, index) => ({
    aid: 1000 + index, bvid: `BV${String(index).padStart(10, "0")}`,
    title: `视频 ${index + 1}`, owner: { name: `UP ${index + 1}` },
    duration: 60 + index, progress: index % 30, add_at: 1700000000 + index,
    pubdate: 1600000000 + index, tname: "计算机技术", pic: `https://i0.hdslb.com/${index}.jpg`
  }));
  const items = collectors.normalizeBilibiliApiResponse({ code: 0, data: { count: 402, list } }, 2000);
  assert.equal(items.length, 402);
  assert.equal(items[0].aid, 1000);
  assert.equal(items[401].id, "bilibili:BV0000000401");
});

test("complete snapshot validation rejects missing counts and duplicate IDs", () => {
  const items = [{ id: "bilibili:BV1" }, { id: "bilibili:BV1" }];
  assert.equal(collectors.validateCompleteSnapshot(items, undefined), null);
  assert.equal(collectors.validateCompleteSnapshot(items, 2), null);
  assert.deepEqual(collectors.validateCompleteSnapshot(items, 1), [{ id: "bilibili:BV1" }]);
  assert.deepEqual(collectors.validateCompleteSnapshot([], 0), []);
});

test("explicitly completed virtual snapshots can omit a platform count but not completion proof", () => {
  const items = [{ id: "x:111" }, { id: "x:222" }];
  assert.deepEqual(collectors.validateSourceSnapshot({ items, complete: true }), items);
  assert.equal(collectors.validateSourceSnapshot({ items, complete: false }), null);
  assert.equal(collectors.validateSourceSnapshot({ items: [], complete: true }), null);
  assert.deepEqual(collectors.validateSourceSnapshot({ items: [], complete: true, allowEmpty: true }), []);
});
