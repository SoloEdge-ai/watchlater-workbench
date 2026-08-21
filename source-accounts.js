(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WLWSourceAccounts = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function normalizeAccount(platform, value) {
    const rawId = clean(value?.id);
    let id = "";
    if (platform === "bilibili" && /^mid:\d+$/.test(rawId)) id = rawId;
    if (platform === "youtube" && /^channel:UC[0-9A-Za-z_-]+$/.test(rawId)) id = rawId;
    if (platform === "youtube" && /^handle:@[0-9A-Za-z._-]+$/i.test(rawId)) id = rawId.toLocaleLowerCase();
    if (!id) return null;
    return { platform, id, name: clean(value?.name), url: clean(value?.url) };
  }

  function accountsMatch(left, right) {
    return Boolean(left && right && left.platform === right.platform && left.id === right.id);
  }

  return { normalizeAccount, accountsMatch };
});
