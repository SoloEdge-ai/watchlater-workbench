(function (root) {
  "use strict";

  const Runtime = {
    async start(adapter) {
      const known = new Map();
      let timer;
      let syncing = false;

      let account = null;
      let allowIncremental = false;
      const incrementalScan = async () => {
        if (syncing) return;
        const items = adapter.scan().filter(Boolean);
        const fresh = items.filter((item) => !known.has(item.id) || recordChanged(known.get(item.id), item));
        for (const item of fresh) known.set(item.id, item);
        if (fresh.length) {
          await sendBatches(adapter, null, fresh);
          if (adapter.hydrate) adapter.hydrate(fresh).then((hydrated) => sendBatches(adapter, null, hydrated)).catch(() => {});
        }
      };

      await waitForPage(adapter.readySelector);
      if (adapter.accountReadySelector) await waitForPage(adapter.accountReadySelector);
      account = await identifyInitialAccount(adapter);
      let pending = await message({ type: "GET_PENDING_SYNC", platform: adapter.platform, account });
      if (pending?.ok && pending.requiresBinding) {
        const accepted = confirm(`检测到 ${adapter.label} 账号：${pending.candidate.name || pending.candidate.id}\n\n绑定该账号并开始完整同步吗？`);
        if (!accepted) {
          await message({ type: "SOURCE_SYNC_FAILED", platform: adapter.platform, sessionId: pending.sessionId, error: "用户取消账号绑定" });
          return;
        }
        pending = await message({ type: "GET_PENDING_SYNC", platform: adapter.platform, account, confirmBinding: true });
      }
      allowIncremental = Boolean(pending?.allowIncremental);
      if (pending?.ok && pending.pending) {
        syncing = true;
        allowIncremental = await fullSync(adapter, pending.pending.sessionId);
        syncing = false;
      }
      if (allowIncremental) {
        await incrementalScan();
        new MutationObserver(() => {
          clearTimeout(timer);
          timer = setTimeout(incrementalScan, 400);
        }).observe(document.documentElement, { childList: true, subtree: true });
      }
    }
  };

  async function fullSync(adapter, sessionId) {
    const overlay = createOverlay(adapter.label);
    const seen = new Map();
    let stableRounds = 0;
    let lastCount = 0;
    let completed = false;
    try {
      if (adapter.fetchAll) {
        try {
          overlay.update("正在读取登录态完整列表");
          const snapshot = await adapter.fetchAll();
          const expectedCount = Number(snapshot?.expectedCount);
          const items = root.WLWCollectors.validateSourceSnapshot(snapshot);
          if (items) {
            await sendBatches(adapter, sessionId, items);
            const result = await message({ type: "SOURCE_SYNC_COMPLETE", platform: adapter.platform, sessionId, account: await identifyCurrentAccount(adapter), seenIds: items.map((item) => item.id), allowEmptySnapshot: expectedCount === 0 || snapshot?.allowEmpty === true });
            if (!result?.ok) throw new Error(result?.error || "同步收尾失败");
            completed = true;
            overlay.update(`同步完成：${items.length} 条`, "success");
            return true;
          }
          overlay.update(`完整列表未通过数量校验，改用页面滚动采集`);
        } catch (error) {
          if (adapter.requireFetchAll) throw error;
          overlay.update(`完整列表读取失败，改用页面滚动采集：${error.message || error}`);
        }
      }

      for (let round = 0; round < 140 && stableRounds < 8; round += 1) {
        const items = adapter.scan().filter(Boolean);
        const fresh = items.filter((item) => !seen.has(item.id) || recordChanged(seen.get(item.id), item));
        for (const item of items) seen.set(item.id, item);
        if (fresh.length) {
          await sendBatches(adapter, sessionId, fresh);
          if (adapter.hydrate) {
            try { await sendBatches(adapter, sessionId, await adapter.hydrate(fresh)); } catch {}
          }
        }
        overlay.update(`已收集 ${seen.size} 条 · 正在加载更多`);
        stableRounds = seen.size === lastCount && nearBottom() ? stableRounds + 1 : 0;
        lastCount = seen.size;
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
        await delay(700);
      }
      if (!seen.size) throw new Error("页面中未识别到内容，请确认已登录并打开正确的收藏列表");
      if (stableRounds < 8 || !nearBottom()) throw new Error("页面尚未稳定到达列表末尾，已保留原资料且未执行归档");
      if (adapter.expectedCount) {
        const expectedCount = Number(adapter.expectedCount());
        if (!Number.isInteger(expectedCount) || expectedCount <= 0 || expectedCount !== seen.size) {
          throw new Error(`页面显示 ${Number.isInteger(expectedCount) && expectedCount > 0 ? expectedCount : "未知"} 条，但识别到 ${seen.size} 条；已保留原资料且未执行归档`);
        }
      }
      const result = await message({ type: "SOURCE_SYNC_COMPLETE", platform: adapter.platform, sessionId, account: await identifyCurrentAccount(adapter), seenIds: [...seen.keys()] });
      if (!result?.ok) throw new Error(result?.error || "同步收尾失败");
      completed = true;
      overlay.update(`同步完成：${seen.size} 条`, "success");
      return true;
    } catch (error) {
      await message({ type: "SOURCE_SYNC_FAILED", platform: adapter.platform, sessionId, error: String(error?.message || error) });
      overlay.update(`同步未完成：${error.message || error}`, "error");
      return false;
    } finally {
      setTimeout(() => overlay.remove(), completed ? 3500 : 8000);
    }
  }

  async function sendBatches(adapter, sessionId, items) {
    for (let index = 0; index < items.length; index += 40) {
      const account = await identifyCurrentAccount(adapter);
      const result = await message({ type: "SOURCE_SYNC_UPSERT", platform: adapter.platform, sessionId, account, items: items.slice(index, index + 40) });
      if (!result?.ok) throw new Error(result?.error || "写入本地资料库失败");
    }
  }

  async function identifyCurrentAccount(adapter) {
    const account = await adapter.identifyAccount();
    if (!account?.id) throw new Error("无法重新验证当前平台账号，已停止写入");
    return account;
  }

  async function identifyInitialAccount(adapter, timeout = 4000) {
    const end = Date.now() + timeout;
    do {
      try {
        const account = await adapter.identifyAccount();
        if (account?.id) return account;
      } catch {}
      await delay(150);
    } while (Date.now() < end);
    return null;
  }

  function recordChanged(previous, next) {
    return ["title", "bodyText", "creator", "creatorHandle", "durationSeconds", "progressSeconds", "thumbnailUrl", "nativeCategory", "quotedText", "quotedCreator"].some((key) => previous?.[key] !== next?.[key])
      || JSON.stringify(previous?.mediaUrls || []) !== JSON.stringify(next?.mediaUrls || []);
  }

  function nearBottom() {
    return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 240;
  }

  function waitForPage(selector, timeout = 12000) {
    if (!selector || document.querySelector(selector)) return Promise.resolve(true);
    return new Promise((resolve) => {
      let timer;
      const finish = (ready) => { observer.disconnect(); clearTimeout(timer); resolve(ready); };
      const observer = new MutationObserver(() => {
        if (document.querySelector(selector)) finish(true);
      });
      timer = setTimeout(() => finish(false), timeout);
      observer.observe(document.documentElement, { childList: true, subtree: true });
    });
  }

  function createOverlay(label) {
    const node = document.createElement("div");
    node.id = "wlw-sync-overlay";
    Object.assign(node.style, {
      position: "fixed", right: "22px", bottom: "22px", zIndex: "2147483647",
      padding: "14px 18px", borderRadius: "12px", color: "#fff", background: "#20242b",
      boxShadow: "0 12px 40px rgba(0,0,0,.28)", font: "14px system-ui", maxWidth: "360px"
    });
    node.textContent = `${label}：准备同步`;
    document.documentElement.append(node);
    return {
      update(text, state) { node.textContent = `${label}：${text}`; node.style.background = state === "success" ? "#20734b" : state === "error" ? "#a83f4c" : "#20242b"; },
      remove() { node.remove(); }
    };
  }

  function message(payload) {
    return chrome.runtime.sendMessage(payload).catch((error) => ({ ok: false, error: String(error?.message || error) }));
  }

  function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
  root.WLWCollectorRuntime = Runtime;
})(globalThis);
