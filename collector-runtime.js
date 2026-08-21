(function (root) {
  "use strict";

  const Runtime = {
    async start(adapter) {
      const known = new Map();
      let timer;
      let syncing = false;

      const incrementalScan = async () => {
        if (syncing) return;
        const items = adapter.scan().filter(Boolean);
        const fresh = items.filter((item) => !known.has(item.id) || recordChanged(known.get(item.id), item));
        for (const item of fresh) known.set(item.id, item);
        if (fresh.length) {
          await sendBatches(adapter.platform, null, fresh);
          if (adapter.hydrate) adapter.hydrate(fresh).then((hydrated) => sendBatches(adapter.platform, null, hydrated)).catch(() => {});
        }
      };

      await waitForPage(adapter.readySelector);
      await incrementalScan();
      new MutationObserver(() => {
        clearTimeout(timer);
        timer = setTimeout(incrementalScan, 400);
      }).observe(document.documentElement, { childList: true, subtree: true });

      const pending = await message({ type: "GET_PENDING_SYNC", platform: adapter.platform });
      if (pending?.ok && pending.pending) {
        syncing = true;
        await fullSync(adapter, pending.pending.sessionId);
        syncing = false;
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
      for (let round = 0; round < 140 && stableRounds < 8; round += 1) {
        const items = adapter.scan().filter(Boolean);
        const fresh = items.filter((item) => !seen.has(item.id) || recordChanged(seen.get(item.id), item));
        for (const item of items) seen.set(item.id, item);
        if (fresh.length) {
          await sendBatches(adapter.platform, sessionId, fresh);
          if (adapter.hydrate) adapter.hydrate(fresh).then((hydrated) => sendBatches(adapter.platform, sessionId, hydrated)).catch(() => {});
        }
        overlay.update(`已收集 ${seen.size} 条 · 正在加载更多`);
        stableRounds = seen.size === lastCount && nearBottom() ? stableRounds + 1 : 0;
        lastCount = seen.size;
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
        await delay(700);
      }
      if (!seen.size) throw new Error("页面中未识别到视频，请确认已登录并打开稍后再看列表");
      const result = await message({ type: "SOURCE_SYNC_COMPLETE", platform: adapter.platform, sessionId, seenIds: [...seen.keys()] });
      if (!result?.ok) throw new Error(result?.error || "同步收尾失败");
      completed = true;
      overlay.update(`同步完成：${seen.size} 条`, "success");
    } catch (error) {
      overlay.update(`同步未完成：${error.message || error}`, "error");
    } finally {
      setTimeout(() => overlay.remove(), completed ? 3500 : 8000);
    }
  }

  async function sendBatches(platform, sessionId, items) {
    for (let index = 0; index < items.length; index += 40) {
      const result = await message({ type: "SOURCE_SYNC_UPSERT", platform, sessionId, items: items.slice(index, index + 40) });
      if (!result?.ok) throw new Error(result?.error || "写入本地资料库失败");
    }
  }

  function recordChanged(previous, next) {
    return ["title", "creator", "durationSeconds", "progressSeconds", "thumbnailUrl", "nativeCategory"].some((key) => previous?.[key] !== next?.[key]);
  }

  function nearBottom() {
    return window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 240;
  }

  function waitForPage(selector) {
    if (!selector || document.querySelector(selector)) return Promise.resolve();
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        if (document.querySelector(selector)) { observer.disconnect(); resolve(); }
      });
      observer.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => { observer.disconnect(); resolve(); }, 12000);
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
