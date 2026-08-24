(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WLWSourceActions = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SOURCE_URLS = {
    bilibili: "https://www.bilibili.com/watchlater/list#/list",
    youtube: "https://www.youtube.com/playlist?list=WL",
    x: "https://x.com/i/history"
  };
  const SOURCE_PATTERNS = {
    bilibili: ["https://www.bilibili.com/watchlater/*"],
    youtube: ["https://www.youtube.com/playlist?list=WL*", "https://youtube.com/playlist?list=WL*"],
    x: ["https://x.com/i/history*", "https://x.com/i/bookmarks*"]
  };
  const MAX_AGE = 5 * 60 * 1000;
  const RECOVERY_REDRIVE_AFTER = 2 * 60 * 1000;
  const STATES = Object.freeze({
    OPENING: "opening", CLAIMED: "claimed", REMOVING: "removing",
    RESTORING: "restoring",
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

    function operationOf(action) {
      return action?.operation === "restore" ? "restore" : "remove";
    }

    function actionLabel(action, text) {
      return operationOf(action) === "restore" ? `平台恢复${text}` : `平台删除${text}`;
    }

    function recordActionPatch(action, state, error = "") {
      return operationOf(action) === "restore"
        ? { sourceRestoreState: state, sourceRestoreError: error }
        : { sourceRemovalState: state, sourceRemovalError: error };
    }

    async function openSource(action) {
      const platform = action.platform;
      const targetUrl = action.targetUrl || SOURCE_URLS[platform];
      const patterns = operationOf(action) === "restore" && targetUrl ? [targetUrl] : SOURCE_PATTERNS[platform];
      const existing = await tabs.query({ url: patterns });
      if (existing[0]) {
        const needsNavigation = existing[0].url !== targetUrl;
        const tab = await tabs.update(existing[0].id, needsNavigation ? { active: true, url: targetUrl } : { active: true }) || existing[0];
        if (tab.windowId !== undefined) await windows.update(tab.windowId, { focused: true });
        if (!needsNavigation) await tabs.reload(tab.id);
        return { tab, created: false };
      }
      return { tab: await tabs.create({ url: targetUrl, active: true }), created: true };
    }

    async function closeOwnedTab(action) {
      if (action?.ownsTab !== true || !Number.isInteger(action.tabId) || typeof tabs.remove !== "function") return;
      try { await tabs.remove(action.tabId); }
      catch (_) { /* The user may already have closed the action tab. */ }
    }

    async function startUnlocked(recordId, requestedOperation = "remove") {
      await reconcile();
      const record = await db.getVideo(recordId);
      const operation = requestedOperation === "restore" ? "restore" : "remove";
      if (!record || !SOURCE_URLS[record.platform]) throw new Error("内容不存在或平台不受支持");
      if (operation === "restore" && record.platform !== "x") throw new Error("该平台暂不支持恢复到来源");
      const binding = (await getBindings())[record.platform];
      if (!binding || binding.id !== record.sourceAccountId) throw new Error("内容未绑定到当前平台账号，请先完成全量同步");
      const existing = await getAction(record.platform);
      if (existing && ![STATES.COMPLETE, STATES.FAILED].includes(existing.state) && existing.recordId === record.id && operationOf(existing) === operation) {
        return { action: existing, tabId: existing.tabId, reused: true };
      }
      if (existing && ![STATES.COMPLETE, STATES.FAILED].includes(existing.state)) throw new Error("该平台已有内容操作正在进行");
      const sourceItemId = record.sourceItemId || record.videoId || record.id.split(":").slice(1).join(":");
      let targetUrl = SOURCE_URLS[record.platform];
      if (operation === "restore") {
        let sourceUrl;
        try { sourceUrl = new URL(record.url); }
        catch { throw new Error("X 原帖地址无效，未执行重新收藏"); }
        const sourceMatch = sourceUrl.hostname === "x.com" && sourceUrl.pathname.match(/^\/([0-9A-Za-z_]{1,15})\/status\/(\d{1,24})\/?$/);
        if (!sourceMatch || sourceMatch[2] !== sourceItemId) throw new Error("X 原帖地址与帖子 ID 不一致，未执行重新收藏");
        targetUrl = `https://x.com/${sourceMatch[1]}/status/${sourceItemId}`;
      }
      const action = {
        id: `${record.platform}:${now()}:${uuid()}`,
        type: "source_action",
        operation,
        platform: record.platform,
        recordId: record.id,
        sourceItemId,
        videoId: record.videoId || sourceItemId,
        title: record.title || sourceItemId,
        targetUrl,
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
        await updateRecord(record, recordActionPatch(action, STATES.OPENING));
        const source = await openSource(action);
        const opened = { ...action, tabId: source.tab.id, ownsTab: source.created, recoveryScheduledAt: now(), recovering: false, updatedAt: now() };
        await saveAction(opened);
        return { action: opened, tabId: source.tab.id };
      } catch (error) {
        await fail(record.platform, action.id, String(error?.message || error));
        throw error;
      }
    }

    async function start(recordId, operation = "remove") {
      const record = await db.getVideo(recordId);
      if (!record || !SOURCE_URLS[record.platform]) return startUnlocked(recordId, operation);
      const platform = record.platform;
      const previous = startQueues.get(platform) || Promise.resolve();
      const current = previous.catch(() => {}).then(() => startUnlocked(recordId, operation));
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
        const error = actionLabel(action, "操作已超时");
        await fail(platform, action.id, error);
        throw new Error(error);
      }
      const account = Accounts.normalizeAccount(platform, rawAccount);
      const binding = (await getBindings())[platform];
      if (!account || !binding || !Accounts.accountsMatch(binding, account) || account.id !== action.expectedAccountId) {
        await fail(platform, action.id, `当前账号与目标账号 ${action.expectedAccountName || action.expectedAccountId} 不一致`);
        throw new Error(`当前账号与目标账号 ${action.expectedAccountName || action.expectedAccountId} 不一致`);
      }
      const claimedState = { ...action, state: STATES.CLAIMED, tabId, updatedAt: now(), error: "" };
      await saveAction(claimedState);
      const executingState = operationOf(action) === "restore" ? STATES.RESTORING : STATES.REMOVING;
      const claimed = { ...claimedState, state: executingState, allowAlreadyMissing: operationOf(action) === "remove" && (action.recovering === true || action.state === STATES.REMOVING), updatedAt: now() };
      await saveAction(claimed);
      const record = await db.getVideo(claimed.recordId);
      if (record) await updateRecord(record, recordActionPatch(claimed, executingState));
      return { action: claimed };
    }

    async function applyCompleted(action) {
      const record = await db.getVideo(action.recordId);
      if (!record) throw new Error(`${actionLabel(action, "已成功")}，但本地内容记录不存在`);
      if (operationOf(action) === "restore") {
        await updateRecord(record, {
          manualArchived: false,
          status: "current",
          sourceRestoreState: STATES.COMPLETE,
          sourceRestoreError: "",
          sourceRestoredAt: now(),
          sourceRemovalState: "",
          sourceRemovalError: "",
          sourceRemovedAt: null
        });
      } else {
        await updateRecord(record, {
          manualArchived: true,
          status: "archived",
          sourceRemovalState: STATES.COMPLETE,
          sourceRemovalError: "",
          sourceRemovedAt: now()
        });
      }
      const completed = { ...action, state: STATES.COMPLETE, updatedAt: now(), error: "" };
      await saveAction(completed);
      await storage.remove(actionKey(action.platform));
      return completed;
    }

    async function complete(platform, actionId, tabId) {
      const action = await getAction(platform);
      const executingState = operationOf(action) === "restore" ? STATES.RESTORING : STATES.REMOVING;
      if (!action || action.id !== actionId || action.tabId !== tabId || action.state !== executingState) throw new Error(`${actionLabel(action, "操作已失效")}`);
      const succeeded = { ...action, state: STATES.PLATFORM_SUCCEEDED, updatedAt: now(), error: "" };
      await saveAction(succeeded);
      try {
        const completed = await applyCompleted(succeeded);
        return { action: completed };
      } catch (error) {
        const pendingText = operationOf(action) === "restore" ? "平台已重新收藏，本地恢复待完成" : "平台已移除，本地归档待恢复";
        await saveAction({ ...succeeded, error: `${pendingText}：${String(error?.message || error)}`, updatedAt: now() });
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
      const failed = { ...action, state: STATES.FAILED, updatedAt: now(), error: String(error || actionLabel(action, "失败")) };
      const record = await db.getVideo(action.recordId);
      let localError = "";
      if (record) {
        try { await updateRecord(record, recordActionPatch(action, STATES.FAILED, failed.error)); }
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
          try { await applyCompleted(action); }
          catch (error) {
            const pendingText = operationOf(action) === "restore" ? "平台已重新收藏，本地恢复待完成" : "平台已移除，本地归档待恢复";
            const recoveryError = `${pendingText}：${String(error?.message || error)}`;
            if (action.error !== recoveryError) await saveAction({ ...action, error: recoveryError, updatedAt: now() });
          }
          finally { await closeOwnedTab(action); }
        } else if (now() - action.createdAt > MAX_AGE) {
          await fail(platform, action.id, actionLabel(action, "操作已超时"));
        } else if ([STATES.OPENING, STATES.CLAIMED, STATES.REMOVING, STATES.RESTORING].includes(action.state)
          && (options.force === true || !action.recoveryScheduledAt || now() - action.recoveryScheduledAt >= RECOVERY_REDRIVE_AFTER)) {
          try {
            const source = await openSource(action);
            const recovered = {
              ...action,
              state: STATES.OPENING,
              tabId: source.tab.id,
              ownsTab: source.created || (action.ownsTab === true && action.tabId === source.tab.id),
              recovering: action.recovering === true || [STATES.REMOVING, STATES.RESTORING].includes(action.state),
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
