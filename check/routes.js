/*
  The addresses the walk opens: every page of js/routes.js at least once, on the mock's
  data (check/mock.js), signed in as ada unless `out` says signed out.

    { path, name, out?, expect?(url, status) }   expect: answers that belong to this page
*/
'use strict';

const missing = (url, status) => status === 404 && /\/api\/(scripts\/nosuch|users\/(nobody|@nobody))/.test(url);

module.exports = [
  { path: '/', name: 'home' },
  { path: '/scripts', name: 'scripts' },
  { path: '/maps', name: 'maps' },
  { path: '/profile', name: 'profile' },
  { path: '/scripts/ada-trainer', name: 'script-own' },
  { path: '/scripts/ada-hyper', name: 'script-draft' },
  { path: '/scripts/pub-03', name: 'script-other' },
  { path: '/scripts/ada-trainer/view?revision=2', name: 'viewer' },
  { path: '/scripts/ada-trainer/edit', name: 'editor' },
  { path: '/@ada/audit', name: 'audit' },
  { path: '/@bob', name: 'user' },
  { path: '/users/u-kim/scripts', name: 'user-by-id' },
  { path: '/settings', name: 'settings' },
  { path: '/settings/editor', name: 'editor-settings' },
  { path: '/settings/editor/lint', name: 'lint-rules' },
  { path: '/scripts/nosuch', name: 'script-missing', expect: missing },
  { path: '/@nobody', name: 'user-missing', expect: missing },
  { path: '/nowhere/at/all', name: 'not-found' },
  { path: '/', name: 'home-out', out: true },
  { path: '/scripts', name: 'scripts-out', out: true },
  { path: '/scripts/pub-03', name: 'script-out', out: true },
  { path: '/login', name: 'login', out: true },
  { path: '/register', name: 'register', out: true },
  { path: '/logout', name: 'logout' },
];
