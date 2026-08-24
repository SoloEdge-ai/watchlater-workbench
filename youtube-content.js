(function () {
  "use strict";
  if (new URL(location.href).searchParams.get("list") !== "WL") return;
  const C = WLWCollectors;
  const SourceAdapters = WLWSourceAdapters;

  async function identifyAccount() {
    const account = SourceAdapters.identifyYouTubeAccount(document);
    if (!account) throw new Error("无法从播放列表标题识别 YouTube 频道账号");
    return account;
  }

  function scan() {
    const result = new Map();
    const cards = [...document.querySelectorAll("ytd-playlist-video-renderer")];
    for (const card of cards) {
      const titleLink = card.querySelector("a#video-title, a[href*='/watch?v=']");
      const duration = C.clean(card.querySelector("ytd-thumbnail-overlay-time-status-renderer #text, #text.ytd-thumbnail-overlay-time-status-renderer")?.textContent);
      const progressNode = card.querySelector("#progress, ytd-thumbnail-overlay-resume-playback-renderer #progress");
      const percent = Number.parseFloat(progressNode?.style?.width || "0");
      const durationSeconds = C.parseDuration(duration);
      const item = C.normalizeYouTubeCandidate({
        href: titleLink?.href, title: titleLink?.title || titleLink?.textContent,
        creator: card.querySelector("ytd-channel-name a, #channel-name a")?.textContent,
        durationText: duration,
        progressText: durationSeconds && percent ? `${Math.round(durationSeconds * percent / 100)}:${"00"}/${duration}` : "",
        thumbnailUrl: card.querySelector("ytd-thumbnail img, img")?.currentSrc || card.querySelector("ytd-thumbnail img, img")?.src
      });
      if (item) {
        if (durationSeconds && percent) item.progressSeconds = Math.round(durationSeconds * percent / 100);
        result.set(item.id, item);
      }
    }
    if (!cards.length) {
      for (const link of document.querySelectorAll('a[href*="/watch?v="]')) {
        const item = C.normalizeYouTubeCandidate({ href: link.href, title: link.title || link.textContent, creator: "" });
        if (item) result.set(item.id, item);
      }
    }
    return [...result.values()];
  }

  async function removeVideo(videoId, options = {}) {
    return SourceAdapters.removeUsingMenu({
      locateCard: () => findVideoCard(videoId),
      findMenuButton: (card) => SourceAdapters.findPlatformMenuButton(card, "youtube"),
      findMenuItem: () => SourceAdapters.findRemovalMenuItem(document, "youtube"),
      isPresent: () => Boolean(SourceAdapters.findYouTubeCard(document, videoId)),
      platformLabel: "YouTube",
      allowAlreadyMissing: options.allowAlreadyMissing === true
    });
  }

  async function findVideoCard(videoId) {
    return SourceAdapters.findWhileScrolling(
      () => SourceAdapters.findYouTubeCard(document, videoId),
      SourceAdapters.pageScrollEnvironment(window, document)
    );
  }

  const adapter = { platform: "youtube", label: "YouTube 稍后观看", readySelector: "ytd-playlist-video-renderer, a[href*='/watch?v=']", accountReadySelector: SourceAdapters.OWNER_SELECTOR, identifyAccount, scan, removeVideo };
  WLWCollectorRuntime.start(adapter);
  WLWSourceActionRuntime.start(adapter);

})();
