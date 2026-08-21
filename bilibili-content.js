(function () {
  "use strict";
  const C = WLWCollectors;
  const SourceAdapters = WLWSourceAdapters;

  async function identifyAccount() {
    try {
      const response = await fetch("https://api.bilibili.com/x/web-interface/nav", { credentials: "include", headers: { Accept: "application/json" } });
      if (response.ok) {
        const account = SourceAdapters.identifyBilibiliAccount(await response.json());
        if (account) return account;
      }
    } catch {}
    const fallback = await chrome.runtime.sendMessage({ type: "FETCH_BILI_ACCOUNT" });
    const account = fallback?.ok ? SourceAdapters.identifyBilibiliAccount(fallback.body) : null;
    if (!account) throw new Error(fallback?.error || "无法识别已登录的 B站账号");
    return account;
  }

  function scan() {
    const result = new Map();
    const anchors = [...document.querySelectorAll(C.BILIBILI_LINK_SELECTOR)];
    for (const anchor of anchors) {
      const bvid = C.extractBilibiliVideoId(anchor.href);
      if (!bvid) continue;
      const card = findCard(anchor, bvid);
      if (!card) continue;
      const links = [...card.querySelectorAll(C.BILIBILI_LINK_SELECTOR)].filter((link) => C.extractBilibiliVideoId(link.href) === bvid);
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
      const links = [...node.querySelectorAll(C.BILIBILI_LINK_SELECTOR)];
      const ids = new Set(links.map((link) => C.extractBilibiliVideoId(link.href)).filter(Boolean));
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
    let pageError = "";
    try {
      const response = await fetch("https://api.bilibili.com/x/v2/history/toview/web?jsonp=jsonp", {
        credentials: "include",
        headers: { Accept: "application/json" }
      });
      if (!response.ok) throw new Error(`B站稍后再看请求失败 (${response.status})`);
      const body = await response.json();
      if (body?.code !== 0 || !Array.isArray(body.data?.list)) {
        throw new Error(body?.message || "未取得 B站稍后再看列表");
      }
      return {
        items: C.normalizeBilibiliApiResponse(body),
        expectedCount: Number(body.data.count)
      };
    } catch (error) {
      pageError = String(error?.message || error);
    }

    const fallback = await chrome.runtime.sendMessage({ type: "FETCH_BILI_WATCH_LATER" });
    if (!fallback?.ok || !Array.isArray(fallback.items)) {
      throw new Error(fallback?.error || pageError || "无法读取 B站稍后再看列表");
    }
    return { items: fallback.items, expectedCount: fallback.expectedCount };
  }

  function expectedCount() {
    const match = document.body?.innerText?.match(/稍后再看\s*[·•]\s*([\d,]+)/);
    return match ? Number(match[1].replaceAll(",", "")) : null;
  }

  async function removeVideo(videoId, options = {}) {
    return SourceAdapters.removeUsingMenu({
      locateCard: () => findVideoCard(videoId),
      findMenuButton: (card) => SourceAdapters.findPlatformMenuButton(card, "bilibili"),
      findMenuItem: () => SourceAdapters.findRemovalMenuItem(document, "bilibili"),
      isPresent: () => Boolean(findVideoAnchor(videoId)),
      platformLabel: "B站",
      allowAlreadyMissing: options.allowAlreadyMissing === true
    });
  }

  async function findVideoCard(videoId) {
    return SourceAdapters.findWhileScrolling(
      () => {
        const anchor = findVideoAnchor(videoId);
        return anchor ? findCard(anchor, videoId) : null;
      },
      SourceAdapters.pageScrollEnvironment(window, document)
    );
  }

  function findVideoAnchor(videoId) {
    return [...document.querySelectorAll(C.BILIBILI_LINK_SELECTOR)].find((link) => C.extractBilibiliVideoId(link.href) === videoId) || null;
  }

  const adapter = { platform: "bilibili", label: "B站稍后再看", readySelector: C.BILIBILI_LINK_SELECTOR, identifyAccount, scan, hydrate, fetchAll, expectedCount, removeVideo };
  WLWCollectorRuntime.start(adapter);
  WLWSourceActionRuntime.start(adapter);

})();
