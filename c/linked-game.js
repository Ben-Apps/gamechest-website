/*
 * Welches Spiel meint ein Empfehlungslink gamechest.games/c/<key>?game=<Titel>&gid=<Katalog-ID>?
 * Exakter Nachbau von LinkedGame.find aus der App (GrabGame lib/features/sharing/domain/linked_game.dart,
 * ShelfComparison.matchKey, ShelfCode.tidyId), Spec GrabGame/docs/specs/update_1.0.5.md F3.
 *
 * Reihenfolge:
 *   1. Katalog-ID (gid), wenn Link und Spiel eine haben (Groß/Klein und Leerraum egal);
 *   2. Titel nach der Vergleichsregel der App (matchKey: klein, Akzente weg, & → and, Satzzeichen → Leerzeichen);
 *   3. Titel ohne Editionszusatz („Deluxe Edition“, „GOTY“, „Remastered“, „Director's Cut“, Jahr in Klammern);
 *   4. ein Teil eines Titels mit Untertitel („Morrowind“), aber nur, wenn genau EIN Spiel passt.
 *
 * Reine Funktionen ohne DOM: im Browser als window.GameChestLinkedGame, in Node per require() (test/linked-game.test.mjs).
 * Spiele sind Objekte mit { title, catalogId }; zurück kommt das gefundene Objekt oder null.
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) module.exports = api;
  else root.GameChestLinkedGame = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Ein Teil eines Titels, der kürzer ist, passt nie allein („II“). */
  var MIN_PART_LENGTH = 3;
  /** ShelfCode.maxIdLength: eine Katalog-ID kommt ganz oder gar nicht. */
  var MAX_ID_LENGTH = 100;

  var CONTROL = /[\u0000-\u001f\u007f]/g;
  var YEAR_IN_BRACKETS = /\s*[(\[]\s*(?:19|20)\d\d\s*[)\]]\s*$/;
  var SUBTITLE_BREAK = /\s*:\s*|\s+[-–—]\s+/;
  // Editionswörter am Ende eines matchKey-Schlüssels (Dart: LinkedGame._editionTail).
  var EDITION_TAIL = new RegExp(
    '(?:^|\\s)(?:' +
      '(?:(?:game of the year|goty|digital deluxe|deluxe|definitive|complete|' +
      'ultimate|gold|standard|special|collector s|collectors|enhanced|' +
      'premium|legendary|anniversary|royal|extended|launch)\\s+)?edition' +
      '|goty|remastered|remaster|hd remaster|director s cut|directors cut' +
      ')$'
  );

  // ShelfComparison._fold: Latein mit Zeichen → Grundbuchstabe; ß → ss, & → and, + → plus.
  var FOLD = {};
  function foldAll(chars, to) {
    for (var i = 0; i < chars.length; i++) FOLD[chars[i]] = to;
  }
  foldAll('áàâäãåā', 'a');
  foldAll('éèêëē', 'e');
  foldAll('íìîïī', 'i');
  foldAll('óòôöõøō', 'o');
  foldAll('úùûüū', 'u');
  FOLD['ñ'] = 'n';
  FOLD['ç'] = 'c';
  FOLD['ß'] = 'ss';
  FOLD['æ'] = 'ae';
  FOLD['&'] = ' and ';
  FOLD['+'] = ' plus ';

  /** ShelfCode._tidy: eine Zeile, keine Steuerzeichen, höchstens [limit] Zeichen (UTF-16 wie in Dart). */
  function tidy(value, limit) {
    var flat = String(value == null ? '' : value)
      .replace(CONTROL, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return flat.length <= limit ? flat : flat.substring(0, limit).trim();
  }

  /** ShelfCode.tidyId: null, wenn leer oder zu lang. */
  function tidyId(value) {
    var flat = tidy(value == null ? '' : value, MAX_ID_LENGTH + 1);
    return !flat || flat.length > MAX_ID_LENGTH ? null : flat;
  }

  function idKey(value) {
    var id = tidyId(value);
    return id === null ? null : id.toLowerCase();
  }

  /** ShelfComparison.matchKey: Vergleichsschlüssel eines Titels. */
  function matchKey(title) {
    var text = String(title == null ? '' : title);
    var out = '';
    var pendingSpace = false;
    var lower = text.toLowerCase();
    for (var ch of lower) {
      var folded = Object.prototype.hasOwnProperty.call(FOLD, ch) ? FOLD[ch] : ch;
      for (var unit of folded) {
        var cp = unit.codePointAt(0);
        var isDigit = cp >= 0x30 && cp <= 0x39;
        var isLetter = cp >= 0x61 && cp <= 0x7a;
        // Andere Schriften (Japanisch, Griechisch, Kyrillisch …) bleiben; Latin-1-Zeichen, allgemeine
        // Satzzeichen, buchstabenartige Symbole (™) und CJK-Satzzeichen nicht.
        var isOtherScript =
          cp >= 0xc0 &&
          cp !== 0xd7 &&
          cp !== 0xf7 &&
          !(cp >= 0x2000 && cp <= 0x2bff) &&
          !(cp >= 0x3000 && cp <= 0x303f) &&
          !(cp >= 0xfe10 && cp <= 0xfe6f) &&
          !(cp >= 0xff00 && cp <= 0xff0f) &&
          !(cp >= 0xff1a && cp <= 0xff20);
        if (isDigit || isLetter || isOtherScript) {
          if (pendingSpace && out) out += ' ';
          pendingSpace = false;
          out += unit;
        } else {
          pendingSpace = true;
        }
      }
    }
    return out ? out : lower.trim();
  }

  /** LinkedGame.baseKey: Schlüssel ohne Editionswörter am Ende. */
  function baseKey(title) {
    var key = matchKey(String(title == null ? '' : title).replace(YEAR_IN_BRACKETS, ''));
    for (;;) {
      var shorter = key.replace(EDITION_TAIL, '').trim();
      if (shorter === key || !shorter) return key;
      key = shorter;
    }
  }

  /** LinkedGame.partKeys: Basisschlüssel der Teile eines Titels mit Untertitel. */
  function partKeys(title) {
    var parts = String(title == null ? '' : title).split(SUBTITLE_BREAK);
    var keys = [];
    if (parts.length < 2) return keys;
    for (var i = 0; i < parts.length; i++) {
      var key = baseKey(parts[i]);
      if (key.length >= MIN_PART_LENGTH && keys.indexOf(key) === -1) keys.push(key);
    }
    return keys;
  }

  /**
   * LinkedGame.find: das Spiel aus [games], auf das der Link zeigt, oder null.
   * @param {Array<{title: string, catalogId?: string|null}>} games
   * @param {{title?: string|null, catalogId?: string|null}} wanted
   */
  function find(games, wanted) {
    var list = Array.isArray(games) ? games : [];
    wanted = wanted || {};
    var id = idKey(wanted.catalogId);
    var i;
    if (id !== null) {
      for (i = 0; i < list.length; i++) {
        if (idKey(list[i].catalogId) === id) return list[i];
      }
    }
    var title = typeof wanted.title === 'string' ? wanted.title.trim() : '';
    if (!title) return null;
    var key = matchKey(title);
    for (i = 0; i < list.length; i++) {
      if (matchKey(list[i].title) === key) return list[i];
    }
    var base = baseKey(title);
    if (!base) return null;
    for (i = 0; i < list.length; i++) {
      if (baseKey(list[i].title) === base) return list[i];
    }
    if (base.length < MIN_PART_LENGTH) return null;
    var only = null;
    for (i = 0; i < list.length; i++) {
      if (partKeys(list[i].title).indexOf(base) === -1) continue;
      if (only !== null) return null; // Zwei passen: nicht eindeutig.
      only = list[i];
    }
    return only;
  }

  /** Spec-Name aus update_1.0.5.md F3: findLinkedGame(games, game, gid). */
  function findLinkedGame(games, game, gid) {
    return find(games, { title: game, catalogId: gid });
  }

  return {
    find: find,
    findLinkedGame: findLinkedGame,
    matchKey: matchKey,
    baseKey: baseKey,
    partKeys: partKeys,
    tidy: tidy,
    tidyId: tidyId,
    MAX_ID_LENGTH: MAX_ID_LENGTH,
  };
});
