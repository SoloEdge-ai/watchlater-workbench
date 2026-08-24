(function (root, factory) {
  root.WLWDatabase = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DB_NAME = "watchlater-workbench";
  const DB_VERSION = 1;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        const videos = db.createObjectStore("videos", { keyPath: "id" });
        videos.createIndex("platform", "platform");
        videos.createIndex("status", "status");
        videos.createIndex("category", "category");
        const snapshots = db.createObjectStore("snapshots", { keyPath: "id" });
        snapshots.createIndex("platform", "platform");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("数据库事务已取消"));
    });
  }

  async function getVideo(id) {
    const db = await openDatabase();
    const tx = db.transaction("videos", "readonly");
    const result = await requestResult(tx.objectStore("videos").get(id));
    db.close();
    return result || null;
  }

  async function getVideos(ids) {
    const db = await openDatabase();
    const tx = db.transaction("videos", "readonly");
    const store = tx.objectStore("videos");
    const items = await Promise.all(ids.map((id) => requestResult(store.get(id))));
    db.close();
    return items.filter(Boolean);
  }

  async function getAllVideos() {
    const db = await openDatabase();
    const tx = db.transaction("videos", "readonly");
    const result = await requestResult(tx.objectStore("videos").getAll());
    db.close();
    return result;
  }

  async function putVideos(items) {
    if (!items.length) return;
    const db = await openDatabase();
    const tx = db.transaction("videos", "readwrite");
    const store = tx.objectStore("videos");
    for (const item of items) store.put(item);
    await transactionDone(tx);
    db.close();
  }

  async function completeSnapshot(platform, snapshotId, seenIds, completedAt = Date.now()) {
    const seen = new Set(seenIds);
    const db = await openDatabase();
    const tx = db.transaction(["videos", "snapshots"], "readwrite");
    const store = tx.objectStore("videos");
    tx.objectStore("snapshots").put({ id: snapshotId, platform, completedAt, count: seen.size, complete: true });
    await new Promise((resolve, reject) => {
      const cursorRequest = store.openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return resolve();
        const item = cursor.value;
        if (item.platform === platform) {
          if (seen.has(item.id)) cursor.update({ ...item, status: item.manualArchived ? "archived" : "current", lastSnapshotId: snapshotId });
          else if (item.status !== "archived") cursor.update({ ...item, status: "archived", archivedAt: completedAt });
        }
        cursor.continue();
      };
      cursorRequest.onerror = () => reject(cursorRequest.error);
    });
    await transactionDone(tx);
    db.close();
  }

  async function clearAll() {
    const db = await openDatabase();
    const tx = db.transaction(["videos", "snapshots"], "readwrite");
    tx.objectStore("videos").clear();
    tx.objectStore("snapshots").clear();
    await transactionDone(tx);
    db.close();
  }

  async function deletePlatform(platform) {
    const db = await openDatabase();
    const tx = db.transaction(["videos", "snapshots"], "readwrite");
    for (const storeName of ["videos", "snapshots"]) {
      const index = tx.objectStore(storeName).index("platform");
      await new Promise((resolve, reject) => {
        const request = index.openCursor(IDBKeyRange.only(platform));
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor) return resolve();
          cursor.delete();
          cursor.continue();
        };
        request.onerror = () => reject(request.error);
      });
    }
    await transactionDone(tx);
    db.close();
  }

  return { openDatabase, getVideo, getVideos, getAllVideos, putVideos, completeSnapshot, clearAll, deletePlatform };
});
