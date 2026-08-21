(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  root.WLWSourceActionRuntime = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  async function run(adapter, deps = {}) {
    const send = deps.send || message;
    let overlay = deps.overlay || null;
    let action = null;
    let platformSucceeded = false;
    const ensureOverlay = () => (overlay ||= createOverlay(adapter.label));
    try {
      if (adapter.accountReadySelector) await waitForPage(adapter.accountReadySelector);
      let account;
      try { account = await adapter.identifyAccount(); }
      catch (error) {
        const rejected = await send({ type: "CLAIM_SOURCE_ACTION", platform: adapter.platform, account: null });
        if (!rejected?.ok) ensureOverlay().update(rejected.error || String(error?.message || error), "error");
        return { completed: false, error: rejected?.error || String(error?.message || error) };
      }
      const claimed = await send({ type: "CLAIM_SOURCE_ACTION", platform: adapter.platform, account });
      if (!claimed?.ok) {
        ensureOverlay().update(claimed?.error || "账号验证失败，未执行平台操作", "error");
        return { completed: false, error: claimed?.error || "claim failed" };
      }
      action = claimed.action;
      if (!action) {
        return { completed: false, idle: true };
      }

      ensureOverlay().update(`正在从账号中移除：${action.title || action.videoId}`);
      await adapter.removeVideo(action.videoId, { allowAlreadyMissing: action.allowAlreadyMissing === true });
      platformSucceeded = true;
      const completed = await send({ type: "SOURCE_ACTION_COMPLETE", platform: adapter.platform, actionId: action.id });
      if (!completed?.ok) {
        overlay.update(`平台已移除；本地归档将在后台恢复：${completed?.error || "写入失败"}`, "error");
        return { completed: false, platformSucceeded: true, error: completed?.error };
      }
      ensureOverlay().update("平台移除成功，本地已归档", "success");
      return { completed: true };
    } catch (error) {
      const text = String(error?.message || error);
      if (!platformSucceeded && action) {
        await send({ type: "SOURCE_ACTION_FAILED", platform: adapter.platform, actionId: action.id, error: text });
      }
      ensureOverlay().update(platformSucceeded ? `平台已移除；本地归档待恢复：${text}` : `移除失败：${text}`, "error");
      return { completed: false, platformSucceeded, error: text };
    } finally {
      if (overlay && (action || !deps.overlay)) {
        const timer = setTimeout(() => overlay.remove(), platformSucceeded ? 5000 : 8000);
        timer.unref?.();
      }
    }
  }

  function start(adapter) {
    run(adapter).catch(() => {});
  }

  function createOverlay(label) {
    const node = root.document.createElement("div");
    node.id = "wlw-source-action-overlay";
    Object.assign(node.style, {
      position: "fixed", right: "22px", bottom: "22px", zIndex: "2147483647",
      padding: "14px 18px", borderRadius: "12px", color: "#fff", background: "#20242b",
      boxShadow: "0 12px 40px rgba(0,0,0,.28)", font: "14px system-ui", maxWidth: "360px"
    });
    node.textContent = `${label}：准备验证删除操作`;
    root.document.documentElement.append(node);
    return {
      update(text, state) {
        node.textContent = `${label}：${text}`;
        node.style.background = state === "success" ? "#20734b" : state === "error" ? "#a83f4c" : "#20242b";
      },
      remove() { node.remove(); }
    };
  }

  function message(payload) {
    return root.chrome.runtime.sendMessage(payload).catch((error) => ({ ok: false, error: String(error?.message || error) }));
  }

  function waitForPage(selector) {
    if (!selector || root.document?.querySelector(selector)) return Promise.resolve();
    return new Promise((resolve) => {
      let timer;
      const observer = new root.MutationObserver(() => {
        if (root.document.querySelector(selector)) { observer.disconnect(); clearTimeout(timer); resolve(); }
      });
      observer.observe(root.document.documentElement, { childList: true, subtree: true });
      timer = setTimeout(() => { observer.disconnect(); resolve(); }, 12000);
      timer.unref?.();
    });
  }

  return { run, start };
});
