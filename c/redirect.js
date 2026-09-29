/*
 * Läuft nur in 404.html: GitHub Pages kennt keine dynamischen Pfade. Ein geteilter Kurzlink
 * gamechest.games/c/K7Q2XM landet deshalb hier und wird auf die statische Seite /c/?k=K7Q2XM
 * umgeleitet. Nur genau dieses Muster; alles andere bleibt die normale 404-Seite.
 * Spec: GrabGame/docs/specs/kurzlink_truhe.md
 */
(function () {
  'use strict';
  var match = /^\/c\/([2-9A-HJ-NP-Za-hj-np-z]{6})\/?$/.exec(location.pathname);
  if (match) location.replace('/c/?k=' + match[1].toUpperCase());
})();
