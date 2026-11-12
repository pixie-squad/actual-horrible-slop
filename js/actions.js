/*
  What can be done with a script, a map and an event, whichever style asks.

  Each tells the person how it went through the style's own toast and dialog (NT.ui),
  and goes where it leads through the style's navigation (NT.nav).

    NT.actions.share(script)             the share sheet where there is one, else the link is copied
    NT.actions.publish(script, done)
    NT.actions.remove(script, done, source)   asks first
    NT.actions.create()                  a new script, opened in the editor
    NT.actions.upload(file)              a file from the device, as a new script
    NT.actions.favorite(script, on)      → Promise; script.is_favorite is set at once and
                                           put back if it does not go through
    NT.actions.copy(text)                to the clipboard
    NT.actions.mapLink(text)             → { id } | { error }
    NT.actions.event(ev, scripts)        an audit event, in words: { type, title, notes: [],
                                           path, script, onScript }
*/
(function () {
  'use strict';
  const NT = window.NT;
  const API = NT.api;
  const toast = (...a) => NT.ui.toast(...a);

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
        toast('Couldn’t publish', { warn: true });
      }
    },

    async remove(s, done, source) {
      const ok = await NT.ui.confirm({
        title: `Delete “${s.name || s.script_id}”?`,
        message: 'This can’t be undone.',
        confirmLabel: 'Delete',
        destructive: true,
        source,
      });
      if (!ok) return;
      try {
        await API.deleteScript(s.script_id);
        toast('Deleted', { icon: 'trash' });
        if (done) done();
      } catch (e) {
        toast('Couldn’t delete', { warn: true });
      }
    },

    async create() {
      if (!API.session) return void NT.ui.signIn('login');
      try {
        const mine = await API.userScripts(API.session.user_id);
        const id = await API.createScript(`New Script ${mine.length + 1}`, '');
        NT.nav.go(`/scripts/${id}/edit`);
      } catch (e) {
        toast('Couldn’t create a script', { warn: true });
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
      try {
        const id = await API.createScript(name, text);
        NT.nav.go(`/scripts/${id}/edit`);
      } catch (e) {
        toast('Couldn’t upload', { warn: true });
      }
    },

    async favorite(s, on) {
      s.is_favorite = on;
      try {
        await API.setFavorite(s.script_id, on);
        return true;
      } catch (e) {
        s.is_favorite = !on;
        toast('Couldn’t update favorites', { warn: true });
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
