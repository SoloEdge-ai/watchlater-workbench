importScripts("core.js", "db.js", "service.js");

chrome.runtime.onInstalled.addListener(() => WLWService.ensureMigrated());
chrome.runtime.onStartup.addListener(() => WLWService.ensureMigrated());

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  WLWService.handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
  return true;
});
