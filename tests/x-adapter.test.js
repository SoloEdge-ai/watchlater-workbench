const test = require("node:test");
const assert = require("node:assert/strict");
const XAdapter = require("../x-adapter.js");
const { xPostFixture, fixtures } = require("./fixtures/x-posts.js");

test("X semantic fixtures cover ordinary, image, video, Article, external, and quoted posts", () => {
  const parsed = Object.fromEntries(Object.entries(fixtures).map(([kind, fixture]) => [kind, XAdapter.parseArticle(xPostFixture(fixture), 1234)]));
  for (const [kind, item] of Object.entries(parsed)) {
    assert.ok(item, `${kind} fixture should parse`);
    assert.equal(item.kind, "post");
  }
  assert.equal(parsed.ordinary.mediaUrls.length, 0);
  assert.equal(parsed.ordinary.hasVideo, false);
  assert.match(parsed.image.thumbnailUrl, /pbs\.twimg\.com\/media/);
  assert.match(parsed.video.thumbnailUrl, /amplify_video_thumb/);
  assert.equal(parsed.video.hasVideo, true);
  assert.match(parsed.article.bodyText, /Long-form article summary/);
  assert.match(parsed.external.bodyText, /example\.com/);
  assert.equal(parsed.quoted.quotedText, "The quoted post text");
  assert.equal(parsed.quoted.quotedCreator, "Quoted Author");
});

test("X account identity uses the signed-in profile handle and normalizes case", () => {
  const profile = {
    href: "https://x.com/FridenZhang",
    textContent: "Friden",
    getAttribute: (name) => name === "href" ? "/FridenZhang" : ""
  };
  const document = {
    querySelector: (selector) => selector.includes("SideNav_AccountSwitcher_Button") ? null : profile
  };

  assert.deepEqual(XAdapter.identifyAccount(document), {
    id: "handle:@fridenzhang",
    name: "Friden",
    url: "https://x.com/FridenZhang"
  });
  assert.equal(XAdapter.identifyAccount({ querySelector: () => null }), null);
});

test("X article parsing keeps the primary post identity and separates quoted content", () => {
  const primaryLink = { getAttribute: () => "/tuturetom/status/2079908319586623531" };
  const time = {
    getAttribute: (name) => name === "datetime" ? "2026-07-22T10:30:00.000Z" : "",
    closest: () => primaryLink
  };
  const userLinks = [
    { textContent: "Tom Huang", getAttribute: () => "/tuturetom" },
    { textContent: "@tuturetom", getAttribute: () => "/tuturetom" }
  ];
  const quotedUserLinks = [
    { textContent: "OpenDesign", getAttribute: () => "/OpenDesignHQ" },
    { textContent: "@OpenDesignHQ", getAttribute: () => "/OpenDesignHQ" }
  ];
  const userNames = [
    { querySelectorAll: () => userLinks },
    { querySelectorAll: () => quotedUserLinks }
  ];
  const textNodes = [
    { textContent: "Codex Slides 正式开源！" },
    { textContent: "Codex can now visualize anything." }
  ];
  const images = [
    { src: "https://pbs.twimg.com/profile_images/1/avatar_normal.jpg", getAttribute: (name) => name === "src" ? "https://pbs.twimg.com/profile_images/1/avatar_normal.jpg" : "" },
    { src: "https://pbs.twimg.com/amplify_video_thumb/2079907760695562240/img/cover.jpg", getAttribute: (name) => name === "src" ? "https://pbs.twimg.com/amplify_video_thumb/2079907760695562240/img/cover.jpg" : "" },
    { src: "https://abs.twimg.com/emoji/v2/svg/1f680.svg", getAttribute: (name) => name === "src" ? "https://abs.twimg.com/emoji/v2/svg/1f680.svg" : "" }
  ];
  const article = {
    innerText: "Tom Huang @tuturetom Codex Slides 正式开源！",
    querySelector: (selector) => selector === "time" ? time : selector.includes("tweetText") ? textNodes[0] : null,
    querySelectorAll: (selector) => {
      if (selector.includes("tweetText")) return textNodes;
      if (selector.includes("User-Name")) return userNames;
      if (selector.includes("video")) return [{ closest: () => article }];
      if (selector === "img") return images;
      return [];
    }
  };

  assert.deepEqual(XAdapter.parseArticle(article, 1234), {
    id: "x:2079908319586623531",
    platform: "x",
    kind: "post",
    sourceItemId: "2079908319586623531",
    url: "https://x.com/tuturetom/status/2079908319586623531",
    title: "Codex Slides 正式开源！",
    bodyText: "Codex Slides 正式开源！",
    creator: "Tom Huang",
    creatorHandle: "@tuturetom",
    avatarUrl: "https://pbs.twimg.com/profile_images/1/avatar_normal.jpg",
    thumbnailUrl: "https://pbs.twimg.com/amplify_video_thumb/2079907760695562240/img/cover.jpg",
    mediaUrls: ["https://pbs.twimg.com/amplify_video_thumb/2079907760695562240/img/cover.jpg"],
    hasVideo: true,
    quotedText: "Codex can now visualize anything.",
    quotedCreator: "OpenDesign",
    publishedAt: Date.parse("2026-07-22T10:30:00.000Z"),
    addedAt: 1234,
    firstSeenAt: 1234,
    lastSeenAt: 1234,
    status: "current"
  });
});

test("X sync accepts only the selected Bookmarks history view", () => {
  const region = {};
  const bookmarks = { textContent: "Bookmarks", getAttribute: () => "true" };
  const likes = { textContent: "Likes", getAttribute: () => "true" };
  const bookmarksDocument = {
    querySelector: (selector) => selector.includes("aria-selected") ? bookmarks : selector.includes("region") ? region : null
  };
  const likesDocument = {
    querySelector: (selector) => selector.includes("aria-selected") ? likes : selector.includes("region") ? region : null
  };

  assert.equal(XAdapter.isBookmarksView(bookmarksDocument), true);
  assert.equal(XAdapter.isBookmarksView(likesDocument), false);
  assert.equal(XAdapter.historyView(bookmarksDocument), "bookmarks");
  assert.equal(XAdapter.historyView(likesDocument), "likes");
  assert.equal(XAdapter.isBookmarksView({ querySelector: () => null }), false);

  const timelineDocument = {
    querySelector: (selector) => selector.includes("aria-selected") ? bookmarks : null,
    querySelectorAll: (selector) => selector.includes("region") ? [{
      getAttribute: (name) => name === "aria-label" ? "Timeline: Bookmarks" : ""
    }] : []
  };
  assert.equal(XAdapter.isBookmarksView(timelineDocument), true);

  const nestedTimelineLabel = {
    getAttribute: (name) => name === "aria-label" ? "Timeline: Bookmarks" : ""
  };
  const labelledRegion = {
    getAttribute: () => "",
    querySelectorAll: (selector) => selector === "[aria-label]" ? [nestedTimelineLabel] : []
  };
  const currentHistoryDocument = {
    querySelector: (selector) => selector.includes("aria-selected") ? bookmarks : null,
    querySelectorAll: (selector) => selector.includes("region") ? [labelledRegion] : []
  };
  assert.equal(XAdapter.isBookmarksView(currentHistoryDocument), true);
});

test("X removal clicks only the exact post bookmark control", async () => {
  let targetBookmarked = true;
  let targetVisible = true;
  let targetClicks = 0;
  let otherClicks = 0;
  function article(id, isTarget) {
    const link = { getAttribute: () => `/author/status/${id}` };
    const time = { closest: () => link };
    const remove = { click() { isTarget ? targetClicks += 1 : otherClicks += 1; if (isTarget) { targetBookmarked = false; targetVisible = false; } } };
    return {
      querySelector: (selector) => {
        if (selector === "time") return time;
        if (selector.includes("removeBookmark")) return (!isTarget || targetBookmarked) ? remove : null;
        return null;
      }
    };
  }
  const other = article("111", false);
  const target = article("222", true);
  const document = { querySelectorAll: () => targetVisible ? [other, target] : [other] };

  const result = await XAdapter.performAction(document, "222", "remove", { wait: async () => {}, timeout: 20 });

  assert.equal(result.removed, true);
  assert.equal(targetClicks, 1);
  assert.equal(otherClicks, 0);
});

test("X removal does not archive while the target post remains visible", async () => {
  let bookmarked = true;
  const link = { getAttribute: () => "/author/status/555" };
  const time = { closest: () => link };
  const article = {
    querySelector: (selector) => {
      if (selector === "time") return time;
      if (selector.includes("removeBookmark")) return bookmarked ? { click() { bookmarked = false; } } : null;
      return null;
    }
  };
  const document = { querySelectorAll: () => [article] };

  await assert.rejects(
    XAdapter.performAction(document, "555", "remove", { wait: async () => {}, timeout: 5 }),
    /未确认帖子已取消收藏/
  );
});

test("X restore confirms the native bookmark state and is idempotent", async () => {
  let bookmarked = false;
  let clicks = 0;
  const link = { getAttribute: () => "/author/status/444" };
  const time = { closest: () => link };
  const article = {
    querySelector: (selector) => {
      if (selector === "time") return time;
      if (selector.includes("removeBookmark")) return bookmarked ? {} : null;
      if (selector.includes('data-testid="bookmark"')) return { click() { clicks += 1; bookmarked = true; } };
      return null;
    }
  };
  const document = { querySelectorAll: () => [article] };

  assert.deepEqual(await XAdapter.performAction(document, "444", "restore", { wait: async () => {} }), { restored: true });
  assert.deepEqual(await XAdapter.performAction(document, "444", "restore", { wait: async () => {} }), { alreadyBookmarked: true });
  assert.equal(clicks, 1);
});

test("X actions fail safely when the exact native bookmark button is missing", async () => {
  const link = { getAttribute: () => "/author/status/777" };
  const article = { querySelector: (selector) => selector === "time" ? { closest: () => link } : null };
  const document = { querySelectorAll: () => [article] };

  await assert.rejects(XAdapter.performAction(document, "777", "remove"), /取消收藏按钮/);
  await assert.rejects(XAdapter.performAction(document, "777", "restore"), /收藏按钮/);
});

test("X actions never click a nested quoted-post bookmark control", async () => {
  let quotedClicks = 0;
  const link = { getAttribute: () => "/author/status/888" };
  const quotedArticle = {};
  const quotedButton = { click() { quotedClicks += 1; }, closest: () => quotedArticle };
  const article = {
    querySelector: (selector) => selector === "time" ? { closest: () => link } : selector.includes("removeBookmark") ? quotedButton : null,
    querySelectorAll: (selector) => selector.includes("removeBookmark") ? [quotedButton] : []
  };
  const document = { querySelectorAll: () => [article] };

  await assert.rejects(XAdapter.performAction(document, "888", "remove"), /取消收藏按钮/);
  assert.equal(quotedClicks, 0);
});

test("X collection excludes nested quoted tweet articles", () => {
  const main = { parentElement: { closest: () => null } };
  const nested = { parentElement: { closest: () => main } };
  const document = { querySelectorAll: () => [main, nested] };
  assert.deepEqual(XAdapter.tweetArticles(document), [main]);
});

test("X main-post identity never falls back to a nested quote time", () => {
  const nestedArticle = {};
  const nestedLink = { getAttribute: () => "/quoted/status/999" };
  const nestedTime = {
    closest: (selector) => selector.includes("article") ? nestedArticle : nestedLink
  };
  const main = {
    querySelectorAll: (selector) => selector === "time" ? [nestedTime] : [],
    querySelector: () => nestedTime
  };
  assert.equal(XAdapter.postIdFromArticle(main), "");
});

test("X explicitly empty Bookmarks view is a complete empty snapshot", async () => {
  const selected = { textContent: "Bookmarks" };
  const region = { querySelector: () => null };
  const document = {
    body: { innerText: "Save posts for later" },
    querySelector: (selector) => selector.includes("aria-selected") ? selected : selector.includes("region") ? region : selector.includes("emptyState") ? {} : null,
    querySelectorAll: () => []
  };

  assert.deepEqual(await XAdapter.collectFullSnapshot(document, { scrollTo() {} }, { wait: async () => {} }), {
    items: [], complete: true, allowEmpty: true
  });
});

test("X virtual history produces a complete snapshot only after reaching a stable end", async () => {
  const statusLink = { getAttribute: () => "/author/status/333" };
  const time = { getAttribute: () => "2026-08-23T00:00:00.000Z", closest: () => statusLink };
  const userName = { querySelectorAll: () => [
    { textContent: "Author", getAttribute: () => "/author" },
    { textContent: "@author", getAttribute: () => "/author" }
  ] };
  const article = {
    innerText: "A saved post",
    querySelector: (selector) => selector === "time" ? time : selector.includes("tweetText") ? { textContent: "A saved post" } : null,
    querySelectorAll: (selector) => selector.includes("tweetText") ? [{ textContent: "A saved post" }] : selector.includes("User-Name") ? [userName] : []
  };
  const selected = { textContent: "Bookmarks" };
  const document = {
    querySelector: (selector) => selector.includes("aria-selected") ? selected : selector.includes("region") ? {} : null,
    querySelectorAll: (selector) => selector.includes("article") ? [article] : []
  };
  const window = { scrollTo() {}, innerHeight: 900 };

  const snapshot = await XAdapter.collectFullSnapshot(document, window, {
    maxRounds: 2,
    stableRounds: 1,
    nearBottom: () => true,
    wait: async () => {},
    now: () => 1234
  });
  assert.equal(snapshot.complete, true);
  assert.deepEqual(snapshot.items.map((item) => item.id), ["x:333"]);

  await assert.rejects(XAdapter.collectFullSnapshot(document, window, {
    maxRounds: 2,
    stableRounds: 1,
    nearBottom: () => false,
    wait: async () => {}
  }), /未完整到达 X 收藏列表末尾/);

  let accountChecks = 0;
  await assert.rejects(XAdapter.collectFullSnapshot(document, window, {
    maxRounds: 3,
    stableRounds: 2,
    nearBottom: () => true,
    wait: async () => {},
    validateAccount: async () => {
      accountChecks += 1;
      if (accountChecks > 1) throw new Error("X 账号已变化");
    }
  }), /X 账号已变化/);

  const loadingRegion = { querySelector: () => ({}) };
  const loadingDocument = {
    ...document,
    querySelector: (selector) => selector.includes("aria-selected") ? selected : selector.includes("region") ? loadingRegion : null
  };
  await assert.rejects(XAdapter.collectFullSnapshot(loadingDocument, window, {
    maxRounds: 2,
    stableRounds: 1,
    nearBottom: () => true,
    wait: async () => {}
  }), /未完整到达 X 收藏列表末尾/);

  const errorDocument = {
    ...document,
    querySelector: (selector) => selector.includes("error-detail") ? {} : document.querySelector(selector)
  };
  await assert.rejects(XAdapter.collectFullSnapshot(errorDocument, window, {
    maxRounds: 2,
    stableRounds: 1,
    nearBottom: () => true,
    wait: async () => {}
  }), /加载失败/);
});
