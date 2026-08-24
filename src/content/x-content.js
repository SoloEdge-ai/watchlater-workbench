(function () {
  "use strict";

  const X = WLWXAdapter;
  const SourceAdapters = WLWSourceAdapters;
  async function identifyAccount() {
    const account = X.identifyAccount(document);
    if (!account) throw new Error("无法识别当前 X 账号");
    return account;
  }

  function scan() {
    if (!X.isBookmarksView(document)) return [];
    const now = Date.now();
    return X.tweetArticles(document).map((article) => X.parseArticle(article, now)).filter(Boolean);
  }

  async function ensureBookmarksView() {
    if (X.isBookmarksView(document)) return;
    const selected = await SourceAdapters.pollUntil(() => {
      const view = X.historyView(document);
      return view === "unknown" ? null : view;
    }, 8000, 150);
    if (selected === "likes") throw new Error("当前 X History 处于 Likes，未执行收藏同步");
    if (selected !== "bookmarks") throw new Error("无法确认 X History 的 Bookmarks 视图");
    const ready = await SourceAdapters.pollUntil(() => X.isBookmarksView(document), 8000, 150);
    if (!ready) throw new Error("X Bookmarks 区域未就绪，未执行收藏同步");
  }

  async function fetchAll() {
    await ensureBookmarksView();
    const expectedAccount = await identifyAccount();
    return X.collectFullSnapshot(document, window, {
      validateAccount: async () => {
        const current = await identifyAccount();
        if (current.id !== expectedAccount.id) throw new Error("X 账号在同步期间发生变化，已停止同步");
      }
    });
  }

  async function performAction(action) {
    const postId = action.sourceItemId || action.videoId;
    if (!postId) throw new Error("X 操作缺少帖子 ID");
    if (action.operation === "restore") {
      return X.performAction(document, postId, "restore");
    }
    await ensureBookmarksView();
    const environment = SourceAdapters.pageScrollEnvironment(window, document);
    const found = await SourceAdapters.findWhileScrolling(
      () => X.findPostArticle(document, postId),
      environment,
      { maxRounds: 180, stableRounds: 8 }
    );
    if (!found && action.allowAlreadyMissing !== true) throw new Error("未在 X Bookmarks 中找到目标帖子");
    return X.performAction(document, postId, "remove", {
      locate: () => X.findPostArticle(document, postId),
      allowAlreadyMissing: action.allowAlreadyMissing === true
    });
  }

  const adapter = {
    platform: "x",
    label: "X 收藏",
    readySelector: "main",
    accountReadySelector: '[data-testid="SideNav_AccountSwitcher_Button"]',
    identifyAccount,
    scan,
    fetchAll,
    requireFetchAll: true,
    performAction
  };

  if (/^\/i\/(?:history|bookmarks)/.test(location.pathname)) WLWCollectorRuntime.start(adapter).catch(() => {});
  WLWSourceActionRuntime.start(adapter);
})();
