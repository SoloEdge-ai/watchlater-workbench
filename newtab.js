const PAGE_SIZE = 60;
const SOURCE_ACTION_STATES = WLWSourceActions.STATES;
const state = { settings: null, syncStatus: {}, sourceBindings: {}, sourceActionStatus: {}, pendingArchive: null, query: { offset: 0, limit: PAGE_SIZE, platform: "all", category: "all", tag: "all", rating: "", duration: "all", status: "current", sort: "priority", search: "" }, items: [], total: 0, nextOffset: null, facets: { categories: [], tags: [] }, selected: new Set() };
let searchTimer;
let libraryRequestId = 0;

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  const settingsResult = await send({ type: "GET_SETTINGS" });
  if (!settingsResult.ok) return toast(settingsResult.error, true);
  state.settings = settingsResult.settings;
  state.syncStatus = settingsResult.syncStatus || {};
  state.sourceBindings = settingsResult.sourceBindings || {};
  state.sourceActionStatus = settingsResult.sourceActionStatus || {};
  document.getElementById("reloadExtension").classList.toggle("hidden", !state.settings.developerMode);
  renderSyncStatus();
  await loadLibrary(true);
}

function bindEvents() {
  document.getElementById("settingsButton").addEventListener("click", () => chrome.runtime.openOptionsPage());
  document.getElementById("reloadExtension").addEventListener("click", async () => {
    toast("正在重新读取本地扩展代码…");
    const result = await send({ type: "RELOAD_EXTENSION" });
    if (!result.ok) toast(result.error, true);
  });
  document.getElementById("webSearch").addEventListener("submit", (event) => {
    event.preventDefault();
    const query = document.getElementById("webQuery").value.trim();
    if (!query) return;
    const engines = { google: "https://www.google.com/search?q=", bing: "https://www.bing.com/search?q=", baidu: "https://www.baidu.com/s?wd=" };
    location.href = `${engines[state.settings?.searchEngine || "google"]}${encodeURIComponent(query)}`;
  });
  for (const button of document.querySelectorAll("[data-sync]")) button.addEventListener("click", () => startSync(button.dataset.sync));
  document.getElementById("librarySearch").addEventListener("input", (event) => {
    clearTimeout(searchTimer); searchTimer = setTimeout(() => { state.query.search = event.target.value.trim(); loadLibrary(true); }, 250);
  });
  const mappings = { platformFilter: "platform", categoryFilter: "category", tagFilter: "tag", ratingFilter: "rating", durationFilter: "duration", statusFilter: "status", sortFilter: "sort" };
  for (const [id, key] of Object.entries(mappings)) document.getElementById(id).addEventListener("change", (event) => { state.query[key] = event.target.value; loadLibrary(true); });
  document.getElementById("loadMore").addEventListener("click", () => loadLibrary(false));
  document.getElementById("aiClassify").addEventListener("click", classifyWithAi);
  document.getElementById("exportJson").addEventListener("click", exportJson);
  document.getElementById("exportCsv").addEventListener("click", exportCsv);
  document.getElementById("archiveLocalOnly").addEventListener("click", archiveLocalOnly);
  document.getElementById("archiveFromSource").addEventListener("click", archiveFromSource);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.wlwSyncStatus) { state.syncStatus = changes.wlwSyncStatus.newValue || {}; renderSyncStatus(); }
    if (area === "local" && changes.wlwSourceBindings) state.sourceBindings = changes.wlwSourceBindings.newValue || {};
    if (area === "local" && changes.wlwSourceActionStatus) {
      state.sourceActionStatus = changes.wlwSourceActionStatus.newValue || {};
      loadLibrary(true);
    }
    if (area === "local" && changes.wlwDeveloperMode) document.getElementById("reloadExtension").classList.toggle("hidden", !changes.wlwDeveloperMode.newValue);
  });
}

async function startSync(platform) {
  const result = await send({ type: "START_SOURCE_SYNC", platform });
  if (!result.ok) toast(result.error, true);
}

async function loadLibrary(reset) {
  const requestId = ++libraryRequestId;
  if (reset) { state.query.offset = 0; state.items = []; state.selected.clear(); }
  else if (state.nextOffset !== null) state.query.offset = state.nextOffset;
  else return;
  const result = await send({ type: "GET_LIBRARY", query: state.query });
  if (requestId !== libraryRequestId) return;
  if (!result.ok) return toast(result.error, true);
  state.lastBatch = result.items; state.items.push(...result.items); state.total = result.total; state.nextOffset = result.nextOffset; state.facets = result.facets;
  renderStats(result.stats); renderFacets(); renderVideos(reset);
}

function renderStats(stats) {
  document.getElementById("currentCount").textContent = stats.current;
  document.getElementById("biliCount").textContent = stats.bilibili;
  document.getElementById("youtubeCount").textContent = stats.youtube;
  document.getElementById("archiveCount").textContent = stats.archived;
  document.getElementById("resultCount").textContent = `${state.total} 个结果`;
}

function renderSyncStatus() {
  setSyncText("biliSyncStatus", state.syncStatus.bilibili);
  setSyncText("youtubeSyncStatus", state.syncStatus.youtube);
}

function setSyncText(id, status) {
  const node = document.getElementById(id);
  if (status?.state === "error") { node.textContent = `同步失败 · ${status.error || "请重试"}`; return; }
  if (!status?.lastSyncAt) node.textContent = status?.state === "collecting" ? `同步中 · 已收集 ${status.count || 0} 条` : "尚未完整同步";
  else node.textContent = `${formatRelative(status.lastSyncAt)} · ${status.count || 0} 条`;
}

function renderFacets() {
  updateSelect("categoryFilter", "全部分类", state.facets.categories, state.query.category);
  updateSelect("tagFilter", "全部标签", state.facets.tags, state.query.tag);
}

function updateSelect(id, firstLabel, values, selected) {
  const select = document.getElementById(id); select.replaceChildren(new Option(firstLabel, "all"));
  for (const item of values) select.append(new Option(`${item.name} (${item.count})`, item.name));
  select.value = [...select.options].some((option) => option.value === selected) ? selected : "all";
}

function renderVideos(reset) {
  const grid = document.getElementById("videoGrid");
  if (reset) grid.replaceChildren();
  for (const item of (reset ? state.items : state.lastBatch)) grid.append(createCard(item));
  document.getElementById("emptyState").classList.toggle("hidden", state.total !== 0);
  document.getElementById("loadMore").classList.toggle("hidden", state.nextOffset === null);
}

function createCard(item) {
  const card = el("article", "video-card");
  const thumb = el("div", "thumb-wrap");
  const image = document.createElement("img"); image.loading = "lazy"; image.referrerPolicy = "no-referrer"; image.alt = ""; image.src = item.thumbnailUrl || fallbackThumbnail(item.platform);
  image.addEventListener("error", () => { image.src = fallbackThumbnail(item.platform); });
  const thumbLink = document.createElement("a"); thumbLink.className = "thumb-link"; thumbLink.href = item.url; thumbLink.target = "_blank"; thumbLink.rel = "noopener noreferrer"; thumbLink.title = item.title; thumbLink.append(image);
  thumb.append(thumbLink, textNode("span", "platform-badge", item.platform === "bilibili" ? "B站" : "YouTube"), textNode("span", "score-badge", String(item.priorityScore ?? 50)));
  if (item.durationSeconds) thumb.append(textNode("span", "duration-badge", formatDuration(item.durationSeconds)));
  const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.className = "select-video"; checkbox.checked = state.selected.has(item.id);
  checkbox.addEventListener("change", () => checkbox.checked ? state.selected.add(item.id) : state.selected.delete(item.id)); thumb.append(checkbox);
  const progress = el("div", "progress-track"); const fill = document.createElement("span"); fill.style.width = `${Math.min(100, item.durationSeconds ? (item.progressSeconds || 0) / item.durationSeconds * 100 : 0)}%`; progress.append(fill);
  const body = el("div", "card-body");
  const title = textNode("a", "card-title", item.title); title.href = item.url; title.target = "_blank"; title.rel = "noopener noreferrer"; title.title = item.title;
  const creator = textNode("p", "creator", item.creator || "未知作者");
  const meta = el("div", "meta-row"); meta.append(textNode("span", "chip primary", item.category || "待分类"));
  for (const tag of (item.tags || []).filter((tag) => tag !== item.category).slice(0, 2)) meta.append(textNode("span", "chip", tag));
  const editTags = textNode("button", "chip", "＋标签"); editTags.title = "编辑手动标签"; editTags.addEventListener("click", async () => {
    const value = prompt("手动标签，用逗号分隔", (item.manualTags || []).join(", ")); if (value === null) return;
    await updateMeta(item.id, { manualTags: value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean) });
  }); meta.append(editTags);
  const ratingRow = el("div", "rating-row"); const stars = el("div", "stars");
  for (let rating = 1; rating <= 5; rating += 1) {
    const star = textNode("button", `star${Number(item.rating || 0) >= rating ? " active" : ""}`, "★"); star.title = `${rating} 星想看程度`;
    star.addEventListener("click", async () => { await updateMeta(item.id, { rating: item.rating === rating ? null : rating }); }); stars.append(star);
  }
  const category = document.createElement("select"); category.className = "category-edit"; category.append(new Option("自动分类", ""));
  for (const rule of state.settings.rules) category.append(new Option(rule.name, rule.name)); category.value = item.manualCategory || "";
  category.addEventListener("change", () => updateMeta(item.id, { manualCategory: category.value }));
  const actionStatus = state.sourceActionStatus[item.platform];
  const recoveryError = actionStatus?.recordId === item.id && actionStatus.state === SOURCE_ACTION_STATES.PLATFORM_SUCCEEDED ? actionStatus.error || "平台已移除，本地归档正在恢复" : "";
  const actionFailure = actionStatus?.recordId === item.id && actionStatus.state === SOURCE_ACTION_STATES.FAILED ? actionStatus.error : "";
  const removalFailed = Boolean(actionFailure || (item.sourceRemovalState === SOURCE_ACTION_STATES.FAILED && item.sourceRemovalError));
  const removalError = recoveryError
    ? textNode("p", "source-removal-error recovery", recoveryError)
    : removalFailed
      ? textNode("p", "source-removal-error", `平台移除失败：${actionFailure || item.sourceRemovalError}`)
      : null;
  const archiveButton = textNode("button", "archive-button", item.status === "archived" ? "恢复到工作台" : removalFailed ? "重试移出" : "移出工作台");
  archiveButton.addEventListener("click", async () => {
    if (item.status === "archived") return updateMeta(item.id, { status: "current" });
    openArchiveDialog(item);
  });
  ratingRow.append(stars, category); body.append(title, creator, meta, ratingRow); if (removalError) body.append(removalError); body.append(archiveButton); card.append(thumb, progress, body); return card;
}

function openArchiveDialog(item) {
  state.pendingArchive = item;
  const binding = state.sourceBindings[item.platform];
  const platformName = item.platform === "bilibili" ? "B站" : "YouTube";
  const sourceButton = document.getElementById("archiveFromSource");
  document.getElementById("archiveVideoTitle").textContent = item.title;
  sourceButton.textContent = binding ? `同时从 ${platformName} · ${binding.name || binding.id} 移除` : `同时从 ${platformName} 移除`;
  const matched = Boolean(binding && item.sourceAccountId && binding.id === item.sourceAccountId);
  sourceButton.disabled = !matched;
  document.getElementById("archiveSourceHint").textContent = matched
    ? "平台页面会在可见标签页中打开；只有确认视频消失后，本地才会归档。"
    : "平台删除不可用：请先使用当前账号完成一次全量同步。";
  document.getElementById("archiveDialog").showModal();
}

async function archiveLocalOnly() {
  const item = state.pendingArchive;
  document.getElementById("archiveDialog").close();
  if (!item) return;
  await updateMeta(item.id, { status: "archived" });
}

async function archiveFromSource() {
  const item = state.pendingArchive;
  const button = document.getElementById("archiveFromSource");
  if (!item || button.disabled) return;
  button.disabled = true;
  const result = await send({ type: "START_SOURCE_REMOVE", id: item.id });
  document.getElementById("archiveDialog").close();
  if (!result.ok) return toast(result.error, true);
  toast("已打开平台页面；验证账号后将只移除这一条视频");
  await loadLibrary(true);
}

async function updateMeta(id, patch) {
  const result = await send({ type: "UPDATE_USER_META", id, patch });
  if (!result.ok) return toast(result.error, true);
  await loadLibrary(true);
}

async function classifyWithAi() {
  let ids = [...state.selected];
  if (!ids.length) {
    const unclassified = await send({ type: "GET_LIBRARY", query: { status: "current", category: "待分类", offset: 0, limit: 5000 } });
    if (!unclassified.ok) return toast(unclassified.error, true);
    ids = unclassified.items.map((item) => item.id);
  }
  if (!ids.length) return toast("请先勾选视频，或筛选出待分类项目");
  if (!confirm(`将向已配置的模型发送 ${ids.length} 条视频元数据，继续吗？`)) return;
  toast(`正在分类 ${ids.length} 条视频…`);
  const result = await send({ type: "AI_CLASSIFY", ids });
  if (!result.ok) return toast(result.error, true);
  toast(`AI 已更新 ${result.updated} 条视频`); await loadLibrary(true);
}

async function exportJson() {
  const result = await send({ type: "EXPORT_LIBRARY" }); if (!result.ok) return toast(result.error, true);
  download(JSON.stringify(result.payload, null, 2), `watchboard-${dateStamp()}.json`, "application/json");
}

async function exportCsv() {
  const result = await send({ type: "GET_LIBRARY", query: { ...state.query, offset: 0, limit: 5000 } }); if (!result.ok) return toast(result.error, true);
  const columns = ["platform", "title", "creator", "category", "tags", "rating", "priorityScore", "durationSeconds", "status", "url"];
  const rows = [columns, ...result.items.map((item) => columns.map((key) => key === "tags" ? (item.tags || []).join("|") : item[key] ?? ""))];
  download("\uFEFF" + rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n"), `watchboard-${dateStamp()}.csv`, "text/csv;charset=utf-8");
}

function download(content, filename, type) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function send(payload) { return chrome.runtime.sendMessage(payload).catch((error) => ({ ok: false, error: String(error?.message || error) })); }
function el(tag, className) { const node = document.createElement(tag); node.className = className; return node; }
function textNode(tag, className, text) { const node = el(tag, className); node.textContent = text; return node; }
function formatDuration(seconds) { const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60; return h ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${m}:${String(s).padStart(2,"0")}`; }
function formatRelative(timestamp) { const minutes = Math.round((Date.now() - timestamp) / 60000); if (minutes < 2) return "刚刚同步"; if (minutes < 60) return `${minutes} 分钟前`; const hours = Math.round(minutes / 60); if (hours < 24) return `${hours} 小时前`; return new Date(timestamp).toLocaleDateString("zh-CN"); }
function fallbackThumbnail(platform) { return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="640" height="360" fill="${platform === "bilibili" ? "#fb7299" : "#20242b"}"/><text x="320" y="195" text-anchor="middle" font-size="56" fill="white" font-family="sans-serif">${platform === "bilibili" ? "Bilibili" : "YouTube"}</text></svg>`)}`; }
function toast(message, error = false) { const node = document.getElementById("toast"); node.textContent = message; node.className = `toast${error ? " error" : ""}`; clearTimeout(toast.timer); toast.timer = setTimeout(() => node.classList.add("hidden"), 4200); }
function dateStamp() { return new Date().toISOString().slice(0, 10); }
