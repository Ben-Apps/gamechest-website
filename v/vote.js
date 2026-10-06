/*
 * gamechest.games/v/<key> bzw. /v/?k=<key>: Abstimmung „Which one tonight?“ ohne App und ohne Konto.
 * Spec: GrabGame/docs/specs/update_1.0.5.md F2 (Website-Teil). Muster: /c/share.js.
 *
 * Lädt die Abstimmung über die Edge Function game-vote (action "resolve", kein Login), eine Stimme geht per
 * action "cast" mit einer zufälligen Browser-ID (localStorage gc_voter). Tipp auf eine Karte = Stimme, danach
 * Balken mit Zahlen; die Stimme lässt sich bis zum Ende wechseln. Abgelaufen: Endstand, Führende mit Krone.
 * Nur textContent, kein innerHTML mit fremden Daten. Cover nur von images.igdb.com / *.steamstatic.com.
 * Kein Cookie, keine Analytics.
 *
 * Alle Namen des Server-Vertrags (Function, Aktionen, Felder, Fehlercodes) stehen NUR in VOTE_API und readVote():
 * weicht der endgültige Vertrag von Strang B ab, wird nur dort angeglichen.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else if (typeof document !== 'undefined') api.start();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------- Server-Vertrag (game-vote) ----------------

  var VOTE_API = {
    functionName: 'game-vote',
    production: 'https://vopnawagkhzemqqzfxch.supabase.co/functions/v1/',
    // Öffentlicher Publishable Key (steht ohnehin in jeder App und in /c/share.js).
    publishableKey: 'sb_publishable_t3CFnbENuZWLUDm-YqHXaA_7AJt0M8t',
    actions: { resolve: 'resolve', cast: 'cast' },
    // Fehlercodes aus { error: { code, message } } (Muster chest-share); der HTTP-Status entscheidet zuerst.
    codes: { notFound: 'not_found', gone: 'gone', ended: 'ended', alreadyVoted: 'already_voted', rateLimited: 'rate_limited' },
  };

  var KEY = /^[2-9A-HJ-NP-Z]{8}$/; // Alphabet wie chest-share (ohne 0, O, 1, I), 8 Zeichen
  var MAX_OPTIONS = 4;
  var MAX_TITLE = 120;
  var VOTER_KEY = 'gc_voter';
  var CHOICES_KEY = 'gc_votes';
  var MAX_CHOICES = 30; // so viele Abstimmungen merkt sich der Browser höchstens (nur Key → Kartennummer)
  var REFRESH_MS = 30000;
  var MAX_REFRESHES = 20; // 10 Minuten nachladen, dann nur noch beim Zurückkehren auf den Tab

  function endpoint(loc) {
    // Nur für die lokale Vorschau (Testserver): gleiche Origin statt Produktion, wie /c/share.js.
    if (loc && /^(localhost|127\.0\.0\.1)$/.test(loc.hostname)) return loc.origin + '/functions/v1/' + VOTE_API.functionName;
    return VOTE_API.production + VOTE_API.functionName;
  }

  /**
   * Der einzige Netzaufruf der Seite. Antwort immer { status, body } (body = geparstes JSON oder {}),
   * Netzfehler → { status: 0, body: {} }.
   */
  function callVoteApi(url, payload, fetchImpl) {
    return fetchImpl(url, {
      method: 'POST',
      headers: { apikey: VOTE_API.publishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    }).then(
      function (res) {
        return res
          .json()
          .catch(function () {
            return {};
          })
          .then(function (body) {
            return { status: res.status, body: body || {} };
          });
      },
      function () {
        return { status: 0, body: {} };
      }
    );
  }

  function resolvePayload(key, voter) {
    // With the voter id the server answers `myVote`, so a reload shows the own vote (Vertrag 1.0.5 § 10).
    return voter ? { action: VOTE_API.actions.resolve, key: key, voter: voter } : { action: VOTE_API.actions.resolve, key: key };
  }
  function castPayload(key, index, voter) {
    return { action: VOTE_API.actions.cast, key: key, index: index, voter: voter };
  }

  // ---------------- Reine Helfer (in test/vote.test.mjs geprüft) ----------------

  function tidy(value, limit) {
    if (typeof value !== 'string') return '';
    var flat = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    return flat.length <= limit ? flat : flat.substring(0, limit).trim();
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
    } catch {
      return null;
    }
  }

  function count(value) {
    return typeof value === 'number' && isFinite(value) && value > 0 ? Math.floor(value) : 0;
  }

  /**
   * Antwort von resolve/cast → Ansichtsmodell. Unbrauchbar (keine 2 Karten) → null.
   * Vertrag laut Spec: { key, options: [{ index, title, coverUrl, platform, votes }], total, expiresAt, ended }.
   */
  function readVote(body) {
    if (!body || typeof body !== 'object' || !Array.isArray(body.options)) return null;
    var options = [];
    var seen = {};
    for (var i = 0; i < body.options.length && options.length < MAX_OPTIONS; i++) {
      var raw = body.options[i] || {};
      var index = typeof raw.index === 'number' ? raw.index : i;
      var title = tidy(raw.title, MAX_TITLE);
      if (!title || index !== Math.floor(index) || index < 0 || index >= MAX_OPTIONS || seen[index]) continue;
      seen[index] = true;
      options.push({
        index: index,
        title: title,
        platform: tidy(raw.platform, 40),
        cover: safeCover(raw.coverUrl),
        votes: count(raw.votes),
      });
    }
    if (options.length < 2) return null;
    var sum = options.reduce(function (s, o) {
      return s + o.votes;
    }, 0);
    var expires = Date.parse(body.expiresAt);
    return {
      key: typeof body.key === 'string' ? body.key : '',
      options: options,
      total: Math.max(count(body.total), sum),
      expiresAt: isNaN(expires) ? null : expires,
      ended: body.ended === true,
      myVote: typeof body.myVote === 'number' && seen[body.myVote] ? body.myVote : null,
    };
  }

  /** Kartennummern mit den meisten Stimmen (mehrere bei Gleichstand), leer ohne Stimmen. */
  function leaders(vote) {
    var max = 0;
    vote.options.forEach(function (o) {
      if (o.votes > max) max = o.votes;
    });
    if (!max) return [];
    return vote.options
      .filter(function (o) {
        return o.votes === max;
      })
      .map(function (o) {
        return o.index;
      });
  }

  /** Breite des Balkens in Prozent (0 bis 100) – Anteil an allen Stimmen. */
  function share(votes, total) {
    if (!total || !votes) return 0;
    return Math.round((votes / total) * 100);
  }

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  /** „Ends in 23 h“, „Ends in 40 min“, „Ends in 1 min“; null ohne Datum. */
  function endsText(expiresAt, now) {
    if (expiresAt === null || expiresAt === undefined) return null;
    var ms = expiresAt - now;
    if (ms <= 0) return null;
    var minutes = Math.ceil(ms / 60000);
    if (minutes < 60) return 'Ends in ' + minutes + ' min';
    return 'Ends in ' + Math.floor(minutes / 60) + ' h';
  }

  /** Abgelaufen laut Server oder laut Uhr (die Uhr allein entscheidet nie über „gone“, nur über die Anzeige). */
  function isEnded(vote, now) {
    return vote.ended || (vote.expiresAt !== null && vote.expiresAt <= now);
  }

  /** Zeile unter dem Titel im Endstand. */
  function resultLine(vote) {
    var top = leaders(vote);
    if (!top.length) return 'No one voted.';
    if (top.length > 1) return 'It is a tie. ' + plural(vote.total, 'vote') + ' in total.';
    var winner = vote.options.filter(function (o) {
      return o.index === top[0];
    })[0];
    return winner.title + ' won with ' + winner.votes + ' of ' + plural(vote.total, 'vote') + '.';
  }

  /** Zufällige Browser-ID für cast: 32 Hex-Zeichen (Spec: 16 bis 64). */
  function newVoterId(cryptoImpl) {
    var bytes = new Uint8Array(16);
    if (cryptoImpl && cryptoImpl.getRandomValues) cryptoImpl.getRandomValues(bytes);
    else for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    var hex = '';
    for (var j = 0; j < bytes.length; j++) hex += (bytes[j] < 16 ? '0' : '') + bytes[j].toString(16);
    return hex;
  }

  function isVoterId(value) {
    return typeof value === 'string' && /^[0-9a-f]{16,64}$/.test(value);
  }

  /** Key aus /v/K7Q2XM9P (Netlify-Rewrite) oder ?k=K7Q2XM9P (GitHub-Pages-Weg über 404.html). */
  function keyFrom(pathname, search) {
    var params = new URLSearchParams(search || '');
    var match = /^\/v\/([^\/?#]+)\/?$/.exec(pathname || '');
    var raw = params.get('k') || (match && match[1] !== 'index.html' ? decodeURIComponent(match[1]) : '') || '';
    return raw.trim().toUpperCase();
  }

  // ---------------- Seite ----------------

  function start() {
    var root = document.querySelector('[data-vote-root]');
    if (!root) return;

    var ua = navigator.userAgent || '';
    var isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    var isAndroid = /Android/.test(ua);
    root.setAttribute('data-device', isIOS || isAndroid ? 'mobile' : 'desktop');
    var PLAY_URL = root.getAttribute('data-play-url') || '';
    var APP_STORE_URL = root.getAttribute('data-app-store-url') || '';
    var url = endpoint(location);
    var key = keyFrom(location.pathname, location.search);
    var vote = null;
    var mine = null; // Kartennummer der eigenen Stimme oder null
    var busy = false;
    var refreshes = 0;
    var timer = 0;

    function $(sel, scope) {
      return (scope || root).querySelector(sel);
    }
    function $$(sel, scope) {
      return Array.prototype.slice.call((scope || root).querySelectorAll(sel));
    }
    function field(scope, name) {
      return scope.querySelector('[data-field="' + name + '"]');
    }

    // localStorage kann fehlen oder werfen (privates Fenster): dann zählt laut Spec der IP-Hash.
    function storageGet(name) {
      try {
        return window.localStorage.getItem(name);
      } catch {
        return null;
      }
    }
    function storageSet(name, value) {
      try {
        window.localStorage.setItem(name, value);
      } catch {
        /* nichts */
      }
    }
    var voter = storageGet(VOTER_KEY);
    if (!isVoterId(voter)) {
      voter = newVoterId(window.crypto);
      storageSet(VOTER_KEY, voter);
    }
    function readChoices() {
      try {
        var parsed = JSON.parse(storageGet(CHOICES_KEY) || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      } catch {
        return {};
      }
    }
    function rememberChoice(index) {
      var choices = readChoices();
      delete choices[key];
      choices[key] = index;
      var keys = Object.keys(choices);
      while (keys.length > MAX_CHOICES) delete choices[keys.shift()];
      storageSet(CHOICES_KEY, JSON.stringify(choices));
    }
    var stored = readChoices()[key];
    if (typeof stored === 'number' && stored >= 0 && stored < MAX_OPTIONS) mine = stored;

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

    function platformKind(platform) {
      var p = String(platform || '').toLowerCase();
      if (/switch|nintendo|wii|3ds|game ?boy/.test(p)) return 'nintendo';
      if (/\bpc\b|windows|steam|mac|linux/.test(p)) return 'pc';
      return 'other';
    }

    function titleOf(index) {
      var hit = vote && vote.options.filter(function (o) {
        return o.index === index;
      })[0];
      return hit ? hit.title : '';
    }

    function setError(text) {
      field(root, 'error').textContent = text || '';
    }

    // Karten einmal bauen (gleiche Knoten bei jedem neuen Stand: Bilder bleiben geladen).
    var cards = {};
    function buildCards() {
      var list = $('[data-options]');
      list.textContent = '';
      cards = {};
      vote.options.forEach(function (option) {
        var li = $('[data-option-template]').content.firstElementChild.cloneNode(true);
        var button = $('[data-cast]', li);
        field(li, 'title').textContent = option.title;
        field(li, 'title').title = option.title;
        field(li, 'platform').textContent = option.platform;
        field(li, 'initial').textContent = option.title.charAt(0).toUpperCase();
        $('[data-platform-kind]', li).setAttribute('data-platform-kind', platformKind(option.platform));
        if (option.cover) {
          var img = field(li, 'cover');
          img.src = option.cover;
          img.alt = 'Cover of ' + option.title;
          img.hidden = false;
          img.addEventListener('error', function () {
            this.hidden = true;
          });
        }
        button.addEventListener('click', function () {
          cast(option.index);
        });
        cards[option.index] = li;
        list.appendChild(li);
      });
    }

    function render(next) {
      var rebuild = !vote || vote.options.length !== next.options.length ||
        next.options.some(function (o, i) {
          return !vote.options[i] || vote.options[i].index !== o.index || vote.options[i].title !== o.title;
        });
      vote = next;
      if (rebuild) buildCards();
      if (mine !== null && !titleOf(mine)) mine = null;

      var now = Date.now();
      var ended = isEnded(vote, now);
      var showResults = ended || mine !== null;
      var top = ended ? leaders(vote) : [];

      root.setAttribute('data-ended', ended ? 'true' : 'false');
      field(root, 'eyebrow').textContent = ended ? 'Vote ended' : 'Vote';
      var meta;
      if (ended) {
        meta = 'This vote has ended. ' + resultLine(vote);
      } else {
        var ends = endsText(vote.expiresAt, now);
        meta = showResults ? plural(vote.total, 'vote') : 'Tap the game you would play.';
        if (ends) meta += ' · ' + ends;
      }
      field(root, 'meta').textContent = meta;

      var status = '';
      if (mine !== null) {
        status = 'You voted for ' + titleOf(mine) + '.';
        if (!ended) status += ' Tap another game to change your vote.';
      }
      field(root, 'status').textContent = status;

      $('[data-options]').setAttribute('data-results', showResults ? 'true' : 'false');
      vote.options.forEach(function (option) {
        var li = cards[option.index];
        if (!li) return;
        var isMine = option.index === mine;
        var isLeader = top.indexOf(option.index) !== -1;
        li.setAttribute('data-mine', isMine ? 'true' : 'false');
        li.setAttribute('data-leader', isLeader ? 'true' : 'false');
        var button = $('[data-cast]', li);
        button.disabled = ended;
        button.setAttribute('aria-pressed', isMine ? 'true' : 'false');
        field(li, 'fill').style.width = (showResults ? share(option.votes, vote.total) : 0) + '%';
        field(li, 'count').textContent = String(option.votes);
        var label = option.title;
        if (option.platform) label += ', ' + option.platform;
        if (showResults) label += ', ' + plural(option.votes, 'vote');
        if (isLeader) label += ', most votes';
        if (isMine) label += ', your vote';
        if (!ended) label += isMine ? '' : '. Tap to vote';
        button.setAttribute('aria-label', label);
      });
      document.title = (ended ? 'Vote ended' : 'Which one tonight?') + ' · GameChest';
      show('ready');
      schedule();
    }

    function handleLoad(result) {
      var next = result.status === 200 ? readVote(result.body) : null;
      if (next) {
        if (next.myVote !== null) {
          mine = next.myVote;
          rememberChoice(next.myVote);
        }
        render(next);
        return;
      }
      if (result.status === 200 || result.status === 400 || result.status === 404 || result.status === 410) {
        show('missing');
      } else if (!vote) {
        show('error', result.status === 429 ? 'rate' : 'network');
      }
    }

    function load() {
      if (!KEY.test(key)) {
        show('missing');
        return;
      }
      if (!vote) show('loading');
      callVoteApi(url, resolvePayload(key, voter), window.fetch.bind(window)).then(handleLoad);
    }

    function cast(index) {
      if (!vote || busy || isEnded(vote, Date.now()) || index === mine) return;
      busy = true;
      root.setAttribute('data-busy', 'true');
      setError('');
      field(root, 'status').textContent = 'Counting your vote…';
      callVoteApi(url, castPayload(key, index, voter), window.fetch.bind(window)).then(function (result) {
        busy = false;
        root.setAttribute('data-busy', 'false');
        var next = result.status === 200 ? readVote(result.body) : null;
        if (next) {
          mine = index;
          rememberChoice(index);
          render(next);
          return;
        }
        var code = result.body && result.body.error && result.body.error.code;
        if (result.status === 409 || code === VOTE_API.codes.alreadyVoted) {
          setError('A vote from this network was already counted.');
          // A 409 carries no tally (Vertrag 1.0.5 § 10): fetch the current state.
          load();
        } else if (result.status === 410 || code === VOTE_API.codes.ended) {
          setError('');
        } else if (result.status === 429) {
          setError('Too many votes right now. Wait a minute and try again.');
        } else if (result.status === 404) {
          show('missing');
          return;
        } else {
          setError('Your vote did not go through. Check your connection and try again.');
        }
        render(vote); // alten Stand wiederherstellen (Statuszeile)
        if (result.status === 409 || result.status === 410) load();
      });
    }

    // Stand nachladen, solange die Abstimmung läuft und die Seite sichtbar ist.
    function schedule() {
      window.clearTimeout(timer);
      if (!vote || isEnded(vote, Date.now()) || refreshes >= MAX_REFRESHES) return;
      timer = window.setTimeout(function () {
        if (document.visibilityState !== 'visible' || busy) return;
        refreshes++;
        load();
      }, REFRESH_MS);
    }
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && vote && !isEnded(vote, Date.now()) && !busy) {
        refreshes = 0;
        load();
      }
    });

    root.addEventListener('click', function (event) {
      var target = event.target.closest('[data-action]');
      if (target && target.getAttribute('data-action') === 'retry') load();
    });

    // Store-Link je Gerät, wie /c/: iPhone → App Store, Android → Google Play.
    var store = isIOS ? APP_STORE_URL : isAndroid ? PLAY_URL : PLAY_URL || APP_STORE_URL;
    $$('[data-store-link]').forEach(function (a) {
      if (store) a.href = store;
    });

    load();
  }

  return {
    VOTE_API: VOTE_API,
    endpoint: endpoint,
    callVoteApi: callVoteApi,
    resolvePayload: resolvePayload,
    castPayload: castPayload,
    readVote: readVote,
    leaders: leaders,
    share: share,
    endsText: endsText,
    isEnded: isEnded,
    resultLine: resultLine,
    newVoterId: newVoterId,
    isVoterId: isVoterId,
    keyFrom: keyFrom,
    start: start,
  };
});
