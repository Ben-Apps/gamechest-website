/*
 * Läuft nur in 404.html: GitHub Pages kennt keine dynamischen Pfade. Ein geteilter Kurzlink
 * gamechest.games/c/K7Q2XM9P (neu 8, ältere 6 Zeichen) landet deshalb hier und wird auf die statische Seite /c/?k=K7Q2XM9P
 * umgeleitet. Nur genau dieses Muster; alles andere bleibt die normale 404-Seite.
 * Seit Update 1.0.5 F2 ebenso die Abstimmung gamechest.games/v/K7Q2XM9P → /v/?k=K7Q2XM9P (nur 8 Zeichen).
 * Spec: GrabGame/docs/specs/kurzlink_truhe.md, GrabGame/docs/specs/update_1.0.5.md
 */
(function () {
  'use strict';
  var match = /^\/c\/((?:[2-9A-HJ-NP-Za-hj-np-z]{6}|[2-9A-HJ-NP-Za-hj-np-z]{8}))\/?$/.exec(location.pathname);
  if (match) {
    location.replace('/c/?k=' + match[1].toUpperCase());
    return;
  }
  var vote = /^\/v\/([2-9A-HJ-NP-Za-hj-np-z]{8})\/?$/.exec(location.pathname);
  if (vote) location.replace('/v/?k=' + vote[1].toUpperCase());
})();
