document.getElementById("dashboard").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html") }));
document.getElementById("settings").addEventListener("click", () => chrome.runtime.openOptionsPage());
document.getElementById("reloadExtension").addEventListener("click", () => {
  document.getElementById("status").textContent = "正在重新读取本地代码…";
  setTimeout(() => chrome.runtime.reload(), 180);
});
for (const button of document.querySelectorAll("[data-sync]")) button.addEventListener("click", async () => {
  const result = await chrome.runtime.sendMessage({ type: "START_SOURCE_SYNC", platform: button.dataset.sync });
  document.getElementById("status").textContent = result.ok ? "已打开同步页面" : result.error;
});

chrome.runtime.sendMessage({ type: "GET_SETTINGS" }).then((result) => {
  if (!result.ok || !result.settings.developerMode) return;
  document.getElementById("developerActions").hidden = false;
  document.getElementById("developerInfo").textContent = `v${chrome.runtime.getManifest().version} · ${chrome.runtime.id}`;
});
