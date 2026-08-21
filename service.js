(function (root, factory) {
  root.WLWService = factory(root.WLWCore, root.WLWDatabase);
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core, DB) {
  "use strict";

  const { sanitizeRules, mergeVideoRecord, enrichVideo, clean } = Core;
  const SYNC_URLS = {
    bilibili: "https://www.bilibili.com/watchlater/list#/list",
    youtube: "https://www.youtube.com/playlist?list=WL"
  };
  const SYNC_PATTERNS = {
    bilibili: ["https://www.bilibili.com/watchlater/*"],
    youtube: ["https://www.youtube.com/playlist?list=WL*", "https://youtube.com/playlist?list=WL*"]
  };
  const CACHE_KEY = "bwcMetadataCache";
  let migrationPromise;

  async function handleMessage(message, sender) {
    await ensureMigrated();
    switch (message?.type) {
      case "START_SOURCE_SYNC": return startSourceSync(message.platform);
      case "GET_PENDING_SYNC": return claimPendingSync(message.platform, sender.tab?.id);
      case "SOURCE_SYNC_UPSERT": return upsertSourceItems(message.platform, message.sessionId, message.items || []);
      case "SOURCE_SYNC_COMPLETE": return completeSourceSync(message.platform, message.sessionId, message.seenIds || []);
      case "GET_LIBRARY": return getLibrary(message.query || {});
      case "UPDATE_USER_META": return updateUserMeta(message.id, message.patch || {});
      case "FETCH_BILI_METADATA": return { data: await fetchBiliMetadata(message.bvid) };
      case "GET_SETTINGS": return getSettings();
      case "SAVE_SETTINGS": return saveSettings(message.settings || {});
      case "AI_CLASSIFY": return aiClassify(message.ids || []);
      case "EXPORT_LIBRARY": return exportLibrary();
      case "IMPORT_LIBRARY": return importLibrary(message.payload);
      case "CLEAR_LIBRARY": await DB.clearAll(); return { cleared: true };
      default: throw new Error("未知消息类型");
    }
  }

  async function getSettings() {
    const stored = await chrome.storage.local.get(["wlwRules", "wlwSearchEngine", "wlwAi", "wlwSyncStatus"]);
    return {
      settings: {
        rules: sanitizeRules(stored.wlwRules),
        searchEngine: stored.wlwSearchEngine || "google",
        ai: stored.wlwAi || { enabled: false, baseUrl: "https://api.openai.com/v1", model: "gpt-5-mini", apiKey: "" }
      },
      syncStatus: stored.wlwSyncStatus || {}
    };
  }

  async function saveSettings(settings) {
    const current = await getSettings();
    const next = {
      rules: settings.rules ? sanitizeRules(settings.rules) : current.settings.rules,
      searchEngine: ["google", "bing", "baidu"].includes(settings.searchEngine) ? settings.searchEngine : current.settings.searchEngine,
      ai: sanitizeAiSettings(settings.ai || current.settings.ai)
    };
    await chrome.storage.local.set({ wlwRules: next.rules, wlwSearchEngine: next.searchEngine, wlwAi: next.ai });
    const all = await DB.getAllVideos();
    await DB.putVideos(all.map((item) => enrichVideo(item, next.rules)));
    return { settings: next };
  }

  function sanitizeAiSettings(value) {
    let url;
    try { url = new URL(String(value.baseUrl || "")); } catch { throw new Error("AI Base URL 无效"); }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("AI 接口必须使用 HTTPS，本机 localhost 除外");
    return { enabled: Boolean(value.enabled), baseUrl: url.href.replace(/\/$/, ""), model: clean(value.model), apiKey: String(value.apiKey || "") };
  }

  async function startSourceSync(platform) {
    if (!SYNC_URLS[platform]) throw new Error("不支持的平台");
    const sessionId = `${platform}:${Date.now()}:${crypto.randomUUID()}`;
    const pending = { platform, sessionId, createdAt: Date.now(), state: "opening", count: 0 };
    await chrome.storage.local.set({ [`wlwPendingSync_${platform}`]: pending });
    await updateSyncStatus(platform, { state: "opening", sessionId, startedAt: Date.now(), count: 0, error: "" });
    const tabs = await chrome.tabs.query({ url: SYNC_PATTERNS[platform] });
    let tab;
    if (tabs[0]) {
      tab = await chrome.tabs.update(tabs[0].id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      try { await chrome.tabs.reload(tab.id); } catch {}
    } else {
      tab = await chrome.tabs.create({ url: SYNC_URLS[platform], active: true });
    }
    return { sessionId, tabId: tab.id };
  }

  async function claimPendingSync(platform, tabId) {
    const key = `wlwPendingSync_${platform}`;
    const stored = await chrome.storage.local.get(key);
    const pending = stored[key];
    if (!pending || Date.now() - pending.createdAt > 10 * 60 * 1000) return { pending: null };
    const claimed = { ...pending, state: "collecting", tabId, claimedAt: Date.now() };
    await chrome.storage.local.set({ [key]: claimed });
    await updateSyncStatus(platform, { state: "collecting", sessionId: claimed.sessionId, startedAt: claimed.createdAt, count: 0, error: "" });
    return { pending: claimed };
  }

  async function upsertSourceItems(platform, sessionId, items) {
    if (!SYNC_URLS[platform]) throw new Error("不支持的平台");
    const rules = await getRules();
    const now = Date.now();
    const normalized = [];
    const batch = items.slice(0, 100);
    const existingById = new Map((await DB.getVideos(batch.map((item) => item.id).filter(Boolean))).map((item) => [item.id, item]));
    for (const incoming of batch) {
      if (incoming.platform !== platform || !incoming.id?.startsWith(`${platform}:`)) continue;
      const existing = existingById.get(incoming.id);
      normalized.push(enrichVideo(mergeVideoRecord(existing, incoming, now), rules, now));
    }
    await DB.putVideos(normalized);
    if (sessionId) await updateSyncStatus(platform, { state: "collecting", sessionId, countDelta: normalized.length });
    return { upserted: normalized.length };
  }

  async function completeSourceSync(platform, sessionId, seenIds) {
    const key = `wlwPendingSync_${platform}`;
    const pending = (await chrome.storage.local.get(key))[key];
    if (!pending || pending.sessionId !== sessionId) throw new Error("同步会话已失效，未执行归档");
    const ids = [...new Set(seenIds.filter((id) => id.startsWith(`${platform}:`)))];
    if (!ids.length) throw new Error("同步结果为空，未执行归档");
    await DB.completeSnapshot(platform, sessionId, ids);
    await chrome.storage.local.remove(key);
    await updateSyncStatus(platform, { state: "complete", sessionId, count: ids.length, lastSyncAt: Date.now(), error: "" });
    return { completed: true, count: ids.length };
  }

  async function updateSyncStatus(platform, patch) {
    const stored = await chrome.storage.local.get("wlwSyncStatus");
    const status = stored.wlwSyncStatus || {};
    const previous = status[platform] || {};
    const count = patch.countDelta ? Number(previous.count || 0) + patch.countDelta : (patch.count ?? previous.count ?? 0);
    status[platform] = { ...previous, ...patch, count };
    delete status[platform].countDelta;
    await chrome.storage.local.set({ wlwSyncStatus: status });
  }

  async function getLibrary(query) {
    const all = await DB.getAllVideos();
    const search = clean(query.search).toLocaleLowerCase();
    const status = query.status || "current";
    const filtered = all.filter((item) => {
      if (status !== "all" && item.status !== status) return false;
      if (query.platform && query.platform !== "all" && item.platform !== query.platform) return false;
      if (query.category && query.category !== "all" && item.category !== query.category) return false;
      if (query.tag && query.tag !== "all" && !(item.tags || []).includes(query.tag)) return false;
      if (query.rating && Number(item.rating || 0) < Number(query.rating)) return false;
      if (query.duration === "short" && Number(item.durationSeconds || Infinity) > 20 * 60) return false;
      if (query.duration === "medium" && (Number(item.durationSeconds || 0) <= 20 * 60 || Number(item.durationSeconds || Infinity) > 60 * 60)) return false;
      if (query.duration === "long" && Number(item.durationSeconds || 0) <= 60 * 60) return false;
      if (search && !`${item.title || ""} ${item.creator || ""} ${item.category || ""} ${(item.tags || []).join(" ")}`.toLocaleLowerCase().includes(search)) return false;
      return true;
    });
    const sort = query.sort || "priority";
    filtered.sort((a, b) => compareVideos(a, b, sort));
    const offset = Math.max(0, Number(query.offset || 0));
    const limit = Math.min(5000, Math.max(1, Number(query.limit || 60)));
    const current = all.filter((item) => item.status === "current");
    return {
      items: filtered.slice(offset, offset + limit), total: filtered.length, nextOffset: offset + limit < filtered.length ? offset + limit : null,
      facets: { categories: countValues(current.map((item) => item.category || "待分类")), tags: countValues(current.flatMap((item) => item.tags || [])) },
      stats: { total: all.length, current: current.length, archived: all.length - current.length, bilibili: current.filter((i) => i.platform === "bilibili").length, youtube: current.filter((i) => i.platform === "youtube").length }
    };
  }

  function compareVideos(a, b, sort) {
    const recent = () => Number(b.addedAt || b.firstSeenAt || 0) - Number(a.addedAt || a.firstSeenAt || 0);
    if (sort === "rating") return Number(b.rating || 0) - Number(a.rating || 0) || recent();
    if (sort === "recent") return recent();
    if (sort === "duration") return Number(a.durationSeconds || Infinity) - Number(b.durationSeconds || Infinity);
    return Number(b.priorityScore || 0) - Number(a.priorityScore || 0) || recent();
  }

  function countValues(values) {
    const counts = values.reduce((acc, value) => { if (value) acc[value] = (acc[value] || 0) + 1; return acc; }, {});
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
  }

  async function updateUserMeta(id, patch) {
    const existing = await DB.getVideo(id);
    if (!existing) throw new Error("视频不存在");
    const allowed = {};
    if (patch.rating === null || (Number.isInteger(patch.rating) && patch.rating >= 1 && patch.rating <= 5)) allowed.rating = patch.rating;
    if (Object.prototype.hasOwnProperty.call(patch, "manualCategory")) allowed.manualCategory = clean(patch.manualCategory);
    if (Array.isArray(patch.manualTags)) allowed.manualTags = patch.manualTags.map(clean).filter(Boolean).slice(0, 12);
    if (["current", "archived"].includes(patch.status)) allowed.status = patch.status;
    const item = enrichVideo({ ...existing, ...allowed }, await getRules());
    await DB.putVideos([item]);
    return { item };
  }

  async function getRules() {
    return sanitizeRules((await chrome.storage.local.get("wlwRules")).wlwRules);
  }

  async function ensureMigrated() {
    if (migrationPromise) return migrationPromise;
    migrationPromise = (async () => {
      const stored = await chrome.storage.local.get(["wlwMigratedV1", "bwcLastSnapshot", "bwcRules"]);
      if (stored.wlwMigratedV1) return;
      const rules = sanitizeRules(stored.bwcRules);
      const now = Date.now();
      const oldItems = Array.isArray(stored.bwcLastSnapshot) ? stored.bwcLastSnapshot.map((item) => {
        const videoId = item.bvid || item.videoId;
        if (!videoId) return null;
        return enrichVideo({
          id: `bilibili:${videoId}`, platform: "bilibili", videoId,
          url: item.url || `https://www.bilibili.com/video/${videoId}`, title: item.title || videoId,
          creator: item.author || "", durationSeconds: item.durationSeconds || null, durationText: item.durationText || "",
          nativeCategory: item.nativeCategory || "", addedAt: item.discoveredAt || null,
          firstSeenAt: item.discoveredAt || now, lastSeenAt: now, status: "current"
        }, rules, now);
      }).filter(Boolean) : [];
      await DB.putVideos(oldItems);
      await chrome.storage.local.set({ wlwMigratedV1: true, wlwRules: rules });
    })();
    return migrationPromise;
  }

  async function fetchBiliMetadata(bvid) {
    if (!/^BV[0-9A-Za-z]+$/.test(bvid || "")) throw new Error("BV 号无效");
    const cache = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] || {};
    if (cache[bvid] && Date.now() - cache[bvid].cachedAt < 14 * 86400000) return cache[bvid];
    const response = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, { credentials: "omit" });
    if (!response.ok) throw new Error(`B站元数据请求失败 (${response.status})`);
    const body = await response.json();
    if (body.code !== 0 || !body.data) throw new Error(body.message || "未取得视频元数据");
    const data = { title: body.data.title || "", creator: body.data.owner?.name || "", nativeCategory: body.data.tname || "", durationSeconds: body.data.duration || null, publishedAt: body.data.pubdate ? body.data.pubdate * 1000 : null, thumbnailUrl: body.data.pic || "", cachedAt: Date.now() };
    const latest = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] || {};
    latest[bvid] = data;
    await chrome.storage.local.set({ [CACHE_KEY]: latest });
    return data;
  }

  async function aiClassify(ids) {
    const { settings } = await getSettings();
    const ai = settings.ai;
    if (!ai.enabled || !ai.apiKey || !ai.model) throw new Error("请先在设置中启用并配置 AI");
    const items = await DB.getVideos([...new Set(ids)].slice(0, 500));
    let updated = 0;
    for (let index = 0; index < items.length; index += 20) {
      const batch = items.slice(index, index + 20);
      const results = await requestAiBatch(ai, batch, settings.rules);
      const byId = new Map(results.map((item) => [item.id, item]));
      const changed = batch.map((item) => {
        const result = byId.get(item.id);
        if (!result) return item;
        updated += 1;
        return enrichVideo({ ...item, aiCategory: result.primaryCategory, aiTags: (result.tags || []).map(clean).filter(Boolean).slice(0, 5), aiConfidence: Number(result.confidence || 0) }, settings.rules);
      });
      await DB.putVideos(changed);
    }
    return { updated };
  }

  async function requestAiBatch(ai, items, rules) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    try {
      const response = await fetch(`${ai.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${ai.apiKey}` },
        body: JSON.stringify({ model: ai.model, temperature: 0, messages: [
          { role: "system", content: `你是视频分类器。主分类必须从以下列表选择：${rules.map((r) => r.name).join("、")}。只返回 JSON：{\"items\":[{\"id\":\"...\",\"primaryCategory\":\"...\",\"tags\":[最多5个],\"confidence\":0到1}]}` },
          { role: "user", content: JSON.stringify(items.map((item) => ({ id: item.id, title: item.title, creator: item.creator, platform: item.platform, nativeCategory: item.nativeCategory, durationSeconds: item.durationSeconds }))) }
        ] })
      });
      if (!response.ok) throw new Error(`AI 请求失败 (${response.status})`);
      const content = (await response.json()).choices?.[0]?.message?.content;
      if (!content) throw new Error("AI 未返回分类内容");
      const parsed = JSON.parse(content.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
      const allowed = new Set(rules.map((rule) => rule.name));
      return (Array.isArray(parsed.items) ? parsed.items : []).filter((item) => item?.id && allowed.has(item.primaryCategory));
    } finally { clearTimeout(timeout); }
  }

  async function exportLibrary() {
    const items = await DB.getAllVideos();
    const { settings, syncStatus } = await getSettings();
    return { payload: { version: 1, exportedAt: Date.now(), items, settings: { rules: settings.rules, searchEngine: settings.searchEngine, ai: { enabled: false, baseUrl: settings.ai.baseUrl, model: settings.ai.model, apiKey: "" } }, syncStatus } };
  }

  async function importLibrary(payload) {
    if (payload?.version !== 1 || !Array.isArray(payload.items)) throw new Error("备份文件格式不受支持");
    const rules = sanitizeRules(payload.settings?.rules);
    const now = Date.now();
    const existing = new Map((await DB.getAllVideos()).map((item) => [item.id, item]));
    const items = payload.items.filter((item) => item?.id && item?.platform && item?.videoId).map((item) => enrichVideo(mergeVideoRecord(existing.get(item.id), item, now), rules, now));
    await DB.putVideos(items);
    await chrome.storage.local.set({ wlwRules: rules, wlwSearchEngine: payload.settings?.searchEngine || "google" });
    return { imported: items.length };
  }

  return { handleMessage, ensureMigrated, getLibrary, updateUserMeta, completeSourceSync };
});
