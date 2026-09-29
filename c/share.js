/*
 * gamechest.games/c/?k=<key> – zeigt eine geteilte Truhe ohne App und ohne Konto.
 * Spec: GrabGame/docs/specs/kurzlink_truhe.md
 *
 * Lädt Code + Snapshot über die Edge Function chest-share (action "resolve", kein Login), füllt die
 * data-field-Elemente aus dem <template> und filtert nach Status. Nur textContent – kein innerHTML
 * mit fremden Daten. Cover nur von images.igdb.com / *.steamstatic.com (wie der Server erzwingt).
 * Nichts wird gespeichert, keine Cookies, keine Analytics.
 */
(function () {
  'use strict';
  var ENDPOINT = 'https://vopnawagkhzemqqzfxch.supabase.co/functions/v1/chest-share';
  // Nur für die lokale Vorschau (pnpm preview / Testserver): gleiche Origin statt Produktion.
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) ENDPOINT = location.origin + '/functions/v1/chest-share';
  // Öffentlicher Publishable Key (steht ohnehin in jeder App).
  var SUPABASE_KEY = 'sb_publishable_t3CFnbENuZWLUDm-YqHXaA_7AJt0M8t';
  var KEY = /^[2-9A-HJ-NP-Z]{6}$/;
  var STATUS_LABEL = { want: 'Want to play', playing: 'Playing', completed: 'Completed', dropped: 'Dropped' };

  var root = document.querySelector('[data-chest-root]');
  if (!root) return;

  var params = new URLSearchParams(location.search);
  var key = (params.get('k') || '').trim().toUpperCase();
  var code = '';

  function show(state, reason) {
    root.setAttribute('data-state', state);
    var panels = root.querySelectorAll('[data-panel]');
    for (var i = 0; i < panels.length; i++) {
      panels[i].hidden = panels[i].getAttribute('data-panel') !== state;
    }
    if (reason) {
      var reasons = root.querySelectorAll('[data-reason]');
      for (var j = 0; j < reasons.length; j++) {
        reasons[j].hidden = reasons[j].getAttribute('data-reason') !== reason;
      }
    }
  }

  function field(scope, name) {
    return scope.querySelector('[data-field="' + name + '"]');
  }

  function safeCover(value) {
    if (typeof value !== 'string' || value.length > 400) return null;
    try {
      var url = new URL(value);
      var host = url.hostname.toLowerCase();
      if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
      if (host !== 'images.igdb.com' && !/\.steamstatic\.com$/.test(host)) return null;
      url.search = '';
      url.hash = '';
      return url.href;
    } catch (e) {
      return null;
    }
  }

  function starsText(value) {
    if (typeof value !== 'number' || value <= 0) return '';
    var full = Math.floor(value);
    var text = '';
    for (var i = 0; i < full; i++) text += '★';
    if (value - full >= 0.5) text += '½';
    return text;
  }

  var GLYPH = { playing: '▶', completed: '✓', dropped: '✕', want: '' };
  var ORDER = { playing: 0, completed: 1, want: 2, dropped: 3 };

  function platformKind(platform) {
    var p = String(platform || '').toLowerCase();
    if (/switch|nintendo|wii|3ds|game ?boy/.test(p)) return 'nintendo';
    if (/\bpc\b|windows|steam|mac|linux/.test(p)) return 'pc';
    return 'other';
  }

  function render(snapshot, expiresAt) {
    var raw = snapshot && Array.isArray(snapshot.games) ? snapshot.games : [];
    var name = snapshot && typeof snapshot.name === 'string' ? snapshot.name.trim() : '';
    var games = [];
    for (var g = 0; g < raw.length; g++) {
      var item = raw[g] || {};
      if (typeof item.title !== 'string' || !item.title) continue;
      games.push({
        title: item.title,
        platform: typeof item.platform === 'string' ? item.platform : '',
        status: STATUS_LABEL[item.status] ? item.status : 'want',
        stars: typeof item.stars === 'number' ? item.stars : 0,
        coverUrl: item.coverUrl,
      });
    }
    // Playing, Completed (Sterne absteigend), Want, Dropped; sonst Titel A–Z – deterministisch wie die App.
    games.sort(function (a, b) {
      return (
        ORDER[a.status] - ORDER[b.status] ||
        (a.status === 'completed' ? b.stars - a.stars : 0) ||
        a.title.localeCompare(b.title, 'en', { sensitivity: 'base' })
      );
    });

    var owner = name ? name + '’s GameChest' : 'A shared GameChest';
    field(root, 'owner').textContent = owner;
    var summary = games.length + (games.length === 1 ? ' game' : ' games');
    var until = Date.parse(expiresAt);
    if (!isNaN(until)) {
      summary += ' · shared until ' + new Date(until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }
    field(root, 'summary').textContent = summary;
    document.title = owner + ' · ' + games.length + (games.length === 1 ? ' game' : ' games');

    var list = root.querySelector('[data-list]');
    var template = root.querySelector('[data-card-template]');
    var counts = { all: games.length, want: 0, playing: 0, completed: 0, dropped: 0 };
    var fragment = document.createDocumentFragment();
    for (var i = 0; i < games.length; i++) {
      var game = games[i];
      counts[game.status]++;
      var card = template.content.firstElementChild.cloneNode(true);
      card.setAttribute('data-status', game.status);
      card.style.setProperty('--i', String(i));
      var title = field(card, 'title');
      title.textContent = game.title;
      title.title = game.title;
      field(card, 'glyph').textContent = GLYPH[game.status];
      var sub = field(card, 'sub');
      var stars = starsText(game.stars);
      if (stars) {
        sub.textContent = stars;
        sub.setAttribute('data-kind', 'stars');
        sub.setAttribute('aria-label', game.stars + ' of 5 stars');
      } else {
        sub.textContent = game.platform;
      }
      card.querySelector('[data-platform-kind]').setAttribute('data-platform-kind', platformKind(game.platform));
      field(card, 'initial').textContent = game.title.charAt(0).toUpperCase();
      var cover = safeCover(game.coverUrl);
      if (cover) {
        var img = field(card, 'cover');
        img.src = cover;
        img.hidden = false;
        img.addEventListener('error', function () {
          this.hidden = true;
        });
      }
      fragment.appendChild(card);
    }
    list.appendChild(fragment);

    var tiles = root.querySelectorAll('[data-filter]');
    for (var c = 0; c < tiles.length; c++) {
      var id = tiles[c].getAttribute('data-filter');
      var badge = tiles[c].querySelector('[data-chip-count]');
      if (badge) badge.textContent = String(counts[id] || 0);
      if (id !== 'all' && !counts[id]) tiles[c].disabled = true;
      if (id === 'dropped' && !counts.dropped) tiles[c].hidden = true;
      tiles[c].addEventListener('click', onFilter);
    }
    if (!games.length) {
      root.querySelector('[data-tiles]').hidden = true;
      root.querySelector('[data-nothing]').hidden = false;
    }
    show('ready');
  }

  var current = 'all';
  function onFilter(event) {
    var chosen = event.currentTarget.getAttribute('data-filter');
    // Zweiter Tipp auf die aktive Kachel geht zurück auf „All“.
    if (chosen === current && chosen !== 'all') chosen = 'all';
    current = chosen;
    var tiles = root.querySelectorAll('[data-filter]');
    for (var i = 0; i < tiles.length; i++) {
      tiles[i].setAttribute('aria-pressed', tiles[i].getAttribute('data-filter') === chosen ? 'true' : 'false');
    }
    var cards = root.querySelectorAll('[data-list] > [data-status]');
    var visible = 0;
    for (var j = 0; j < cards.length; j++) {
      var match = chosen === 'all' || cards[j].getAttribute('data-status') === chosen;
      cards[j].hidden = !match;
      cards[j].style.animation = 'none';
      if (match) visible++;
    }
    root.querySelector('[data-empty]').hidden = visible > 0;
  }

  function load() {
    if (!KEY.test(key)) {
      show('missing');
      return;
    }
    show('loading');
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'resolve', key: key }),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    })
      .then(function (res) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            if (res.ok && body && typeof body.code === 'string') {
              code = body.code;
              render(body.snapshot, body.expiresAt);
            } else if (res.status === 404 || res.status === 400 || res.status === 410) {
              show('missing');
            } else {
              show('error', res.status === 429 ? 'rate' : 'network');
            }
          });
      })
      .catch(function () {
        show('error', 'network');
      });
  }

  root.addEventListener('click', function (event) {
    var target = event.target.closest('[data-action]');
    if (!target) return;
    var action = target.getAttribute('data-action');
    if (action === 'retry') load();
    if (action === 'copy' && code) {
      var done = function (ok) {
        field(root, 'copied').textContent = ok
          ? 'Code copied. Paste it on the Compare page in GameChest.'
          : 'Copying did not work. Open the Compare page and ask your friend for the code.';
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(function () { done(true); }, function () { done(false); });
      } else {
        done(false);
      }
    }
  });

  load();
})();
