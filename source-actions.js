(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WLWSourceActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SOURCE_URLS = {
    bilibili: "https://www.bilibili.com/watchlater/list#/list",
    youtube: "https://www.youtube.com/playlist?list=WL"
  };
  const SOURCE_PATTERNS = {
    bilibili: ["https://www.bilibili.com/watchlater/*"],
    youtube: ["https://www.youtube.com/playlist?list=WL*", "https://youtube.com/playlist?list=WL*"]
  };
  const MAX_AGE = 5 * 60 * 1000;
  const RECOVERY_REDRIVE_AFTER = 2 * 60 * 1000;
  const STATES = Object.freeze({
    OPENING: "opening", CLAIMED: "claimed", REMOVING: "removing",
    PLATFORM_SUCCEEDED: "platform_succeeded", COMPLETE: "complete", FAILED: "failed"
  });

  function createSourceActionCoordinator(deps) {
    const { storage, db, tabs, windows, Accounts } = deps;
    const now = deps.now || Date.now;
    const uuid = deps.uuid || (() => crypto.randomUUID());
    const startQueues = new Map();

    const actionKey = (platform) => `wlwPendingSourceAction_${platform}`;

    async function getBindings() {
      return (await storage.get("wlwSourceBindings")).wlwSourceBindings || {};
    }

    async function setStatus(platform, action) {
      const statuses = (await storage.get("wlwSourceActionStatus")).wlwSourceActionStatus || {};
      statuses[platform] = action;
      await storage.set({ wlwSourceActionStatus: statuses });
    }

    async function saveAction(action) {
      await storage.set({ [actionKey(action.platform)]: action });
      await setStatus(action.platform, action);
    }

    async function getAction(platform) {
      return (await storage.get(actionKey(platform)))[actionKey(platform)] || null;
    }

    async function updateRecord(record, patch) {
      const next = { ...record, ...patch };
      await db.putVideos([next]);
      return next;
    }

    async function openSource(platform) {
      const existing = await tabs.query({ url: SOURCE_PATTERNS[platform] });
      if (existing[0]) {
        const tab = await tabs.update(existing[0].id, { active: true }) || existing[0];
        if (tab.windowId !== undefined) await windows.update(tab.windowId, { focused: true });
        await tabs.reload(tab.id);
        return { tab, created: false };
      }
      return { tab: await tabs.create({ url: SOURCE_URLS[platform], active: true }), created: true };
    }

    async function closeOwnedTab(action) {
      if (action?.ownsTab !== true || !Number.isInteger(action.tabId) || typeof tabs.remove !== "function") return;
      try { await tabs.remove(action.tabId); }
      catch (_) { /* The user may already have closed the action tab. */ }
    }

    async function startUnlocked(recordId) {
      await reconcile();
      const record = await db.getVideo(recordId);
      if (!record || !SOURCE_URLS[record.platform]) throw new Error("视频不存在或平台不受支持");
      const binding = (await getBindings())[record.platform];
      if (!binding || binding.id !== record.sourceAccountId) throw new Error("视频未绑定到当前平台账号，请先完成全量同步");
      const existing = await getAction(record.platform);
      if (existing && ![STATES.COMPLETE, STATES.FAILED].includes(existing.state) && existing.recordId === record.id) {
        return { action: existing, tabId: existing.tabId, reused: true };
      }
      if (existing && ![STATES.COMPLETE, STATES.FAILED].includes(existing.state)) throw new Error("该平台已有删除操作正在进行");
      const action = {
        id: `${record.platform}:${now()}:${uuid()}`,
        type: "remove",
        platform: record.platform,
        recordId: record.id,
        videoId: record.videoId,
        title: record.title || record.videoId,
        expectedAccountId: binding.id,
        expectedAccountName: binding.name,
        state: STATES.OPENING,
        createdAt: now(),
        updatedAt: now(),
        tabId: null,
        ownsTab: false,
        recoveryScheduledAt: now(),
        recovering: false,
        error: ""
      };
      try {
        await saveAction(action);
        await updateRecord(record, { sourceRemovalState: STATES.OPENING, sourceRemovalError: "" });
        const source = await openSource(record.platform);
        const opened = { ...action, tabId: source.tab.id, ownsTab: source.created, recoveryScheduledAt: now(), recovering: false, updatedAt: now() };
        await saveAction(opened);
        return { action: opened, tabId: source.tab.id };
      } catch (error) {
        await fail(record.platform, action.id, String(error?.message || error));
        throw error;
      }
    }

    async function start(recordId) {
      const record = await db.getVideo(recordId);
      if (!record || !SOURCE_URLS[record.platform]) return startUnlocked(recordId);
      const platform = record.platform;
      const previous = startQueues.get(platform) || Promise.resolve();
      const current = previous.catch(() => {}).then(() => startUnlocked(recordId));
      startQueues.set(platform, current);
      try { return await current; }
      finally { if (startQueues.get(platform) === current) startQueues.delete(platform); }
    }

    async function claim(platform, rawAccount, tabId) {
      const action = await getAction(platform);
      if (!action) return { action: null };
      if ([STATES.COMPLETE, STATES.FAILED].includes(action.state)) {
        await storage.remove(actionKey(platform));
        return { action: null };
      }
      if (action.state === STATES.PLATFORM_SUCCEEDED) {
        await reconcile();
        return { action: null };
      }
      if (now() - action.createdAt > MAX_AGE) {
        await fail(platform, action.id, "平台删除操作已超时");
        throw new Error("平台删除操作已超时");
      }
      const account = Accounts.normalizeAccount(platform, rawAccount);
      const binding = (await getBindings())[platform];
      if (!account || !binding || !Accounts.accountsMatch(binding, account) || account.id !== action.expectedAccountId) {
        await fail(platform, action.id, `当前账号与目标账号 ${action.expectedAccountName || action.expectedAccountId} 不一致`);
        throw new Error(`当前账号与目标账号 ${action.expectedAccountName || action.expectedAccountId} 不一致`);
      }
      const claimedState = { ...action, state: STATES.CLAIMED, tabId, updatedAt: now(), error: "" };
      await saveAction(claimedState);
      const claimed = { ...claimedState, state: STATES.REMOVING, allowAlreadyMissing: action.recovering === true || action.state === STATES.REMOVING, updatedAt: now() };
      await saveAction(claimed);
      const record = await db.getVideo(claimed.recordId);
      if (record) await updateRecord(record, { sourceRemovalState: STATES.REMOVING, sourceRemovalError: "" });
      return { action: claimed };
    }

    async function archiveCompleted(action) {
      const record = await db.getVideo(action.recordId);
      if (!record) throw new Error("平台已删除，但本地视频记录不存在");
      await updateRecord(record, {
        manualArchived: true,
        status: "archived",
        sourceRemovalState: STATES.COMPLETE,
        sourceRemovalError: "",
        sourceRemovedAt: now()
      });
      const completed = { ...action, state: STATES.COMPLETE, updatedAt: now(), error: "" };
      await saveAction(completed);
      await storage.remove(actionKey(action.platform));
      return completed;
    }

    async function complete(platform, actionId, tabId) {
      const action = await getAction(platform);
      if (!action || action.id !== actionId || action.tabId !== tabId || action.state !== STATES.REMOVING) throw new Error("平台删除操作已失效");
      const succeeded = { ...action, state: STATES.PLATFORM_SUCCEEDED, updatedAt: now(), error: "" };
      await saveAction(succeeded);
      try {
        const completed = await archiveCompleted(succeeded);
        return { action: completed };
      } catch (error) {
        await saveAction({ ...succeeded, error: `平台已移除，本地归档待恢复：${String(error?.message || error)}`, updatedAt: now() });
        throw error;
      } finally {
        await closeOwnedTab(succeeded);
      }
    }

    async function fail(platform, actionId, error, tabId) {
      const action = await getAction(platform);
      if (!action || action.id !== actionId) return { failed: false };
      if (tabId !== undefined && action.tabId !== null && action.tabId !== tabId) return { failed: false };
      if (action.state === STATES.PLATFORM_SUCCEEDED) {
        await reconcile();
        return { failed: false, platformSucceeded: true };
      }
      const failed = { ...action, state: STATES.FAILED, updatedAt: now(), error: String(error || "平台删除失败") };
      const record = await db.getVideo(action.recordId);
      let localError = "";
      if (record) {
        try { await updateRecord(record, { sourceRemovalState: STATES.FAILED, sourceRemovalError: failed.error }); }
        catch (recordError) { localError = String(recordError?.message || recordError); }
      }
      await setStatus(platform, failed);
      await storage.remove(actionKey(platform));
      await closeOwnedTab(failed);
      return { failed: true, action: failed, localError };
    }

    async function reconcile(options = {}) {
      for (const platform of Object.keys(SOURCE_URLS)) {
        const action = await getAction(platform);
        if (!action) continue;
        if ([STATES.COMPLETE, STATES.FAILED].includes(action.state)) {
          await storage.remove(actionKey(platform));
        } else if (action.state === STATES.PLATFORM_SUCCEEDED) {
          try { await archiveCompleted(action); }
          catch (error) {
            const recoveryError = `平台已移除，本地归档待恢复：${String(error?.message || error)}`;
            if (action.error !== recoveryError) await saveAction({ ...action, error: recoveryError, updatedAt: now() });
          }
          finally { await closeOwnedTab(action); }
        } else if (now() - action.createdAt > MAX_AGE) {
          await fail(platform, action.id, "平台删除操作已超时");
        } else if ([STATES.OPENING, STATES.CLAIMED, STATES.REMOVING].includes(action.state)
          && (options.force === true || !action.recoveryScheduledAt || now() - action.recoveryScheduledAt >= RECOVERY_REDRIVE_AFTER)) {
          try {
            const source = await openSource(platform);
            const recovered = {
              ...action,
              state: STATES.OPENING,
              tabId: source.tab.id,
              ownsTab: source.created || (action.ownsTab === true && action.tabId === source.tab.id),
              recovering: action.recovering === true || action.state === STATES.REMOVING,
              recoveryScheduledAt: now(),
              updatedAt: now(),
              error: ""
            };
            await saveAction(recovered);
          } catch (error) {
            await fail(platform, action.id, `无法恢复平台页面：${String(error?.message || error)}`);
          }
        }
      }
    }

    async function handleTabRemoved(tabId) {
      for (const platform of Object.keys(SOURCE_URLS)) {
        const action = await getAction(platform);
        if (action?.tabId === tabId && ![STATES.PLATFORM_SUCCEEDED, STATES.COMPLETE, STATES.FAILED].includes(action.state)) await fail(platform, action.id, "平台页面已关闭，请重试", tabId);
      }
    }

    return { start, claim, complete, fail, reconcile, handleTabRemoved };
  }

  return { SOURCE_URLS, SOURCE_PATTERNS, MAX_AGE, RECOVERY_REDRIVE_AFTER, STATES, createSourceActionCoordinator };
});
