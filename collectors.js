(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WLWCollectors = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const BILIBILI_LINK_SELECTOR = 'a[href*="/video/" i], a[href*="bvid=" i]';

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

  function extractBilibiliVideoId(value) {
    const href = absoluteUrl(value, "https://www.bilibili.com/");
    if (!href) return "";
    try {
      const url = new URL(href);
      const candidate = url.pathname.match(/\/video\/(BV[0-9A-Za-z]+)/i)?.[1] || url.searchParams.get("bvid") || "";
      return /^BV[0-9A-Za-z]+$/i.test(candidate) ? `BV${candidate.slice(2)}` : "";
    } catch {
      return "";
    }
  }

  function normalizeBilibiliCandidate(candidate, now = Date.now()) {
    const href = absoluteUrl(candidate.href, "https://www.bilibili.com/");
    const bvid = extractBilibiliVideoId(href);
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

  function normalizeBilibiliApiResponse(body, now = Date.now()) {
    if (!body || body.code !== 0 || !Array.isArray(body.data?.list)) return [];
    return body.data.list.map((video) => {
      const item = normalizeBilibiliCandidate({
        href: `https://www.bilibili.com/video/${video.bvid || ""}`,
        title: video.title,
        creator: video.owner?.name,
        thumbnailUrl: video.pic,
        nativeCategory: video.tname,
        addedAt: Number(video.add_at || 0) * 1000,
        publishedAt: Number(video.pubdate || 0) * 1000
      }, now);
      if (!item) return null;
      return {
        ...item,
        aid: Number(video.aid || 0) || null,
        durationSeconds: Number(video.duration || 0) || null,
        progressSeconds: Number(video.progress || 0) || null
      };
    }).filter(Boolean);
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

  function validateCompleteSnapshot(items, expectedCount) {
    const expected = Number(expectedCount);
    if (!Number.isInteger(expected) || expected < 0) return null;
    const unique = [...new Map((items || []).filter((item) => item?.id).map((item) => [item.id, item])).values()];
    return unique.length === expected ? unique : null;
  }

  return { BILIBILI_LINK_SELECTOR, clean, parseDuration, parseProgress, absoluteUrl, extractBilibiliVideoId, normalizeBilibiliCandidate, normalizeBilibiliApiResponse, normalizeYouTubeCandidate, validateCompleteSnapshot };
});
