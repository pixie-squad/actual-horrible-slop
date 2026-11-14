/*
  Local History: what each file of a script was at each save, kept in this browser
  (IndexedDB nt-history), as VS Code's Timeline keeps it. The service keeps releases
  only, and this server nothing, so a save between two releases is otherwise gone once
  it is saved over. Nothing of it leaves the browser.

    NT.history.record(scriptId, files)  after a save went through: an entry for each file
                                        whose text is not what its last entry holds
    NT.history.list(scriptId, path)     → Promise of [{ id, path, at, chars, lines }], newest first;
                                        without path, every file's
    NT.history.text(id)                 → Promise of what the entry holds, or null
    NT.history.paths(scriptId)          → Promise of the paths that have entries
    NT.history.clear(scriptId)          the script was deleted

  Kept: the last 50 saves of a file, for 30 days, 32 MB in all; the oldest go first.
  Where IndexedDB cannot be opened (a private window may refuse it) nothing is kept,
  and list answers [].
*/
(function () {
  'use strict';
  const NT = window.NT;

  const NAME = 'nt-history';
  const PER_FILE = 50;
  const DAYS = 30;
  const BUDGET = 32 * 1024 * 1024; // characters, about bytes for code
  let opening = null;

  function open() {
    if (!opening) {
      opening = new Promise((resolve) => {
        let req;
        try { req = indexedDB.open(NAME, 1); } catch (e) { return resolve(null); }
        req.onupgradeneeded = () => {
          const db = req.result;
          const s = db.createObjectStore('saves', { keyPath: 'id', autoIncrement: true });
          s.createIndex('file', ['script', 'path', 'at']);
          s.createIndex('script', 'script');
          s.createIndex('at', 'at');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      });
    }
    return opening;
  }

  const done = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const finished = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });

  // A file's entries, oldest first, without their text.
  async function entries(store, script, path) {
    const range = IDBKeyRange.bound([script, path, ''], [script, path, '￿']);
    const out = [];
    await new Promise((resolve, reject) => {
      const req = store.index('file').openCursor(range);
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve();
        const v = c.value;
        out.push({ id: v.id, path: v.path, at: v.at, chars: v.text.length, lines: v.lines, sum: v.sum });
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
    return out;
  }

  // The oldest go until what is left is within the budget and the age.
  async function trim(db) {
    const tx = db.transaction('saves', 'readwrite');
    const store = tx.objectStore('saves');
    const old = new Date(Date.now() - DAYS * 86400000).toISOString();
    const all = [];
    await new Promise((resolve, reject) => {
      const req = store.index('at').openCursor();
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return resolve();
        all.push({ id: c.value.id, at: c.value.at, chars: c.value.text.length });
        c.continue();
      };
      req.onerror = () => reject(req.error);
    });
    let total = all.reduce((n, e) => n + e.chars, 0);
    for (const e of all) {
      if (e.at >= old && total <= BUDGET) break;
      store.delete(e.id);
      total -= e.chars;
    }
    await finished(tx);
  }

  let pending = Promise.resolve();

  NT.history = {
    record(script, files) {
      const at = new Date().toISOString();
      // One after another, so two saves in a row never both think a file is new.
      pending = pending.then(async () => {
        const db = await open();
        if (!db) return;
        const tx = db.transaction('saves', 'readwrite');
        const store = tx.objectStore('saves');
        let added = 0;
        for (const [path, text] of Object.entries(files)) {
          if (typeof text !== 'string') continue;
          const list = await entries(store, script, path);
          const sum = NT.util.hash(text) + ':' + text.length;
          const last = list[list.length - 1];
          if (last && last.sum === sum) continue;
          store.add({ script, path, at, text, sum, lines: text.split('\n').length });
          added++;
          for (const e of list.slice(0, Math.max(0, list.length + 1 - PER_FILE))) store.delete(e.id);
        }
        await finished(tx);
        if (added) await trim(db);
      }).catch((e) => console.warn('Local History:', e && e.message));
      return pending;
    },
    async list(script, path) {
      const db = await open();
      if (!db) return [];
      const store = db.transaction('saves').objectStore('saves');
      let out;
      if (path != null) out = await entries(store, script, path);
      else {
        const all = await done(store.index('script').getAll(script));
        out = all.map((v) => ({ id: v.id, path: v.path, at: v.at, chars: v.text.length, lines: v.lines }));
      }
      return out.map(({ id, path: p, at, chars, lines }) => ({ id, path: p, at, chars, lines })).sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id));
    },
    async text(id) {
      const db = await open();
      if (!db) return null;
      const v = await done(db.transaction('saves').objectStore('saves').get(id));
      return v ? v.text : null;
    },
    async paths(script) {
      return [...new Set((await this.list(script)).map((e) => e.path))].sort();
    },
    async clear(script) {
      const db = await open();
      if (!db) return;
      const tx = db.transaction('saves', 'readwrite');
      const store = tx.objectStore('saves');
      const keys = await done(store.index('script').getAllKeys(script));
      for (const k of keys) store.delete(k);
      await finished(tx);
    },
  };
})();
