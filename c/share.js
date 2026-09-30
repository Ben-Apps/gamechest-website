/*
 * gamechest.games/c/<key> bzw. /c/?k=<key> – zeigt eine geteilte Truhe ohne App und ohne Konto.
 * Spec: GrabGame/docs/specs/kurzlink_truhe.md · Ausbau 30.09.2026: GrabGame/wissen/recherche/2026-09-30/website_c_seite/README.md
 *
 * Lädt Code + Snapshot über die Edge Function chest-share (action "resolve", kein Login) und baut daraus:
 * Kopf, Statistik (Status, Plattformen, Sterne), Status-Kacheln + Plattform-Chips + Suche + Sortierung,
 * Cover-Raster, Detail-Dialog je Spiel und die Weiche „In der App öffnen“ (Deep Link, sonst Store).
 * Nur textContent – kein innerHTML mit fremden Daten. Cover nur von images.igdb.com / *.steamstatic.com
 * (wie der Server erzwingt). Nichts wird gespeichert, keine Cookies, keine Analytics.
 */
(function () {
  'use strict';
  var ENDPOINT = 'https://vopnawagkhzemqqzfxch.supabase.co/functions/v1/chest-share';
  // Nur für die lokale Vorschau (pnpm preview / Testserver): gleiche Origin statt Produktion.
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) ENDPOINT = location.origin + '/functions/v1/chest-share';
  // Öffentlicher Publishable Key (steht ohnehin in jeder App).
  var SUPABASE_KEY = 'sb_publishable_t3CFnbENuZWLUDm-YqHXaA_7AJt0M8t';
  var KEY = /^(?:[2-9A-HJ-NP-Z]{6}|[2-9A-HJ-NP-Z]{8})$/; // neu 8, ältere Links 6
  // Deep Link in die App (Handling baut die App: com.creaiter.gamechest://c/<KEY>[?game=<Titel>]).
  var APP_SCHEME = 'com.creaiter.gamechest://c/';
  var FALLBACK_MS = 1500;
  var STATUS_LABEL = { want: 'Want to play', playing: 'Playing', completed: 'Completed', dropped: 'Dropped' };
  var STATUS_KEYS = ['playing', 'completed', 'want', 'dropped'];
  var GLYPH = { playing: '▶', completed: '✓', dropped: '✕', want: '' };
  var ORDER = { playing: 0, completed: 1, want: 2, dropped: 3 };
  var MAX_BARS = window.innerWidth < 720 ? 4 : 5; // Handy: kompakter (Rest → „Other“)

  var root = document.querySelector('[data-chest-root]');
  if (!root) return;

  var ua = navigator.userAgent || '';
  var isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/.test(ua);
  var isMobile = isIOS || isAndroid;
  root.setAttribute('data-device', isMobile ? 'mobile' : 'desktop');
  var PLAY_URL = root.getAttribute('data-play-url') || '';
  var APP_STORE_URL = root.getAttribute('data-app-store-url') || '';

  // Key aus dem Pfad (/c/K7Q2XM9P – Netlify liefert /c/index.html per 200-Rewrite aus, siehe _redirects)
  // oder aus ?k= (/c/?k=K7Q2XM9P – alter Weg über 404.html → redirect.js, GitHub Pages). Beides wird unterstützt.
  var params = new URLSearchParams(location.search);
  var pathMatch = /^\/c\/([^\/?#]+)\/?$/.exec(location.pathname);
  var key = (params.get('k') || (pathMatch && pathMatch[1] !== 'index.html' ? decodeURIComponent(pathMatch[1]) : '') || '')
    .trim()
    .toUpperCase();
  var code = '';
  var ownerName = '';
  var games = [];
  var state = { status: 'all', platform: 'all', query: '', sort: 'status' };

  function $(sel, scope) {
    return (scope || root).querySelector(sel);
  }
  function $$(sel, scope) {
    return Array.prototype.slice.call((scope || root).querySelectorAll(sel));
  }
  function field(scope, name) {
    return scope.querySelector('[data-field="' + name + '"]');
  }
  function clone(templateSel) {
    return $(templateSel).content.firstElementChild.cloneNode(true);
  }
  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  function show(panel, reason) {
    root.setAttribute('data-state', panel);
    $$('[data-panel]').forEach(function (p) {
      p.hidden = p.getAttribute('data-panel') !== panel;
    });
    if (reason) {
      $$('[data-reason]').forEach(function (r) {
        r.hidden = r.getAttribute('data-reason') !== reason;
      });
    }
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
  // IGDB liefert größere Cover über das Größen-Segment (t_cover_big → t_720p) – nur für den Dialog.
  function bigCover(url) {
    return url ? url.replace('/t_cover_big/', '/t_720p/') : url;
  }

  function starsText(value) {
    if (typeof value !== 'number' || value <= 0) return '';
    var full = Math.floor(value);
    var text = '';
    for (var i = 0; i < full; i++) text += '★';
    if (value - full >= 0.5) text += '½';
    return text;
  }

  function platformKind(platform) {
    var p = String(platform || '').toLowerCase();
    if (/switch|nintendo|wii|3ds|game ?boy/.test(p)) return 'nintendo';
    if (/\bpc\b|windows|steam|mac|linux/.test(p)) return 'pc';
    return 'other';
  }

  function fold(text) {
    return String(text || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();
  }

  // ---------------- Deep Link / Store-Weiche ----------------

  function storeUrl() {
    if (isIOS) return APP_STORE_URL || '';
    if (isAndroid) return PLAY_URL || '';
    return PLAY_URL || APP_STORE_URL || '';
  }

  function appLink(gameTitle) {
    var link = APP_SCHEME + encodeURIComponent(key);
    if (gameTitle) link += '?game=' + encodeURIComponent(gameTitle);
    return link;
  }

  function setHint(el, text, linkText, href) {
    if (!el) return;
    el.textContent = text;
    if (linkText && href) {
      el.appendChild(document.createTextNode(' '));
      var a = document.createElement('a');
      a.href = href;
      a.rel = 'noopener';
      a.textContent = linkText;
      el.appendChild(a);
    }
  }

  /*
   * Versucht die App über das eigene Schema zu öffnen. Wird die Seite in den nächsten 1,5 s nicht verborgen
   * (App hat übernommen → visibilitychange/pagehide), ist die App wohl nicht installiert → Store.
   * iPhone ohne App-Store-URL (App noch im Review): kein Sprung ins Leere, sondern ein Hinweis.
   * Desktop: kein Schema-Versuch (dort gibt es die App nicht) → Hinweis + Store-Badges.
   */
  function openApp(gameTitle, hintEl) {
    if (!isMobile) {
      if (hintEl && hintEl.closest('dialog')) {
        setHint(hintEl, 'GameChest is a phone app: open this link on your phone to add it.', PLAY_URL ? 'Get it on Google Play' : '', PLAY_URL);
        return;
      }
      setHint(hintEl, 'GameChest is a phone app. Open this link on your phone, or get it from the store:');
      var stores = $('[data-stores]');
      if (stores && stores.scrollIntoView) stores.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setHint(hintEl, 'Opening GameChest…');
    var left = false;
    var onHide = function () {
      if (document.visibilityState === 'hidden') left = true;
    };
    var onPageHide = function () {
      left = true;
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    window.setTimeout(function () {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onPageHide);
      if (left || document.visibilityState === 'hidden') {
        setHint(hintEl, '');
        return;
      }
      var store = storeUrl();
      if (store) {
        setHint(hintEl, 'No GameChest app found – taking you to the store.');
        location.href = store;
      } else {
        setHint(
          hintEl,
          'GameChest did not open. The iPhone app is in App Store review – coming soon.',
          PLAY_URL ? 'Android: Google Play' : '',
          PLAY_URL
        );
      }
    }, FALLBACK_MS);
    location.href = appLink(gameTitle);
  }

  // ---------------- Aufbau ----------------

  function normalize(snapshot) {
    var raw = snapshot && Array.isArray(snapshot.games) ? snapshot.games : [];
    var list = [];
    for (var g = 0; g < raw.length; g++) {
      var item = raw[g] || {};
      if (typeof item.title !== 'string' || !item.title) continue;
      list.push({
        index: list.length,
        title: item.title,
        platform: typeof item.platform === 'string' ? item.platform.trim() : '',
        status: STATUS_LABEL[item.status] ? item.status : 'want',
        stars: typeof item.stars === 'number' && item.stars > 0 ? item.stars : 0,
        cover: safeCover(item.coverUrl),
        search: '',
        el: null,
      });
      var last = list[list.length - 1];
      last.search = fold(last.title + ' ' + last.platform);
    }
    return list;
  }

  function renderStats(counts, platforms) {
    var total = games.length;
    // Status: gestapelter Balken + Legende mit Zahlen (Farbe nie allein tragend).
    var stack = $('[data-status-stack]');
    var legend = $('[data-status-legend]');
    STATUS_KEYS.forEach(function (s) {
      if (counts[s]) {
        var part = clone('[data-stack-template]');
        part.setAttribute('data-tone', s);
        part.style.flexGrow = String(counts[s]);
        stack.appendChild(part);
      }
      if (s === 'dropped' && !counts.dropped) return;
      var li = clone('[data-legend-template]');
      $('[data-tone]', li).setAttribute('data-tone', s);
      field(li, 'label').textContent = STATUS_LABEL[s];
      field(li, 'count').textContent = String(counts[s]);
      legend.appendChild(li);
    });

    // Plattformen: Top 5 als Balken, Rest als „Other“.
    var bars = $('[data-platform-bars]');
    var max = platforms.length ? platforms[0].count : 1;
    var shown = platforms.slice(0, MAX_BARS);
    var rest = platforms.slice(MAX_BARS).reduce(function (sum, p) {
      return sum + p.count;
    }, 0);
    if (rest) shown = shown.concat([{ name: 'Other', count: rest }]);
    shown.forEach(function (p) {
      var li = clone('[data-bar-template]');
      field(li, 'name').textContent = p.name;
      field(li, 'name').title = p.name;
      field(li, 'count').textContent = String(p.count);
      field(li, 'fill').style.width = Math.max(4, Math.round((p.count / Math.max(max, rest)) * 100)) + '%';
      li.setAttribute('aria-label', p.name + ': ' + plural(p.count, 'game'));
      bars.appendChild(li);
    });

    // Sterne: Durchschnitt, Anteil bewertet, bestbewertetes Spiel. Ohne Sterne entfällt die Karte.
    var rated = games.filter(function (g) {
      return g.stars > 0;
    });
    var ratingCard = $('[data-rating-card]');
    if (!rated.length) {
      ratingCard.hidden = true;
      var opt = $('[data-needs-stars]');
      if (opt) opt.remove();
    } else {
      var avg =
        rated.reduce(function (sum, g) {
          return sum + g.stars;
        }, 0) / rated.length;
      field(ratingCard, 'avg').textContent = avg.toFixed(1);
      field(ratingCard, 'rated').textContent = 'Average of ' + rated.length + ' rated ' + (rated.length === 1 ? 'game' : 'games') + ' (of ' + total + ')';
      var best = rated.slice().sort(function (a, b) {
        return b.stars - a.stars || a.title.localeCompare(b.title, 'en', { sensitivity: 'base' });
      })[0];
      field(ratingCard, 'top').textContent = 'Top rated: ' + best.title + ' (' + best.stars + ' ★)';
    }
    if (!total) $('[data-stats]').hidden = true;
  }

  function renderChips(platforms) {
    var wrap = $('[data-platform-chips]');
    if (platforms.length < 2) return; // eine Plattform → kein Filter nötig
    var all = [{ id: 'all', name: 'All platforms', count: games.length }].concat(
      platforms.map(function (p) {
        return { id: p.name, name: p.name, count: p.count };
      })
    );
    all.forEach(function (p) {
      var chip = clone('[data-chip-template]');
      chip.setAttribute('data-platform', p.id);
      chip.setAttribute('aria-pressed', p.id === 'all' ? 'true' : 'false');
      field(chip, 'label').textContent = p.name;
      field(chip, 'count').textContent = String(p.count);
      chip.addEventListener('click', function () {
        state.platform = state.platform === p.id && p.id !== 'all' ? 'all' : p.id;
        apply();
      });
      wrap.appendChild(chip);
    });
  }

  function renderCards() {
    var list = $('[data-list]');
    var fragment = document.createDocumentFragment();
    games.forEach(function (game, i) {
      var card = clone('[data-card-template]');
      card.setAttribute('data-status', game.status);
      card.style.setProperty('--i', String(i));
      var button = $('[data-open]', card);
      var title = field(card, 'title');
      title.textContent = game.title;
      title.title = game.title;
      field(card, 'glyph').textContent = GLYPH[game.status];
      var sub = field(card, 'sub');
      var stars = starsText(game.stars);
      if (stars) {
        sub.textContent = stars;
        sub.setAttribute('data-kind', 'stars');
      } else {
        sub.textContent = game.platform;
      }
      var label = game.title + ', ' + STATUS_LABEL[game.status];
      if (game.platform) label += ', ' + game.platform;
      if (game.stars) label += ', ' + game.stars + ' of 5 stars';
      button.setAttribute('aria-label', label + '. Show details');
      $('[data-platform-kind]', card).setAttribute('data-platform-kind', platformKind(game.platform));
      field(card, 'initial').textContent = game.title.charAt(0).toUpperCase();
      if (game.cover) {
        var img = field(card, 'cover');
        img.src = game.cover;
        img.alt = 'Cover of ' + game.title;
        img.hidden = false;
        img.addEventListener('error', function () {
          this.hidden = true;
        });
      }
      button.addEventListener('click', function () {
        openDetail(game, button);
      });
      game.el = card;
      fragment.appendChild(card);
    });
    list.appendChild(fragment);
  }

  function render(snapshot, expiresAt) {
    games = normalize(snapshot);
    ownerName = snapshot && typeof snapshot.name === 'string' ? snapshot.name.trim() : '';

    var owner = ownerName ? ownerName + '’s GameChest' : 'A shared GameChest';
    field(root, 'owner').textContent = owner;
    var summary = plural(games.length, 'game');
    var until = Date.parse(expiresAt);
    if (!isNaN(until)) {
      summary += ' · shared until ' + new Date(until).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
    }
    field(root, 'summary').textContent = summary;
    document.title = owner + ' · ' + plural(games.length, 'game');

    var counts = { all: games.length, want: 0, playing: 0, completed: 0, dropped: 0 };
    var byPlatform = {};
    games.forEach(function (g) {
      counts[g.status]++;
      var name = g.platform || 'Unknown';
      byPlatform[name] = (byPlatform[name] || 0) + 1;
    });
    var platforms = Object.keys(byPlatform)
      .map(function (name) {
        return { name: name, count: byPlatform[name] };
      })
      .sort(function (a, b) {
        return b.count - a.count || a.name.localeCompare(b.name, 'en', { sensitivity: 'base' });
      });

    renderStats(counts, platforms);
    renderChips(platforms);
    renderCards();

    $$('[data-filter]').forEach(function (tile) {
      var id = tile.getAttribute('data-filter');
      var badge = $('[data-chip-count]', tile);
      if (badge) badge.textContent = String(counts[id] || 0);
      if (id !== 'all' && !counts[id]) tile.disabled = true;
      if (id === 'dropped' && !counts.dropped) tile.hidden = true;
      tile.addEventListener('click', function () {
        state.status = state.status === id && id !== 'all' ? 'all' : id;
        apply();
      });
    });

    if (!games.length) {
      $('[data-browse]').hidden = true;
      $('[data-nothing]').hidden = false;
    }

    var search = $('[data-search]');
    var timer = 0;
    search.addEventListener('input', function () {
      window.clearTimeout(timer);
      timer = window.setTimeout(function () {
        state.query = fold(search.value.trim());
        apply();
      }, 120);
    });
    $('[data-sort]').addEventListener('change', function (event) {
      state.sort = event.target.value;
      apply();
    });

    apply(true);
    show('ready');
  }

  function compare(a, b) {
    var byTitle = a.title.localeCompare(b.title, 'en', { sensitivity: 'base' });
    switch (state.sort) {
      case 'title':
        return byTitle;
      case 'rating':
        return b.stars - a.stars || byTitle;
      case 'platform':
        return (a.platform || '~').localeCompare(b.platform || '~', 'en', { sensitivity: 'base' }) || byTitle;
      case 'shared':
        return a.index - b.index;
      default:
        // Playing, Completed (Sterne absteigend), Want, Dropped; sonst Titel A–Z – deterministisch wie die App.
        return ORDER[a.status] - ORDER[b.status] || (a.status === 'completed' ? b.stars - a.stars : 0) || byTitle;
    }
  }

  function apply(initial) {
    $$('[data-filter]').forEach(function (t) {
      t.setAttribute('aria-pressed', t.getAttribute('data-filter') === state.status ? 'true' : 'false');
    });
    $$('[data-platform]').forEach(function (c) {
      c.setAttribute('aria-pressed', c.getAttribute('data-platform') === state.platform ? 'true' : 'false');
    });
    var list = $('[data-list]');
    var sorted = games.slice().sort(compare);
    var visible = 0;
    sorted.forEach(function (g) {
      var match =
        (state.status === 'all' || g.status === state.status) &&
        (state.platform === 'all' || (g.platform || 'Unknown') === state.platform) &&
        (!state.query || g.search.indexOf(state.query) !== -1);
      g.el.hidden = !match;
      if (!initial) g.el.style.animation = 'none';
      if (match) visible++;
      list.appendChild(g.el); // gleiche Knoten, neue Reihenfolge – kein Neuaufbau, Bilder bleiben geladen
    });
    var filtered = state.status !== 'all' || state.platform !== 'all' || !!state.query;
    field(root, 'result').textContent = filtered
      ? 'Showing ' + visible + ' of ' + plural(games.length, 'game')
      : plural(games.length, 'game');
    $('[data-action="clear"]').hidden = !filtered;
    $('[data-empty]').hidden = visible > 0 || !games.length;
  }

  function clearFilters() {
    state.status = 'all';
    state.platform = 'all';
    state.query = '';
    $('[data-search]').value = '';
    apply();
  }

  // ---------------- Detail-Dialog ----------------

  var dialog = $('[data-detail]');
  var current = null;
  var opener = null;

  function detailField(name) {
    return dialog.querySelector('[data-detail-field="' + name + '"]');
  }

  function openDetail(game, from) {
    current = game;
    opener = from;
    detailField('owner').textContent = ownerName ? 'In ' + ownerName + '’s chest' : 'In this chest';
    detailField('title').textContent = game.title;
    detailField('platform').textContent = game.platform || '–';
    var pill = detailField('status');
    pill.textContent = STATUS_LABEL[game.status];
    pill.setAttribute('data-tone', game.status);
    var rating = dialog.querySelector('[data-detail-rating]');
    rating.hidden = !game.stars;
    detailField('stars').textContent = starsText(game.stars);
    detailField('stars').setAttribute('aria-label', game.stars + ' of 5 stars');
    dialog.querySelector('[data-platform-kind]').setAttribute('data-platform-kind', platformKind(game.platform));
    detailField('initial').textContent = game.title.charAt(0).toUpperCase();
    var img = detailField('cover');
    img.hidden = true;
    img.removeAttribute('src');
    if (game.cover) {
      img.alt = 'Cover of ' + game.title;
      img.onerror = function () {
        // Großes IGDB-Format fehlt → normales Cover, sonst gezeichnete Hülle.
        if (img.src !== game.cover) img.src = game.cover;
        else img.hidden = true;
      };
      img.onload = function () {
        img.hidden = false;
      };
      img.src = bigCover(game.cover);
    }
    var add = dialog.querySelector('[data-action="add-game"]');
    add.href = isMobile ? appLink(game.title) : storeUrl() || '/';
    field(dialog, 'detail-hint').textContent = '';
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
      document.documentElement.style.overflow = 'hidden';
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function closeDetail() {
    if (dialog.open && typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  dialog.addEventListener('close', function () {
    document.documentElement.style.overflow = '';
    if (opener && opener.focus) opener.focus();
  });
  // Tipp auf den abgedunkelten Hintergrund schließt (Klick landet dann direkt auf <dialog>).
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) closeDetail();
  });

  // ---------------- Laden ----------------

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
    if (action === 'clear') clearFilters();
    if (action === 'close') closeDetail();
    if (action === 'open-app') {
      event.preventDefault();
      openApp('', field(root, 'app-hint'));
    }
    if (action === 'add-game' && current) {
      event.preventDefault();
      openApp(current.title, field(dialog, 'detail-hint'));
    }
    if (action === 'copy' && code) {
      var done = function (ok) {
        field(root, 'copied').textContent = ok
          ? 'Code copied. Paste it on the Compare page in GameChest.'
          : 'Copying did not work. Ask your friend for the code.';
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(
          function () {
            done(true);
          },
          function () {
            done(false);
          }
        );
      } else {
        done(false);
      }
    }
  });

  // Store-Links je Gerät (iPhone → App Store, sobald die URL gesetzt ist; sonst Google Play).
  var store = storeUrl();
  $$('[data-store-link]').forEach(function (a) {
    if (store) a.href = store;
  });

  load();
})();
