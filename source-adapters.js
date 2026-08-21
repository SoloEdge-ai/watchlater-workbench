(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WLWSourceAdapters = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const OWNER_SELECTOR = [
    "ytd-playlist-header-renderer ytd-channel-name a[href]",
    "ytd-playlist-header-renderer #owner-text a[href]",
    "ytd-playlist-sidebar-primary-info-renderer ytd-channel-name a[href]"
  ].join(", ");
  const LABELS = {
    youtube: new Set([
      "Remove from Watch later",
      "从“稍后观看”中移除",
      "从「稍后观看」中移除",
      "从稍后观看中移除",
      "從「稍後觀看」中移除",
      "[後で見る] から削除",
      "「後で見る」から削除"
    ]),
    bilibili: new Set(["从稍后再看中移除", "从稍后再看移除", "移出稍后再看", "Remove from Watch later", "「後で見る」から削除"])
  };
  const MENU_BUTTON_LABELS = {
    youtube: new Set(["Action menu", "Actions", "操作菜单", "操作選單", "操作メニュー"]),
    bilibili: new Set(["更多", "更多操作", "More actions", "その他", "その他の操作"])
  };

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function identifyYouTubeAccount(document) {
    const anchor = document?.querySelector?.(OWNER_SELECTOR);
    if (!anchor?.href) return null;
    let url;
    try { url = new URL(anchor.href, "https://www.youtube.com/"); } catch { return null; }
    const channel = url.pathname.match(/^\/channel\/(UC[0-9A-Za-z_-]+)\/?$/)?.[1];
    const handle = url.pathname.match(/^\/(%40|@)([0-9A-Za-z._-]+)\/?$/i)?.[2];
    const id = channel ? `channel:${channel}` : handle ? `handle:@${handle.toLocaleLowerCase()}` : "";
    return id ? { id, name: clean(anchor.textContent), url: url.href } : null;
  }

  function identifyBilibiliAccount(body) {
    if (body?.code !== 0 || body.data?.isLogin !== true || !/^\d+$/.test(String(body.data.mid || ""))) return null;
    const mid = String(body.data.mid);
    return { id: `mid:${mid}`, name: clean(body.data.uname), url: `https://space.bilibili.com/${mid}` };
  }

  function isRemovalLabel(platform, value) {
    return LABELS[platform]?.has(clean(value)) || false;
  }

  function youtubeVideoId(value) {
    try { return new URL(value, "https://www.youtube.com/").searchParams.get("v") || ""; } catch { return ""; }
  }

  function findYouTubeCard(document, videoId) {
    for (const card of document?.querySelectorAll?.("ytd-playlist-video-renderer") || []) {
      const link = card.querySelector?.("a#video-title, a[href*='/watch?v=']");
      if (youtubeVideoId(link?.href) === videoId) return card;
    }
    return null;
  }

  function findRemovalMenuItem(document, platform) {
    const selector = "ytd-menu-service-item-renderer, tp-yt-paper-item, [role='menuitem'], .vui_popover li, .vui_popover button";
    return [...(document?.querySelectorAll?.(selector) || [])].find((item) => {
      const hidden = item.closest?.("[hidden], [aria-hidden='true']");
      return !hidden && isRemovalLabel(platform, item.textContent);
    }) || null;
  }

  function findPlatformMenuButton(card, platform) {
    const candidates = card?.querySelectorAll?.("button, [role='button']") || [];
    return [...candidates].find((button) => {
      const label = clean(button.getAttribute?.("aria-label") || button.getAttribute?.("title"));
      return MENU_BUTTON_LABELS[platform]?.has(label) === true;
    }) || null;
  }

  async function findWhileScrolling(find, environment, options = {}) {
    const maxRounds = options.maxRounds || 140;
    const requiredStableRounds = options.stableRounds || 8;
    const wait = options.delay || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    let stable = 0;
    let previousHeight = 0;
    for (let round = 0; round < maxRounds; round += 1) {
      const found = find();
      if (found) return found;
      const height = environment.getHeight();
      stable = height === previousHeight && environment.nearBottom() ? stable + 1 : 0;
      if (stable >= requiredStableRounds) return null;
      previousHeight = height;
      environment.scrollToEnd(height);
      await wait(options.delayMs || 500);
    }
    throw new Error("页面未能稳定加载到列表末尾");
  }

  function pageScrollEnvironment(window, document) {
    return {
      getHeight: () => document.documentElement.scrollHeight,
      nearBottom: () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 240,
      scrollToEnd: (height) => window.scrollTo({ top: height, behavior: "smooth" })
    };
  }

  async function pollUntil(read, timeout, interval = 120) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const value = read();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    return null;
  }

  async function removeUsingMenu(options) {
    const card = await options.locateCard();
    if (!card) {
      if (options.allowAlreadyMissing) return { removed: true, alreadyMissing: true };
      throw new Error("已加载到列表末尾，但未找到目标视频");
    }
    card.scrollIntoView?.({ block: "center" });
    const menuButton = options.findMenuButton(card);
    if (!menuButton) throw new Error(`未找到${options.platformLabel}视频的已知操作菜单，页面结构可能已变化`);
    menuButton.click();
    const menuItem = await pollUntil(options.findMenuItem, options.menuTimeout || 4000);
    if (!menuItem) throw new Error(`未找到${options.platformLabel}精确的稍后再看移除菜单项`);
    menuItem.click();
    const disappeared = await pollUntil(() => !options.isPresent(), options.disappearTimeout || 8000);
    if (!disappeared) throw new Error("平台未确认移除：目标视频仍在列表中");
    return { removed: true, alreadyMissing: false };
  }

  return { OWNER_SELECTOR, identifyYouTubeAccount, identifyBilibiliAccount, isRemovalLabel, youtubeVideoId, findYouTubeCard, findRemovalMenuItem, findPlatformMenuButton, findWhileScrolling, pageScrollEnvironment, pollUntil, removeUsingMenu };
});
