(function (root, factory) {
  root.WLWService = factory(root.WLWCore, root.WLWDatabase, root.WLWCollectors, root.WLWSourceAccounts, root.WLWSourceActions);
})(typeof globalThis !== "undefined" ? globalThis : this, function (Core, DB, Collectors, Accounts, SourceActions) {
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
  const withWriteLock = Core.createSerialQueue();
  let migrationPromise;
  let sourceActionCoordinator;
  let sourceActionsInitialized = false;
  let sourceReconcileTail = Promise.resolve();

  function getSourceActionCoordinator() {
    if (!sourceActionCoordinator) sourceActionCoordinator = SourceActions.createSourceActionCoordinator({
      storage: chrome.storage.local,
      db: DB,
      tabs: chrome.tabs,
      windows: chrome.windows,
      Accounts
    });
    return sourceActionCoordinator;
  }

  async function handleMessage(message, sender) {
    await ensureMigrated();
    switch (message?.type) {
      case "START_SOURCE_SYNC": return startSourceSync(message.platform);
      case "GET_PENDING_SYNC": assertCollectorSender(sender, message.platform); return claimPendingSync(message.platform, sender.tab?.id, message.account, message.confirmBinding === true);
      case "SOURCE_SYNC_UPSERT": assertCollectorSender(sender, message.platform); return upsertSourceItems(message.platform, message.sessionId, message.items || [], sender.tab?.id, message.account);
      case "SOURCE_SYNC_COMPLETE": assertCollectorSender(sender, message.platform); return completeSourceSync(message.platform, message.sessionId, message.seenIds || [], sender.tab?.id, message.allowEmptySnapshot === true, message.account);
      case "SOURCE_SYNC_FAILED": assertCollectorSender(sender, message.platform); return failSourceSync(message.platform, message.sessionId, message.error, sender.tab?.id);
      case "GET_LIBRARY": return getLibrary(message.query || {});
      case "UPDATE_USER_META": return updateUserMeta(message.id, message.patch || {});
      case "START_SOURCE_REMOVE": assertExtensionSender(sender); return getSourceActionCoordinator().start(message.id);
      case "CLAIM_SOURCE_ACTION": assertCollectorSender(sender, message.platform); return getSourceActionCoordinator().claim(message.platform, message.account, sender.tab?.id);
      case "SOURCE_ACTION_COMPLETE": assertCollectorSender(sender, message.platform); return getSourceActionCoordinator().complete(message.platform, message.actionId, sender.tab?.id);
      case "SOURCE_ACTION_FAILED": assertCollectorSender(sender, message.platform); return getSourceActionCoordinator().fail(message.platform, message.actionId, message.error, sender.tab?.id);
      case "FETCH_BILI_METADATA": assertCollectorSender(sender, "bilibili"); return { data: await fetchBiliMetadata(message.bvid) };
      case "FETCH_BILI_WATCH_LATER": assertCollectorSender(sender, "bilibili"); return fetchBiliWatchLater();
      case "FETCH_BILI_ACCOUNT": assertCollectorSender(sender, "bilibili"); return fetchBiliAccount();
      case "GET_SETTINGS": return getSettings();
      case "SAVE_SETTINGS": return saveSettings(message.settings || {});
      case "RELOAD_EXTENSION": return scheduleExtensionReload(sender);
      case "AI_CLASSIFY": return aiClassify(message.ids || []);
      case "EXPORT_LIBRARY": return exportLibrary();
      case "EXPORT_SOURCE_LIBRARY": assertExtensionSender(sender); return exportSourceLibrary(message.platform);
      case "CLEAR_SOURCE_BINDING": assertExtensionSender(sender); return clearSourceBinding(message.platform, message.expectedAccountId);
      default: throw new Error("未知消息类型");
    }
  }

  async function getSettings() {
    const stored = await chrome.storage.local.get(["wlwRules", "wlwSearchEngine", "wlwAi", "wlwDeveloperMode", "wlwSyncStatus", "wlwSourceBindings", "wlwSourceActionStatus"]);
    return {
      settings: {
        rules: sanitizeRules(stored.wlwRules),
        searchEngine: stored.wlwSearchEngine || "google",
        developerMode: Boolean(stored.wlwDeveloperMode),
        ai: stored.wlwAi || { enabled: false, baseUrl: "https://api.openai.com/v1", model: "gpt-5-mini", apiKey: "" }
      },
      syncStatus: stored.wlwSyncStatus || {},
      sourceBindings: stored.wlwSourceBindings || {},
      sourceActionStatus: stored.wlwSourceActionStatus || {}
    };
  }

  async function saveSettings(settings) {
    const current = await getSettings();
    const next = {
      rules: settings.rules ? sanitizeRules(settings.rules) : current.settings.rules,
      searchEngine: ["google", "bing", "baidu"].includes(settings.searchEngine) ? settings.searchEngine : current.settings.searchEngine,
      developerMode: Object.prototype.hasOwnProperty.call(settings, "developerMode") ? Boolean(settings.developerMode) : current.settings.developerMode,
      ai: sanitizeAiSettings(settings.ai || current.settings.ai)
    };
    const rulesChanged = JSON.stringify(next.rules) !== JSON.stringify(current.settings.rules);
    await withWriteLock(async () => {
      await chrome.storage.local.set({ wlwRules: next.rules, wlwSearchEngine: next.searchEngine, wlwDeveloperMode: next.developerMode, wlwAi: next.ai });
      if (rulesChanged) {
        const all = await DB.getAllVideos();
        await DB.putVideos(all.map((item) => enrichVideo(item, next.rules)));
      }
    });
    return { settings: next };
  }

  async function scheduleExtensionReload(sender) {
    if (!String(sender?.url || "").startsWith(chrome.runtime.getURL(""))) throw new Error("只有扩展页面可以执行开发重载");
    const { settings } = await getSettings();
    if (!settings.developerMode) throw new Error("请先在设置中启用开发模式");
    setTimeout(() => chrome.runtime.reload(), 180);
    return { reloading: true };
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
    try {
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
    } catch (error) {
      await chrome.storage.local.remove(`wlwPendingSync_${platform}`);
      await updateSyncStatus(platform, { state: "error", sessionId, error: `无法打开同步页面：${error?.message || error}` });
      throw error;
    }
  }

  async function claimPendingSync(platform, tabId, rawAccount, confirmBinding = false) {
    const key = `wlwPendingSync_${platform}`;
    const stored = await chrome.storage.local.get(key);
    const pending = stored[key];
    const account = Accounts.normalizeAccount(platform, rawAccount);
    if (!account) {
      if (pending) {
        await chrome.storage.local.remove(key);
        await updateSyncStatus(platform, { state: "error", sessionId: pending.sessionId, error: "无法识别当前平台账号，未开始同步" });
      }
      throw new Error("无法识别当前平台账号");
    }
    const bindings = (await chrome.storage.local.get("wlwSourceBindings")).wlwSourceBindings || {};
    const binding = bindings[platform] || null;
    if (binding && !Accounts.accountsMatch(binding, account)) {
      if (pending) {
        await chrome.storage.local.remove(key);
        await updateSyncStatus(platform, { state: "error", sessionId: pending.sessionId, error: `当前账号与已绑定账号 ${binding.name || binding.id} 不一致` });
      }
      throw new Error(`当前账号与已绑定账号 ${binding.name || binding.id} 不一致`);
    }
    if (!pending) return { pending: null, allowIncremental: Boolean(binding), binding };
    if (Date.now() - pending.createdAt > 10 * 60 * 1000) {
      await chrome.storage.local.remove(key);
      await updateSyncStatus(platform, { state: "error", sessionId: pending.sessionId, error: "同步会话已超时，请重试" });
      return { pending: null };
    }
    if (pending.state === "collecting") return { pending: pending.tabId === tabId && Accounts.accountsMatch(pending.account, account) ? pending : null, requiresBinding: false };
    if (pending.state !== "opening") return { pending: null };
    if (!binding && !confirmBinding) return { pending: null, requiresBinding: true, candidate: account, sessionId: pending.sessionId, allowIncremental: false };
    const claimed = { ...pending, state: "collecting", tabId, claimedAt: Date.now(), account };
    await chrome.storage.local.set({ [key]: claimed });
    await updateSyncStatus(platform, { state: "collecting", sessionId: claimed.sessionId, startedAt: claimed.createdAt, count: 0, error: "" });
    return { pending: claimed, requiresBinding: false };
  }

  async function verifySourceWrite(platform, sessionId, tabId, rawAccount) {
    const account = Accounts.normalizeAccount(platform, rawAccount);
    if (!account) throw new Error("无法识别当前平台账号");
    if (sessionId) {
      const pending = (await chrome.storage.local.get(`wlwPendingSync_${platform}`))[`wlwPendingSync_${platform}`];
      if (!pending || pending.sessionId !== sessionId || pending.tabId !== tabId || !Accounts.accountsMatch(pending.account, account)) {
        throw new Error("同步会话或账号已失效，未写入数据");
      }
      return pending.account;
    }
    const binding = ((await chrome.storage.local.get("wlwSourceBindings")).wlwSourceBindings || {})[platform];
    if (!binding || !Accounts.accountsMatch(binding, account)) throw new Error(`当前账号与已绑定账号 ${binding?.name || binding?.id || "未绑定"} 不一致`);
    return binding;
  }

  async function upsertSourceItems(platform, sessionId, items, tabId, rawAccount) {
    if (!SYNC_URLS[platform]) throw new Error("不支持的平台");
    const rules = await getRules();
    const now = Date.now();
    const batch = items.slice(0, 100);
    const normalized = await withWriteLock(async () => {
      const account = await verifySourceWrite(platform, sessionId, tabId, rawAccount);
      const output = [];
      const existingById = new Map((await DB.getVideos(batch.map((item) => item.id).filter(Boolean))).map((item) => [item.id, item]));
      for (const incoming of batch) {
        if (incoming.platform !== platform || !incoming.id?.startsWith(`${platform}:`)) continue;
        output.push(enrichVideo(mergeVideoRecord(existingById.get(incoming.id), { ...incoming, sourceAccountId: account.id, sourceAccountName: account.name }, now), rules, now));
      }
      await DB.putVideos(output);
      return output;
    });
    if (sessionId) await updateSyncStatus(platform, { state: "collecting", sessionId, countDelta: normalized.length });
    return { upserted: normalized.length };
  }

  async function completeSourceSync(platform, sessionId, seenIds, tabId, allowEmptySnapshot = false, rawAccount) {
    return withWriteLock(async () => {
      const account = await verifySourceWrite(platform, sessionId, tabId, rawAccount);
      const key = `wlwPendingSync_${platform}`;
      const pending = (await chrome.storage.local.get(key))[key];
      if (!pending || pending.sessionId !== sessionId || pending.tabId !== tabId) throw new Error("同步会话已失效，未执行归档");
      const ids = [...new Set(seenIds.filter((id) => id.startsWith(`${platform}:`)))];
      if (!ids.length && !(platform === "bilibili" && allowEmptySnapshot)) throw new Error("同步结果为空，未执行归档");
      await DB.completeSnapshot(platform, sessionId, ids);
      const platformItems = (await DB.getAllVideos()).filter((item) => item.platform === platform);
      await DB.putVideos(platformItems.map((item) => ({ ...item, sourceAccountId: account.id, sourceAccountName: account.name })));
      const bindings = (await chrome.storage.local.get("wlwSourceBindings")).wlwSourceBindings || {};
      const now = Date.now();
      bindings[platform] = { ...account, boundAt: Number(bindings[platform]?.boundAt || now), lastVerifiedAt: now };
      await chrome.storage.local.set({ wlwSourceBindings: bindings });
      await chrome.storage.local.remove(key);
      await updateSyncStatus(platform, { state: "complete", sessionId, count: ids.length, lastSyncAt: Date.now(), error: "" });
      return { completed: true, count: ids.length };
    });
  }

  async function failSourceSync(platform, sessionId, error, tabId) {
    const key = `wlwPendingSync_${platform}`;
    const pending = (await chrome.storage.local.get(key))[key];
    if (pending?.sessionId !== sessionId || (pending.tabId !== undefined && pending.tabId !== tabId)) return { failed: false };
    await chrome.storage.local.remove(key);
    await updateSyncStatus(platform, { state: "error", sessionId, error: clean(error) || "同步未完成" });
    return { failed: true };
  }

  async function handleTabRemoved(tabId) {
    for (const platform of Object.keys(SYNC_URLS)) {
      const key = `wlwPendingSync_${platform}`;
      const pending = (await chrome.storage.local.get(key))[key];
      if (pending?.tabId !== tabId) continue;
      await chrome.storage.local.remove(key);
      await updateSyncStatus(platform, { state: "error", sessionId: pending.sessionId, error: "同步页面已关闭，请重试" });
    }
    if (SourceActions) await getSourceActionCoordinator().handleTabRemoved(tabId);
  }

  async function reconcileSourceActions(force = false) {
    await ensureMigrated();
    if (SourceActions) {
      const shouldForce = force || !sourceActionsInitialized;
      sourceActionsInitialized = true;
      const run = () => getSourceActionCoordinator().reconcile({ force: shouldForce });
      const result = sourceReconcileTail.then(run, run);
      sourceReconcileTail = result.catch(() => undefined);
      await result;
    }
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
    const items = filtered.slice(offset, offset + limit).map((item) => {
      const base = item.platform === "bilibili" ? "https://www.bilibili.com/" : "https://www.youtube.com/";
      const thumbnailUrl = Collectors.absoluteUrl(item.thumbnailUrl, base);
      return thumbnailUrl && thumbnailUrl !== item.thumbnailUrl ? { ...item, thumbnailUrl } : item;
    });
    return {
      items, total: filtered.length, nextOffset: offset + limit < filtered.length ? offset + limit : null,
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
    return withWriteLock(async () => {
      const existing = await DB.getVideo(id);
      if (!existing) throw new Error("视频不存在");
      const allowed = {};
      if (patch.rating === null || (Number.isInteger(patch.rating) && patch.rating >= 1 && patch.rating <= 5)) allowed.rating = patch.rating;
      if (Object.prototype.hasOwnProperty.call(patch, "manualCategory")) allowed.manualCategory = clean(patch.manualCategory);
      if (Array.isArray(patch.manualTags)) allowed.manualTags = patch.manualTags.map(clean).filter(Boolean).slice(0, 12);
      if (["current", "archived"].includes(patch.status)) {
        allowed.manualArchived = patch.status === "archived";
        allowed.status = patch.status;
      }
      const item = enrichVideo({ ...existing, ...allowed }, await getRules());
      await DB.putVideos([item]);
      return { item };
    });
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
    const data = { title: body.data.title || "", creator: body.data.owner?.name || "", nativeCategory: body.data.tname || "", durationSeconds: body.data.duration || null, publishedAt: body.data.pubdate ? body.data.pubdate * 1000 : null, thumbnailUrl: Collectors.absoluteUrl(body.data.pic, "https://www.bilibili.com/"), cachedAt: Date.now() };
    const latest = (await chrome.storage.local.get(CACHE_KEY))[CACHE_KEY] || {};
    latest[bvid] = data;
    await chrome.storage.local.set({ [CACHE_KEY]: latest });
    return data;
  }

  function assertCollectorSender(sender, platform) {
    let url;
    try { url = new URL(sender?.tab?.url || ""); } catch { throw new Error("采集消息来源无效"); }
    const allowed = platform === "bilibili"
      ? url.hostname === "www.bilibili.com" && url.pathname.startsWith("/watchlater/")
      : platform === "youtube" && ["www.youtube.com", "youtube.com"].includes(url.hostname) && url.pathname === "/playlist" && url.searchParams.get("list") === "WL";
    if (!allowed) throw new Error("采集消息来源不受信任");
  }

  function assertExtensionSender(sender) {
    if (!String(sender?.url || "").startsWith(chrome.runtime.getURL(""))) throw new Error("只有扩展页面可以执行此操作");
  }

  async function fetchBiliWatchLater() {
    const response = await fetch("https://api.bilibili.com/x/v2/history/toview/web?jsonp=jsonp", {
      credentials: "include",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`B站稍后再看请求失败 (${response.status})`);
    const body = await response.json();
    if (body?.code !== 0 || !Array.isArray(body.data?.list)) {
      throw new Error(body?.message || "未取得 B站稍后再看列表");
    }
    return { items: Collectors.normalizeBilibiliApiResponse(body), expectedCount: Number(body.data.count) };
  }

  async function aiClassify(ids) {
    const { settings } = await getSettings();
    const ai = settings.ai;
    if (!ai.enabled || !ai.apiKey || !ai.model) throw new Error("请先在设置中启用并配置 AI");
    const items = await DB.getVideos([...new Set(ids)]);
    let updated = 0;
    for (let index = 0; index < items.length; index += 20) {
      const batch = items.slice(index, index + 20);
      const results = await requestAiBatch(ai, batch, settings.rules);
      const byId = new Map(results.map((item) => [item.id, item]));
      await withWriteLock(async () => {
        const latest = await DB.getVideos(batch.map((item) => item.id));
        const changed = latest.map((item) => {
          const result = byId.get(item.id);
          if (!result) return item;
          updated += 1;
          return enrichVideo({ ...item, aiCategory: result.primaryCategory, aiTags: (result.tags || []).map(clean).filter(Boolean).slice(0, 5), aiConfidence: Number(result.confidence || 0) }, settings.rules);
        });
        await DB.putVideos(changed);
      });
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
        body: JSON.stringify({ model: ai.model, messages: [
          { role: "system", content: `你是视频分类器。主分类必须从以下列表选择：${rules.map((r) => r.name).join("、")}。只返回 JSON：{\"items\":[{\"id\":\"...\",\"primaryCategory\":\"...\",\"tags\":[最多5个],\"confidence\":0到1}]}` },
          { role: "user", content: JSON.stringify(items.map((item) => ({ id: item.id, title: item.title, creator: item.creator, platform: item.platform, nativeCategory: item.nativeCategory, durationSeconds: item.durationSeconds }))) }
        ] })
      });
      if (!response.ok) throw new Error(`AI 请求失败 (${response.status})`);
      const content = (await response.json()).choices?.[0]?.message?.content;
      if (!content) throw new Error("AI 未返回分类内容");
      return Core.parseAiClassificationResponse(content, rules.map((rule) => rule.name));
    } finally { clearTimeout(timeout); }
  }

  async function exportLibrary() {
    const items = await DB.getAllVideos();
    const { settings, syncStatus } = await getSettings();
    return { payload: { version: 1, exportedAt: Date.now(), items, settings: { rules: settings.rules, searchEngine: settings.searchEngine, ai: { enabled: false, baseUrl: settings.ai.baseUrl, model: settings.ai.model, apiKey: "" } }, syncStatus } };
  }

  async function fetchBiliAccount() {
    const response = await fetch("https://api.bilibili.com/x/web-interface/nav", { credentials: "include", headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`B站账号识别请求失败 (${response.status})`);
    return { body: await response.json() };
  }

  async function exportSourceLibrary(platform) {
    if (!SYNC_URLS[platform]) throw new Error("不支持的平台");
    const items = (await DB.getAllVideos()).filter((item) => item.platform === platform);
    const { settings, sourceBindings } = await getSettings();
    return { payload: { version: 2, platform, exportedAt: Date.now(), binding: sourceBindings[platform] || null, items, settings: { rules: settings.rules, searchEngine: settings.searchEngine, ai: { enabled: false, baseUrl: settings.ai.baseUrl, model: settings.ai.model, apiKey: "" } } } };
  }

  async function clearSourceBinding(platform, expectedAccountId) {
    if (!SYNC_URLS[platform]) throw new Error("不支持的平台");
    return withWriteLock(async () => {
      const syncKey = `wlwPendingSync_${platform}`;
      const actionKey = `wlwPendingSourceAction_${platform}`;
      const stored = await chrome.storage.local.get(["wlwSourceBindings", "wlwSyncStatus", "wlwSourceActionStatus", syncKey, actionKey]);
      const bindings = stored.wlwSourceBindings || {};
      const binding = bindings[platform];
      if (!binding || binding.id !== expectedAccountId) throw new Error("账号绑定已变化，请刷新设置后重试");
      if (stored[syncKey]) throw new Error("该平台完整同步正在进行，请完成或关闭同步页面后重试");
      if (stored[actionKey]) throw new Error("该平台仍有删除操作正在进行");
      await DB.deletePlatform(platform);
      delete bindings[platform];
      const syncStatus = stored.wlwSyncStatus || {};
      const actionStatus = stored.wlwSourceActionStatus || {};
      delete syncStatus[platform];
      delete actionStatus[platform];
      await chrome.storage.local.set({ wlwSourceBindings: bindings, wlwSyncStatus: syncStatus, wlwSourceActionStatus: actionStatus });
      const removeKeys = [syncKey, actionKey];
      if (platform === "bilibili") removeKeys.push(CACHE_KEY);
      await chrome.storage.local.remove(removeKeys);
      return { cleared: true, platform };
    });
  }

  return { handleMessage, handleTabRemoved, ensureMigrated, reconcileSourceActions, getLibrary, updateUserMeta, completeSourceSync, scheduleExtensionReload };
});
