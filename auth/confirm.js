/*
 * gamechest.games/auth/confirm/ – löst den Link aus den Supabase-Auth-Mails ein.
 * Spec: GrabGame/docs/specs/auth_bestaetigung.md
 *
 * Die Mail verlinkt ?token_hash=…&type=…; eingelöst wird erst auf Klick, damit Mail-Scanner, die Links
 * vorab öffnen, das Token nicht verbrauchen. Spricht direkt die Supabase-Auth-REST-API an (kein SDK,
 * keine Hydration – postbuild entfernt das Next-Laufzeit-JS). Das Token lebt nur im Speicher dieser
 * Seite und wird sofort aus der Adresszeile entfernt; nichts wird gespeichert oder geloggt.
 */
(function () {
  'use strict';
  var SUPABASE_URL = 'https://vopnawagkhzemqqzfxch.supabase.co';
  // Öffentlicher Publishable Key (steht ohnehin in jeder App); Rechte regelt RLS.
  var SUPABASE_KEY = 'sb_publishable_t3CFnbENuZWLUDm-YqHXaA_7AJt0M8t';
  var MIN_PASSWORD = 6; // Supabase-Standard; der Server prüft ohnehin selbst
  var TYPES = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'];

  var root = document.querySelector('[data-auth-root]');
  if (!root) return;

  var params = new URLSearchParams(location.search);
  var tokenHash = params.get('token_hash') || '';
  var type = params.get('type') || '';
  // Fehler, die Supabase selbst anhängt (alter Link-Stil: #error=…&error_code=otp_expired)
  var hashParams = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (location.search || location.hash) history.replaceState(null, '', location.pathname);

  function show(state, errorKey) {
    root.setAttribute('data-state', state);
    var panels = root.querySelectorAll('[data-panel]');
    for (var i = 0; i < panels.length; i++) {
      panels[i].hidden = panels[i].getAttribute('data-panel') !== state;
    }
    if (errorKey) {
      var reasons = root.querySelectorAll('[data-reason]');
      for (var j = 0; j < reasons.length; j++) {
        reasons[j].hidden = reasons[j].getAttribute('data-reason') !== errorKey;
      }
    }
    var active = root.querySelector('[data-panel="' + state + '"] h1');
    if (active) {
      active.setAttribute('tabindex', '-1');
      active.focus({ preventScroll: true });
    }
  }

  function busy(button, on) {
    button.disabled = on;
    button.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  function reasonFor(body) {
    var code = (body && (body.error_code || body.code)) || '';
    if (code === 'otp_expired' || code === 'flow_state_expired') return 'expired';
    if (code === 'over_request_rate_limit' || code === 429) return 'rate';
    return 'invalid';
  }

  function request(method, path, payload, token) {
    var headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    return fetch(SUPABASE_URL + path, {
      method: method,
      headers: headers,
      body: payload ? JSON.stringify(payload) : undefined,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    }).then(function (res) {
      return res
        .json()
        .catch(function () {
          return {};
        })
        .then(function (body) {
          return { ok: res.ok, body: body };
        });
    });
  }

  var accessToken = '';

  function verify(button, next) {
    busy(button, true);
    request('POST', '/auth/v1/verify', { type: type, token_hash: tokenHash })
      .then(function (r) {
        if (!r.ok) return show('error', reasonFor(r.body));
        accessToken = r.body.access_token || '';
        next();
      })
      .catch(function () {
        show('error', 'network');
      })
      .then(function () {
        busy(button, false);
      });
  }

  // Einstieg
  if (hashParams.get('error_code') || hashParams.get('error')) {
    show('error', reasonFor({ error_code: hashParams.get('error_code') }));
  } else if (!tokenHash || TYPES.indexOf(type) < 0) {
    show('error', 'invalid');
  } else if (type === 'recovery') {
    show('recovery-ready');
  } else {
    show(type === 'email_change' ? 'change-ready' : 'ready');
  }

  var confirmButtons = root.querySelectorAll('[data-action="confirm"]');
  for (var k = 0; k < confirmButtons.length; k++) {
    confirmButtons[k].addEventListener('click', function (e) {
      var b = e.currentTarget;
      verify(b, function () {
        // Die Sitzung gehört nicht in den Browser: gleich wieder abmelden, eingeloggt wird in der App.
        if (accessToken) request('POST', '/auth/v1/logout', null, accessToken).catch(function () {});
        accessToken = '';
        show(type === 'email_change' ? 'change-done' : 'done');
      });
    });
  }

  var recoveryButton = root.querySelector('[data-action="recovery"]');
  if (recoveryButton) {
    recoveryButton.addEventListener('click', function () {
      verify(recoveryButton, function () {
        show('password');
        var first = root.querySelector('#new-password');
        if (first) first.focus();
      });
    });
  }

  var form = root.querySelector('[data-form="password"]');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var pw = form.querySelector('#new-password').value;
      var again = form.querySelector('#new-password-again').value;
      var hint = form.querySelector('[data-hint]');
      var say = function (key) {
        var hints = form.querySelectorAll('[data-hint-text]');
        for (var i = 0; i < hints.length; i++) hints[i].hidden = hints[i].getAttribute('data-hint-text') !== key;
        hint.hidden = !key;
      };
      if (pw.length < MIN_PASSWORD) return say('short');
      if (pw !== again) return say('mismatch');
      say('');
      var submit = form.querySelector('button[type="submit"]');
      busy(submit, true);
      request('PUT', '/auth/v1/user', { password: pw }, accessToken)
        .then(function (r) {
          if (!r.ok) {
            var code = (r.body && (r.body.error_code || r.body.code)) || '';
            if (code === 'weak_password') return say('weak');
            if (code === 'same_password') return say('same');
            return show('error', reasonFor(r.body));
          }
          request('POST', '/auth/v1/logout', null, accessToken).catch(function () {});
          accessToken = '';
          show('password-done');
        })
        .catch(function () {
          say('network');
        })
        .then(function () {
          busy(submit, false);
        });
    });
  }
})();
