(function () {
  "use strict";
  const C = WLWCollectors;

  function scan() {
    const result = new Map();
    const anchors = [...document.querySelectorAll('a[href*="/video/BV"]')];
    for (const anchor of anchors) {
      const bvid = anchor.href.match(/\/video\/(BV[0-9A-Za-z]+)/i)?.[1];
      if (!bvid) continue;
      const card = findCard(anchor, bvid);
      if (!card) continue;
      const links = [...card.querySelectorAll('a[href*="/video/"]')].filter((link) => link.href.includes(bvid));
      const candidates = [anchor, ...links].flatMap((link) => [link.title, link.getAttribute("aria-label"), link.textContent]).map(C.clean).filter(likelyTitle);
      const title = candidates.sort((a, b) => b.length - a.length)[0];
      if (!title) continue;
      const text = C.clean(card.innerText);
      const durations = text.match(/(?:\d{1,3}:)?\d{1,2}:\d{2}(?:\s*\/\s*(?:\d{1,3}:)?\d{1,2}:\d{2})?/g) || [];
      const author = card.querySelector('[class*="author" i], [class*="up-name" i], [class*="upname" i], [class*="owner" i]');
      const nativeCategory = card.querySelector('[data-tname], [class*="partition" i], [class*="category" i]');
      const image = card.querySelector("img");
      const item = C.normalizeBilibiliCandidate({
        href: anchor.href, title, creator: author?.textContent,
        durationText: durations.at(-1), progressText: durations.find((value) => value.includes("/")),
        thumbnailUrl: image?.currentSrc || image?.src || image?.getAttribute("data-src"),
        nativeCategory: nativeCategory?.dataset?.tname || nativeCategory?.textContent
      });
      if (item) result.set(item.id, item);
    }
    return [...result.values()];
  }

  function findCard(anchor, bvid) {
    let node = anchor;
    let best = null;
    for (let depth = 0; depth < 8 && node && node !== document.body; depth += 1) {
      node = node.parentElement;
      if (!node) break;
      const links = [...node.querySelectorAll('a[href*="/video/BV"]')];
      const ids = new Set(links.map((link) => link.href.match(/\/video\/(BV[0-9A-Za-z]+)/i)?.[1]).filter(Boolean));
      const text = C.clean(node.innerText);
      if (ids.size === 1 && ids.has(bvid) && text.length >= 4 && text.length <= 1000) best = node;
      if (ids.size > 1 || text.length > 1000) break;
    }
    return best || anchor.parentElement;
  }

  function likelyTitle(value) {
    return value && value.length >= 4 && value.length <= 220 && !/^(播放|稍后再看|已观看|更多|分享)$/.test(value) && !/^(?:\d{1,3}:)?\d{1,2}:\d{2}/.test(value);
  }

  async function hydrate(items) {
    const queue = [...items];
    const output = [];
    async function worker() {
      while (queue.length) {
        const item = queue.shift();
        try {
          const response = await chrome.runtime.sendMessage({ type: "FETCH_BILI_METADATA", bvid: item.videoId });
          if (response?.ok && response.data) output.push({ ...item, ...response.data, id: item.id, platform: item.platform, videoId: item.videoId, url: item.url });
        } catch {}
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    return output;
  }

  async function fetchAll() {
    const response = await chrome.runtime.sendMessage({ type: "FETCH_BILI_WATCH_LATER" });
    if (!response?.ok || !Array.isArray(response.items)) throw new Error(response?.error || "无法读取 B站稍后再看列表");
    return { items: response.items, expectedCount: response.expectedCount };
  }

  function expectedCount() {
    const match = document.body?.innerText?.match(/稍后再看\s*[·•]\s*([\d,]+)/);
    return match ? Number(match[1].replaceAll(",", "")) : null;
  }

  WLWCollectorRuntime.start({ platform: "bilibili", label: "B站稍后再看", readySelector: 'a[href*="/video/BV"]', scan, hydrate, fetchAll, expectedCount });
})();
