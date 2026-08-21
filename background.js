importScripts("core.js", "db.js", "collectors.js", "source-accounts.js", "source-actions.js", "service.js");

chrome.runtime.onInstalled.addListener(() => WLWService.reconcileSourceActions(true));
chrome.runtime.onStartup.addListener(() => WLWService.reconcileSourceActions(true));
chrome.tabs.onRemoved.addListener((tabId) => WLWService.handleTabRemoved(tabId).catch(() => {}));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  WLWService.reconcileSourceActions()
    .then(() => WLWService.handleMessage(message, sender))
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});
