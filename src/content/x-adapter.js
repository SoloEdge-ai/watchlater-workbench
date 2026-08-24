(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WLWXAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeHandle(value) {
    const handle = clean(value).replace(/^@/, "");
    return /^[0-9A-Za-z_]{1,15}$/.test(handle) ? handle : "";
  }

  function identifyAccount(document) {
    const accountButton = document?.querySelector?.('[data-testid="SideNav_AccountSwitcher_Button"]');
    const avatar = accountButton?.querySelector?.('[data-testid^="UserAvatar-Container-"]');
    const avatarTestId = avatar?.getAttribute?.("data-testid") || "";
    let handle = normalizeHandle(avatarTestId.replace(/^UserAvatar-Container-/, ""));
    let name = clean(accountButton?.querySelector?.("img[alt]")?.getAttribute?.("alt") || accountButton?.textContent);

    const profile = document?.querySelector?.('a[data-testid="AppTabBar_Profile_Link"], nav[aria-label] a[aria-label="Profile"], nav[aria-label] a[aria-label="个人资料"]');
    const profilePath = profile?.getAttribute?.("href") || profile?.href || "";
    if (!handle) {
      try {
        const url = new URL(profilePath, "https://x.com/");
        handle = normalizeHandle(url.pathname.split("/").filter(Boolean)[0]);
      } catch {}
    }
    if (!name) name = clean(profile?.textContent) || (handle ? `@${handle}` : "");
    if (!handle) return null;
    return { id: `handle:@${handle.toLocaleLowerCase()}`, name, url: `https://x.com/${handle}` };
  }

  function readUrl(node) {
    return String(node?.currentSrc || node?.src || node?.getAttribute?.("src") || "");
  }

  function readUser(userNameNode, fallbackHandle = "") {
    const links = [...(userNameNode?.querySelectorAll?.("a[href]") || [])];
    const texts = links.map((link) => clean(link.textContent)).filter(Boolean);
    const rawHandle = texts.find((text) => /^@[0-9A-Za-z_]{1,15}$/.test(text)) || (fallbackHandle ? `@${fallbackHandle}` : "");
    const name = texts.find((text) => text !== rawHandle && !text.startsWith("@")) || rawHandle;
    return { name, handle: rawHandle };
  }

  function tweetArticles(root) {
    return [...(root?.querySelectorAll?.('article[data-testid="tweet"]') || [])].filter((article) => {
      const ancestorTweet = article.parentElement?.closest?.('article[data-testid="tweet"]');
      return !ancestorTweet;
    });
  }

  function primaryDescendants(article, selector) {
    const nodes = [...(article?.querySelectorAll?.(selector) || [])];
    return nodes.filter((node) => {
      const owner = node.closest?.('article[data-testid="tweet"]');
      return !owner || owner === article;
    });
  }

  function primaryDescendant(article, selector) {
    return primaryDescendants(article, selector)[0] || null;
  }

  function readStatusIdentity(article) {
    const times = [...(article?.querySelectorAll?.("time") || [])];
    const primaryTime = times.find((candidate) => {
      const owner = candidate.closest?.('article[data-testid="tweet"]');
      return !owner || owner === article;
    });
    const time = primaryTime || (times.length ? null : article?.querySelector?.("time"));
    const statusLink = time?.closest?.('a[href*="/status/"]');
    const rawHref = statusLink?.getAttribute?.("href") || statusLink?.href || "";
    let url;
    try { url = new URL(rawHref, "https://x.com/"); } catch { return null; }
    const match = url.pathname.match(/^\/([0-9A-Za-z_]{1,15})\/status\/(\d{1,24})(?:\/|$)/);
    if (!match) return null;
    return { time, handle: match[1], postId: match[2], url: `https://x.com/${match[1]}/status/${match[2]}` };
  }

  function parseArticle(article, now = Date.now()) {
    const identity = readStatusIdentity(article);
    if (!identity) return null;
    const { time, handle, postId, url } = identity;

    const textNodes = [...(article.querySelectorAll?.('[data-testid="tweetText"]') || [])];
    const primaryText = primaryDescendant(article, '[data-testid="tweetText"]');
    const quotedTextNode = textNodes.find((node) => node !== primaryText) || null;
    const cardNodes = primaryDescendants(article, '[data-testid="card.wrapper"], [data-testid^="card.layout"], a[href*="/i/article/"]');
    const cardText = clean(cardNodes.map((node) => node.innerText || node.textContent).join(" "));
    const primaryBody = clean(primaryText?.textContent) || clean(article.innerText).slice(0, 2000);
    const bodyText = clean([primaryBody, cardText && !primaryBody.includes(cardText) ? cardText : ""].filter(Boolean).join(" ")).slice(0, 2000);
    if (!bodyText) return null;
    const userNames = [...(article.querySelectorAll?.('[data-testid="User-Name"]') || [])];
    const primaryUserNode = primaryDescendant(article, '[data-testid="User-Name"]');
    const quotedUserNode = userNames.find((node) => node !== primaryUserNode) || null;
    const primaryUser = readUser(primaryUserNode, handle);
    const quotedUser = readUser(quotedUserNode);
    const images = primaryDescendants(article, "img");
    const avatarUrl = images.map(readUrl).find((src) => /\/profile_images\//.test(src)) || "";
    const mediaUrls = [...new Set(images.map(readUrl).filter((src) => /pbs\.twimg\.com\/(?:media|amplify_video_thumb|ext_tw_video_thumb)\//.test(src)))];
    const hasVideo = Boolean(primaryDescendant(article, 'video, [data-testid="videoPlayer"], [data-testid="videoComponent"]'));
    const publishedAt = Date.parse(time?.getAttribute?.("datetime") || "");
    const title = bodyText.slice(0, 180);
    return {
      id: `x:${postId}`,
      platform: "x",
      kind: "post",
      sourceItemId: postId,
      url,
      title,
      bodyText,
      creator: primaryUser.name || `@${handle}`,
      creatorHandle: primaryUser.handle || `@${handle}`,
      avatarUrl,
      thumbnailUrl: mediaUrls[0] || "",
      mediaUrls,
      hasVideo,
      quotedText: clean(quotedTextNode?.textContent),
      quotedCreator: quotedUser.name,
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : null,
      addedAt: now,
      firstSeenAt: now,
      lastSeenAt: now,
      status: "current"
    };
  }

  const BOOKMARK_LABELS = new Set(["Bookmarks", "书签", "收藏", "ブックマーク"]);
  const LIKE_LABELS = new Set(["Likes", "喜欢", "讚好", "いいね"]);

  function isBookmarkTimelineLabel(value) {
    const label = clean(value);
    const timelineLabel = label.replace(/^(?:Timeline:\s*|时间线[：:]\s*|タイムライン[：:]\s*)/i, "");
    return BOOKMARK_LABELS.has(timelineLabel);
  }

  function bookmarkRegion(document) {
    const direct = document?.querySelector?.('[role="region"][aria-label="Bookmarks"], [role="region"][aria-label="书签"], [role="region"][aria-label="收藏"], [role="region"][aria-label="ブックマーク"]');
    if (direct) return direct;
    const regions = [...(document?.querySelectorAll?.('[role="region"]') || [])];
    return regions.find((region) => {
      if (isBookmarkTimelineLabel(region.getAttribute?.("aria-label"))) return true;
      const labelledBy = clean(region.getAttribute?.("aria-labelledby"));
      if (labelledBy && labelledBy.split(/\s+/).some((id) => isBookmarkTimelineLabel(document?.getElementById?.(id)?.textContent))) return true;
      return [...(region.querySelectorAll?.("[aria-label]") || [])]
        .some((element) => isBookmarkTimelineLabel(element.getAttribute?.("aria-label")));
    }) || null;
  }

  function historyView(document) {
    const selected = document?.querySelector?.('[role="tab"][aria-selected="true"]');
    const selectedLabel = clean(selected?.textContent);
    if (BOOKMARK_LABELS.has(selectedLabel)) return "bookmarks";
    if (LIKE_LABELS.has(selectedLabel)) return "likes";
    return "unknown";
  }

  function isBookmarksView(document) {
    if (historyView(document) !== "bookmarks") return false;
    return Boolean(bookmarkRegion(document));
  }

  function postIdFromArticle(article) {
    return readStatusIdentity(article)?.postId || "";
  }

  function findPostArticle(document, postId) {
    return tweetArticles(document).find((article) => postIdFromArticle(article) === String(postId)) || null;
  }

  function ownActionControl(article, testId) {
    const selector = `[data-testid="${testId}"]`;
    const candidates = [...(article?.querySelectorAll?.(selector) || [])];
    if (!candidates.length) {
      const candidate = article?.querySelector?.(selector);
      if (candidate) candidates.push(candidate);
    }
    return candidates.find((candidate) => {
      const owner = candidate.closest?.('article[data-testid="tweet"]');
      return !owner || owner === article;
    }) || null;
  }

  async function performAction(document, postId, operation, options = {}) {
    const wait = options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const locate = options.locate || (() => findPostArticle(document, postId));
    const timeout = Number(options.timeout || 8000);
    let article = await locate();
    if (!article) {
      if (operation === "remove" && options.allowAlreadyMissing === true) return { alreadyMissing: true };
      throw new Error("未在 X 页面找到目标帖子");
    }

    if (operation === "restore") {
      if (ownActionControl(article, "removeBookmark")) return { alreadyBookmarked: true };
      const button = ownActionControl(article, "bookmark");
      if (!button) throw new Error("未找到 X 原生收藏按钮");
      button.click();
      const end = Date.now() + timeout;
      while (Date.now() <= end) {
        article = await locate();
        if (article && ownActionControl(article, "removeBookmark")) return { restored: true };
        await wait(120);
      }
      throw new Error("X 未确认帖子已重新收藏");
    }

    if (operation !== "remove") throw new Error("不支持的 X 收藏操作");
    const button = ownActionControl(article, "removeBookmark");
    if (!button) throw new Error("未找到 X 原生取消收藏按钮");
    button.click();
    const end = Date.now() + timeout;
    while (Date.now() <= end) {
      article = await locate();
      if (!article) return { removed: true };
      await wait(120);
    }
    throw new Error("X 未确认帖子已取消收藏");
  }

  function isExplicitEmpty(document) {
    if (document?.querySelector?.('[data-testid="emptyState"]')) return true;
    const text = clean(document?.body?.innerText);
    return /Save posts for later|Bookmark Posts to easily find them again|还没有任何书签|暂无收藏|ブックマークしたポストはありません/i.test(text);
  }

  function hasTimelineError(document) {
    if (document?.querySelector?.('[data-testid="error-detail"], [data-testid="errorDetail"]')) return true;
    const retryLabels = new Set(["Retry", "Try again", "重试", "再试一次", "重新加载", "やり直す", "再試行"]);
    return [...(document?.querySelectorAll?.('button, [role="button"]') || [])].some((button) => retryLabels.has(clean(button.textContent)));
  }

  async function collectFullSnapshot(document, window, options = {}) {
    if (!isBookmarksView(document)) throw new Error("当前 X 页面不是已选中的 Bookmarks 列表");
    const wait = options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const now = options.now || Date.now;
    const maxRounds = Number(options.maxRounds || 180);
    const requiredStableRounds = Number(options.stableRounds || 8);
    const nearBottom = options.nearBottom || (() => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 240);
    const seen = new Map();
    let lastCount = -1;
    let stable = 0;
    let completed = false;

    for (let round = 0; round < maxRounds; round += 1) {
      if (options.validateAccount) await options.validateAccount();
      if (!isBookmarksView(document)) throw new Error("X 页面已离开 Bookmarks 列表，同步已停止");
      if (hasTimelineError(document)) throw new Error("X 收藏列表加载失败，已保留原资料且未执行归档");
      const scannedAt = now();
      const articles = tweetArticles(document);
      for (const article of articles) {
        const item = parseArticle(article, scannedAt);
        if (!item) continue;
        const previous = seen.get(item.id);
        seen.set(item.id, previous ? { ...item, addedAt: previous.addedAt, firstSeenAt: previous.firstSeenAt } : item);
      }
      const region = bookmarkRegion(document);
      const loading = Boolean(region?.querySelector?.('[role="progressbar"], [data-testid="cellInnerDiv"] [role="progressbar"]'));
      const allowEmpty = seen.size === 0 && !loading && isExplicitEmpty(document);
      if (allowEmpty) return { items: [], complete: true, allowEmpty: true };
      const atBottom = nearBottom();
      stable = !loading && atBottom && seen.size === lastCount ? stable + 1 : 0;
      lastCount = seen.size;
      if (atBottom && stable >= requiredStableRounds) { completed = true; break; }
      window.scrollTo?.({ top: document.documentElement?.scrollHeight || 0, behavior: "smooth" });
      await wait(700);
    }

    const allowEmpty = seen.size === 0 && isExplicitEmpty(document);
    if (!completed || (!seen.size && !allowEmpty)) throw new Error("未完整到达 X 收藏列表末尾，已保留原资料且未执行归档");
    return { items: [...seen.values()], complete: true, allowEmpty };
  }

  return { clean, normalizeHandle, identifyAccount, parseArticle, historyView, isBookmarksView, tweetArticles, postIdFromArticle, findPostArticle, performAction, isExplicitEmpty, hasTimelineError, collectFullSnapshot };
});
