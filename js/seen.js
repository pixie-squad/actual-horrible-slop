/*
  What this browser has seen of each script: when it had last been released at the time
  its page was opened here (nt.seen). A favorite released again since is Updated, and
  its page offers what changed in between (compare.js). Nothing of it leaves the browser.

    NT.seen.updated(script)          a favorite of someone else's that has been released since
                                     it was last looked at here. The first time a favorite is
                                     met, as it is then counts as seen.
    NT.seen.since(script, releases)  the revision it was at when last looked at here, if a
                                     release has come out since; else null
    NT.seen.mark(script)             it has been looked at, as it is now
*/
(function () {
  'use strict';
  const NT = window.NT;
  const API = NT.api;
  const { store } = NT.util;
  const KEY = 'nt.seen';
  const MAX = 400;
  // A release and the script's release time are written apart; this much is one moment.
  const SKEW = 60000;

  let seen = store.get(KEY, {}) || {};
  const time = (v) => new Date(v).getTime();

  function keep(s) {
    seen[s.script_id] = { at: s.published_at, t: Date.now() };
    const ids = Object.keys(seen);
    // The scripts looked at longest ago go first.
    if (ids.length > MAX) ids.sort((a, b) => seen[a].t - seen[b].t).slice(0, ids.length - MAX).forEach((id) => delete seen[id]);
    store.set(KEY, seen);
  }
  const mine = (s) => !!API.session && s.author_uuid === API.session.user_id;
  const newer = (s) => !!seen[s.script_id] && time(s.published_at) > time(seen[s.script_id].at);

  NT.seen = {
    updated(s) {
      if (!s || !s.is_favorite || !s.published_at || mine(s)) return false;
      if (!seen[s.script_id]) {
        keep(s);
        return false;
      }
      return newer(s);
    },
    since(s, releases) {
      if (!s || !s.published_at || mine(s) || !newer(s)) return null;
      const revs = (releases || []).filter((r) => Number.isSafeInteger(r.revision));
      if (!revs.length) return null;
      const by = time(seen[s.script_id].at) + SKEW;
      const then = revs.filter((r) => time(r.created_at) <= by).map((r) => r.revision);
      const at = then.length ? Math.max(...then) : null;
      return at != null && at < Math.max(...revs.map((r) => r.revision)) ? at : null;
    },
    mark(s) {
      if (s && s.published_at) keep(s);
    },
  };
})();
