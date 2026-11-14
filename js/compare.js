/*
  Comparing two versions of a script: a release with the one before it, or what the
  script is now with its last release. Whichever style shows it; the difference itself
  is drawn by Monaco (NT.code.diff), and the viewer is where it is shown
  (/scripts/<id>/view?revision=<newer>&against=<older>; no revision is what it is now).

    NT.compare.before(releases, revision)   the revision released before `revision`, or
                                            null; with no revision, the latest release
    NT.compare.load(id, revision, against)  → Promise of { before: { text, label },
                                            after: { text, label } }
    NT.compare.title(revision, against)     'Revision 2 → 3', 'Revision 3 → Draft'
    NT.compare.words(stats)                 what NT.code.diff counted, in words:
                                            '+12 −3', 'No changes'
    NT.compare.path(id, revision, against)  the viewer's address for it
*/
(function () {
  'use strict';
  const NT = window.NT;
  const API = NT.api;

  const num = (r) => (r == null || r === '' ? null : Number(r));
  const label = (r) => (num(r) == null ? 'Draft' : `Revision ${num(r)}`);

  NT.compare = {
    before(releases, revision) {
      const revs = (releases || []).map((r) => num(r.revision)).filter((r) => Number.isFinite(r)).sort((a, b) => b - a);
      const at = num(revision);
      if (at == null) return revs.length ? revs[0] : null;
      const older = revs.find((r) => r < at);
      return older == null ? null : older;
    },
    async load(id, revision, against) {
      const [a, b] = await Promise.all([API.scriptContent(id, num(against)), API.scriptContent(id, num(revision))]);
      return {
        before: { text: (a && a.content) || '', label: label(against) },
        after: { text: (b && b.content) || '', label: label(revision) },
      };
    },
    title: (revision, against) => `${label(against)} → ${label(revision)}`,
    words(stats) {
      if (!stats) return '';
      if (!stats.added && !stats.removed) return 'No changes';
      return `+${stats.added} −${stats.removed}`;
    },
    path(id, revision, against) {
      const q = new URLSearchParams();
      if (num(revision) != null) q.set('revision', num(revision));
      if (num(against) != null) q.set('against', num(against));
      const s = q.toString();
      return `/scripts/${encodeURIComponent(id)}/view${s ? '?' + s : ''}`;
    },
  };
})();
