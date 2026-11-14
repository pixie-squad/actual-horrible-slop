/*
  What can be done with a script, a map and an event, whichever style asks.

  Each tells the person how it went through the style's own toast and dialog (NT.ui),
  and goes where it leads through the style's navigation (NT.nav).

    NT.actions.share(script)             the share sheet where there is one, else the link is copied
    NT.actions.publish(script, done)
    NT.actions.remove(script, done)      at once, with a few seconds to take it back (Undo);
                                         NT.bus says 'scripts' when it comes back
    NT.actions.removeMap(map, done, back) the same for a map; back() when it comes back
    NT.actions.create()                  a new script, opened in the editor
    NT.actions.upload(file)              a file from the device, as a new script
    NT.actions.duplicate(script)         a copy of it as a new script of one's own, opened in the editor
    NT.actions.favorite(script, on)      → Promise; script.is_favorite is set at once and
                                           put back if it does not go through
    NT.actions.copy(text)                to the clipboard
    NT.actions.mapLink(text)             → { id } | { error }
    NT.actions.event(ev, scripts)        an audit event, in words: { type, title, notes: [],
                                           path, script, onScript }

  When something does not go through, the words are these, in every style:
    NT.actions.couldnt(what, err)        'Couldn’t publish', with why where there is
                                         more to say: 'Couldn’t publish: no connection'
    NT.actions.failed(what, err, again)  that as a warning toast, with Try Again (again)
                                         or, when the session is over, Sign In
    NT.actions.trouble(err)              under a page that did not load: 'Can’t reach
                                         scripting.nulls.gg', 'Signed out', or ''
*/
(function () {
  'use strict';
  const NT = window.NT;
  const API = NT.api;
  const toast = (...a) => NT.ui.toast(...a);

  // How long a delete can be taken back.
  const UNDO = 6000;

  // Why a call did not go through, where it is worth saying: the service out of reach,
  // or a session that is over (and could not be begun again: api.js tries that first).
  const reason = (e) => (API.unreachable(e) ? 'offline' : e && e.status === 401 ? 'signed-out' : null);
  const couldnt = (what, e) => {
    const why = reason(e);
    return `Couldn’t ${what}${why === 'offline' ? ': no connection' : why === 'signed-out' ? ': signed out' : ''}`;
  };
  const failed = (what, e, again) => {
    const action = reason(e) === 'signed-out'
      ? { label: 'Sign In', onSelect: () => NT.ui.signIn('login') }
      : again ? { label: 'Try Again', onSelect: again } : null;
    toast(couldnt(what, e), { warn: true, action });
  };

  // What each kind of event is called.
  const EVENT = {
    UserRegister: 'Account Created',
    UserLogin: 'Signed In',
    UserLogout: 'Signed Out',
    UserPasswordChange: 'Password Changed',
    ScriptCreate: 'Script Created',
    ScriptUpdate: 'Script Edited',
    ScriptPublish: 'Script Published',
    ScriptDelete: 'Script Deleted',
    FavoriteAdd: 'Favorite Added',
    FavoriteRemove: 'Favorite Removed',
    MapCreate: 'Map Added',
    MapUpdate: 'Map Updated',
    MapDelete: 'Map Deleted',
  };
  // An update that says which part changed is called by that part.
  const CHANGED = {
    ScriptUpdate: { name: 'Script Renamed', description: 'Description Edited', map: 'Map Changed' },
    MapUpdate: { name: 'Map Renamed' },
  };

  NT.actions = {
    couldnt,
    failed,
    trouble: (e) => (reason(e) === 'offline' ? 'Upstream is unreachable' : reason(e) === 'signed-out' ? 'Signed out' : ''),

    async share(s) {
      const url = new URL(NT.nav.href(`/scripts/${s.script_id}`), location.href).href;
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
        try { await navigator.share({ title: s.name || s.script_id, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; }
      }
      try {
        await navigator.clipboard.writeText(url);
        toast('Link copied', { icon: 'link' });
      } catch (e) {
        toast('Couldn’t copy the link', { warn: true });
      }
    },

    async publish(s, done) {
      try {
        await API.publish(s.script_id);
        toast('Published', { icon: 'send' });
        if (done) done();
      } catch (e) {
        failed('publish', e, () => this.publish(s, done));
      }
    },

    // Not asked about first: it can be taken back for a few seconds, and only then goes.
    remove(s, done) {
      const d = API.deleting(s.script_id);
      let settled = false; // taken back, or gone for good
      if (done) done();
      toast('Deleted', {
        icon: 'trash',
        duration: UNDO,
        action: { label: 'Undo', onSelect: () => {
          if (settled) return;
          settled = true;
          d.cancel();
          NT.bus.emit('scripts', { id: s.script_id });
        } },
      });
      setTimeout(async () => {
        if (settled) return;
        settled = true;
        try {
          await d.commit();
        } catch (e) {
          NT.bus.emit('scripts', { id: s.script_id });
          failed('delete', e, () => this.remove(s));
        }
      }, UNDO);
    },

    removeMap(m, done, back) {
      const d = API.deletingMap(m.user_map_id);
      let settled = false; // taken back, or gone for good
      if (done) done();
      toast('Deleted', {
        icon: 'trash',
        duration: UNDO,
        action: { label: 'Undo', onSelect: () => {
          if (settled) return;
          settled = true;
          d.cancel();
          if (back) back();
        } },
      });
      setTimeout(async () => {
        if (settled) return;
        settled = true;
        try {
          await d.commit();
        } catch (e) {
          if (back) back();
          failed('delete', e, () => this.removeMap(m, done, back));
        }
      }, UNDO);
    },

    async create() {
      if (!API.session) return void NT.ui.signIn('login');
      try {
        const mine = await API.userScripts(API.session.user_id);
        const id = await API.createScript(`New Script ${mine.length + 1}`, '');
        NT.nav.go(`/scripts/${id}/edit`);
      } catch (e) {
        failed('create a script', e, () => this.create());
      }
    },

    async upload(file) {
      if (!file) return;
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      } catch (e) {
        return void toast('That file isn’t UTF-8 text', { warn: true });
      }
      if (text.length > 1000000) return void toast('Scripts are limited to 1,000,000 characters', { warn: true });
      let name = file.name.replace(/\.(luau?|txt)$/i, '').slice(0, 32);
      if (name.length < 3) name = (name + ' script').slice(0, 32);
      const send = async () => {
        try {
          const id = await API.createScript(name, text);
          NT.nav.go(`/scripts/${id}/edit`);
        } catch (e) {
          failed('upload', e, send);
        }
      };
      return send();
    },

    // A new script of the person's own with this one's code, opened in the editor. A
    // project of their own comes with its files; anyone else's comes as the code they
    // can read. The copy is a draft, and has no picture.
    async duplicate(s) {
      if (!API.session) return void NT.ui.signIn('login');
      try {
        const res = await API.scriptContent(s.script_id);
        const code = (res && res.content) || '';
        const p = API.isOwner(s) && NT.project.multi() ? await NT.project.load(s.script_id, code).catch(() => null) : null;
        const name = `${(s.name || 'Script').slice(0, 27).trimEnd()} Copy`;
        const id = await API.createScript(name, code);
        if (p && Object.keys(p.files).length > 1) {
          const r = await NT.project.store(id, p.files, p.minify);
          if (r.bundle && r.bundle.code != null && NT.project.fits(id, r.bundle)) await NT.project.report(id, r.bundle, r.base);
        }
        NT.nav.go(`/scripts/${id}/edit`);
      } catch (e) {
        failed('duplicate', e, () => NT.actions.duplicate(s));
      }
    },

    // The control that was pressed is the way to try again.
    async favorite(s, on) {
      s.is_favorite = on;
      try {
        await API.setFavorite(s.script_id, on);
        return true;
      } catch (e) {
        s.is_favorite = !on;
        failed('update favorites', e);
        return false;
      }
    },

    async copy(text) {
      try {
        await navigator.clipboard.writeText(text);
        toast('Copied', { icon: 'copy' });
      } catch (e) {
        toast('Couldn’t copy', { warn: true });
      }
    },

    mapLink(text) {
      let url;
      try { url = new URL(String(text).trim()); } catch (e) { return { error: 'That isn’t a link.' }; }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: 'That isn’t a web link.' };
      if (url.hostname.toLowerCase() !== 'link.nulls.gg') return { error: 'Use a link.nulls.gg map link.' };
      const id = (url.searchParams.get('roomname') || '').trim();
      if (!id) return { error: 'That link has no map in it.' };
      return { id: id.replace(/^map:/, '') };
    },

    // scripts: the ones that still exist, by id. Only those have a name and a page to go to.
    event(ev, scripts) {
      const type = String(ev.event_type);
      const changes = ev.changes && typeof ev.changes === 'object' ? ev.changes : {};
      const part = Object.keys(CHANGED[type] || {}).find((k) => changes[k]);
      const onScript = /^(Script|Favorite)/.test(type);
      const script = onScript ? scripts.get(ev.target_id) : null;
      const notes = [];
      if (onScript) notes.push(script ? script.name || script.script_id : String(ev.target_id));
      if (changes.revision != null) notes.push(`Revision ${changes.revision}`);
      // Saves in one sitting arrive as one event.
      if (changes.count > 1) notes.push(`${changes.count} ${changes.content ? 'saves' : 'changes'}`);
      const path = !script ? null
        : type === 'ScriptPublish' && changes.revision != null ? `/scripts/${script.script_id}/view?revision=${changes.revision}`
          : `/scripts/${script.script_id}`;
      return {
        type,
        known: !!EVENT[type],
        title: part ? CHANGED[type][part] : EVENT[type] || type.replace(/([a-z])([A-Z])/g, '$1 $2'),
        notes,
        path,
        script,
        onScript,
      };
    },
  };
})();
