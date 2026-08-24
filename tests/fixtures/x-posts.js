function xPostFixture({ id, handle = "author", name = "Author", body, mediaUrls = [], hasVideo = false, quotedText = "", quotedCreator = "Quoted", cardText = "" }) {
  const statusLink = { getAttribute: () => `/${handle}/status/${id}` };
  const time = { getAttribute: () => "2026-08-23T00:00:00.000Z", closest: () => statusLink };
  const user = (displayName, userHandle) => ({ querySelectorAll: () => [
    { textContent: displayName },
    { textContent: `@${userHandle}` }
  ] });
  let article;
  const quotedArticle = { parentElement: { closest: () => article } };
  const videoNodes = hasVideo ? [{ closest: () => article }] : [];
  const texts = [{ textContent: body, closest: () => article }];
  const users = [user(name, handle)];
  users[0].closest = () => article;
  if (quotedText) {
    texts.push({ textContent: quotedText, closest: () => quotedArticle });
    const quotedUser = user(quotedCreator, "quoted");
    quotedUser.closest = () => quotedArticle;
    users.push(quotedUser);
  }
  const images = mediaUrls.map((src) => ({ src, getAttribute: () => src }));
  const cards = cardText ? [{ textContent: cardText, innerText: cardText, closest: () => article }] : [];
  article = {
    parentElement: { closest: () => null },
    innerText: [name, `@${handle}`, body, quotedText].filter(Boolean).join(" "),
    querySelector: (selector) => selector === "time" ? time : selector.includes("tweetText") ? texts[0] : hasVideo && selector.includes("video") ? {} : null,
    querySelectorAll: (selector) => {
      if (selector.includes("tweetText")) return texts;
      if (selector.includes("User-Name")) return users;
      if (selector.includes("card.wrapper") || selector.includes("card.layout")) return cards;
      if (selector.includes("video")) return videoNodes;
      if (selector === "img") return images;
      return [];
    }
  };
  return article;
}

const fixtures = {
  ordinary: { id: "1001", body: "A plain bookmarked post" },
  image: { id: "1002", body: "A post with an image", mediaUrls: ["https://pbs.twimg.com/media/example.jpg"] },
  video: { id: "1003", body: "A post with video", mediaUrls: ["https://pbs.twimg.com/amplify_video_thumb/1003/img/cover.jpg"], hasVideo: true },
  article: { id: "1004", body: "A new X Article", cardText: "Long-form article summary from the card" },
  external: { id: "1005", body: "External resource", cardText: "Example story · https://example.com/story" },
  quoted: { id: "1006", body: "Commentary on a quoted post", quotedText: "The quoted post text", quotedCreator: "Quoted Author" }
};

module.exports = { xPostFixture, fixtures };
