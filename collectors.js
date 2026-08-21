(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WLWCollectors = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function parseDuration(value) {
    const text = clean(value).split("/").at(-1);
    if (!/^\d{1,3}:\d{2}(?::\d{2})?$/.test(text)) return null;
    const parts = text.split(":").map(Number);
    return parts.reduce((total, part) => total * 60 + part, 0);
  }

  function parseProgress(value) {
    const text = clean(value);
    if (!text.includes("/")) return null;
    return parseDuration(text.split("/")[0]);
  }

  function absoluteUrl(value, base) {
    if (!value) return "";
    if (value.startsWith("//")) return `https:${value}`;
    try { return new URL(value, base).href; } catch { return ""; }
  }

  function normalizeBilibiliCandidate(candidate, now = Date.now()) {
    const href = absoluteUrl(candidate.href, "https://www.bilibili.com/");
    const bvid = href.match(/\/video\/(BV[0-9A-Za-z]+)/i)?.[1];
    if (!bvid || !clean(candidate.title)) return null;
    return {
      id: `bilibili:${bvid}`,
      platform: "bilibili",
      videoId: bvid,
      url: `https://www.bilibili.com/video/${bvid}`,
      title: clean(candidate.title),
      creator: clean(candidate.creator),
      thumbnailUrl: absoluteUrl(candidate.thumbnailUrl, "https://www.bilibili.com/"),
      durationSeconds: parseDuration(candidate.durationText),
      progressSeconds: parseProgress(candidate.progressText),
      durationText: clean(candidate.durationText),
      nativeCategory: clean(candidate.nativeCategory),
      addedAt: Number(candidate.addedAt || 0) || null,
      publishedAt: Number(candidate.publishedAt || 0) || null,
      firstSeenAt: now,
      lastSeenAt: now,
      status: "current"
    };
  }

  function normalizeYouTubeCandidate(candidate, now = Date.now()) {
    const href = absoluteUrl(candidate.href, "https://www.youtube.com/");
    let videoId = "";
    try { videoId = new URL(href).searchParams.get("v") || ""; } catch {}
    if (!/^[0-9A-Za-z_-]{6,}$/.test(videoId) || !clean(candidate.title)) return null;
    return {
      id: `youtube:${videoId}`,
      platform: "youtube",
      videoId,
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: clean(candidate.title),
      creator: clean(candidate.creator),
      thumbnailUrl: absoluteUrl(candidate.thumbnailUrl, "https://www.youtube.com/"),
      durationSeconds: parseDuration(candidate.durationText),
      progressSeconds: parseProgress(candidate.progressText),
      durationText: clean(candidate.durationText),
      nativeCategory: "",
      addedAt: Number(candidate.addedAt || 0) || null,
      publishedAt: Number(candidate.publishedAt || 0) || null,
      firstSeenAt: now,
      lastSeenAt: now,
      status: "current"
    };
  }

  return { clean, parseDuration, parseProgress, absoluteUrl, normalizeBilibiliCandidate, normalizeYouTubeCandidate };
});
