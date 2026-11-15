if (isScramjet) {
  (function installScramjetIdbGuard() {
    if (typeof IDBFactory === "undefined" || !IDBFactory.prototype?.open) return;
    const REQUIRED_STORES = [
      "config",
      "cookies",
      "redirectTrackers",
      "referrerPolicies",
      "publicSuffixList",
    ];
    const openDbs = new Set();
    self.__sunshineCloseScramjetDbs = () => {
      for (const db of openDbs) {
        try {
          db.close();
        } catch {}
      }
      openDbs.clear();
    };
    const origOpen = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function patchedScramjetOpen(name) {
      const req = origOpen.apply(this, arguments);
      if (name === "$scramjet") {
        // Ensure all Scramjet object stores exist even if SW opens $scramjet v1 before the page controller
        req.addEventListener("upgradeneeded", (ev) => {
          try {
            const db = ev.target?.result || req.result;
            if (!db) return;
            for (const store of REQUIRED_STORES) {
              if (!db.objectStoreNames.contains(store)) {
                db.createObjectStore(store);
              }
            }
          } catch {}
        });
        // Track connections and release immediately on versionchange so healing deleteDatabase never blocks
        req.addEventListener("success", () => {
          try {
            const db = req.result;
            if (!db) return;
            openDbs.add(db);
            db.addEventListener("close", () => openDbs.delete(db));
            db.addEventListener("versionchange", () => {
              try {
                db.close();
              } catch {}
              openDbs.delete(db);
            });
          } catch {}
        });
      }
      return req;
    };
  })();
  importScripts("/b/s/jetty.all.js");
  const { ScramjetServiceWorker } = $scramjetLoadWorker();
  scramjet = new ScramjetServiceWorker();
} else if (isUltraviolet) {
  importScripts("/b/u/bunbun.js", "/b/u/concon.js", "/b/u/serser.js");
  uv = new UVServiceWorker();
}