const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../core.js");

test("priority score follows the documented worked example", () => {
  const now = Date.parse("2026-08-21T00:00:00Z");
  const score = core.computePriorityScore({ rating: 5, category: "AI / 机器学习", addedAt: Date.parse("2026-08-18T00:00:00Z"), durationSeconds: 18 * 60, progressSeconds: 9 * 60 }, { "AI / 机器学习": 2 }, now);
  assert.equal(score, 100);
});

test("missing scoring fields stay neutral", () => {
  assert.equal(core.computePriorityScore({}, {}, Date.parse("2026-08-21T00:00:00Z")), 50);
});

test("effective category honors manual, AI, rule, then native precedence", () => {
  const rules = [{ name: "Linux / 操作系统", keywords: ["linux", "内核"], weight: 1 }];
  const base = { title: "Linux 内核导读", creator: "作者", nativeCategory: "科技" };
  assert.equal(core.classifyVideo(base, rules).category, "Linux / 操作系统");
  assert.equal(core.classifyVideo({ ...base, aiCategory: "AI / 机器学习" }, rules).category, "AI / 机器学习");
  assert.equal(core.classifyVideo({ ...base, aiCategory: "AI / 机器学习", manualCategory: "学习 / 知识管理" }, rules).category, "学习 / 知识管理");
});

test("source refresh preserves user metadata and AI classification", () => {
  const existing = { id: "bilibili:BV123", platform: "bilibili", videoId: "BV123", title: "旧标题", rating: 5, manualCategory: "学习 / 知识管理", manualTags: ["必看"], aiCategory: "AI / 机器学习", aiTags: ["大模型"], firstSeenAt: 100, status: "archived" };
  const refreshed = core.mergeVideoRecord(existing, { id: "bilibili:BV123", platform: "bilibili", videoId: "BV123", title: "新标题", creator: "作者", lastSeenAt: 300 }, 300);
  assert.equal(refreshed.title, "新标题"); assert.equal(refreshed.rating, 5); assert.equal(refreshed.manualCategory, "学习 / 知识管理"); assert.deepEqual(refreshed.manualTags, ["必看"]); assert.equal(refreshed.aiCategory, "AI / 机器学习"); assert.equal(refreshed.firstSeenAt, 100); assert.equal(refreshed.status, "current");
});

test("serial queue prevents later writes from overtaking earlier writes", async () => {
  const queue = core.createSerialQueue();
  const order = [];
  const first = queue(async () => { await new Promise((resolve) => setTimeout(resolve, 15)); order.push("first"); });
  const second = queue(async () => { order.push("second"); });
  await Promise.all([first, second]);
  assert.deepEqual(order, ["first", "second"]);
});

test("one thousand cached records can be classified and sorted within one second", () => {
  const now = Date.parse("2026-08-21T00:00:00Z");
  const started = performance.now();
  const items = Array.from({ length: 1000 }, (_, index) => core.enrichVideo({
    id: `youtube:video-${index}`, platform: "youtube", videoId: `video-${index}`,
    title: index % 2 ? "Linux systems lecture" : "AI agent tutorial", creator: "Channel",
    durationSeconds: (index % 130 + 1) * 60, firstSeenAt: now - index * 60000, status: "current"
  }, core.DEFAULT_RULES, now));
  items.sort((a, b) => b.priorityScore - a.priorityScore);
  assert.equal(items.length, 1000);
  assert.ok(performance.now() - started < 1000);
});

test("AI response parser rejects malformed JSON and unknown categories", () => {
  assert.throws(() => core.parseAiClassificationResponse("not json", ["AI / 机器学习"]));
  const result = core.parseAiClassificationResponse(JSON.stringify({ items: [
    { id: "youtube:1", primaryCategory: "AI / 机器学习", tags: ["LLM"], confidence: 0.9 },
    { id: "youtube:2", primaryCategory: "未知分类", tags: [] }
  ] }), ["AI / 机器学习"]);
  assert.equal(result.length, 1);
  assert.equal(result[0].id, "youtube:1");
});
