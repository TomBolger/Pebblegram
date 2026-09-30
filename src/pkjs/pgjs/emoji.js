// Converts text for the watch: emoji the watch can draw pass through, every
// other emoji becomes a readable :shortcode: (for example :slightly_smiling_face:).
//
// Which emoji a watch can draw depends on its firmware. PebbleOS 4.29 added
// about 1,200 emoji; older firmware only has around 150. Coverage data comes
// from tools/pebbleos-emoji-coverage.json via tools/build-emoji-data.mjs.

var data = require('./emoji-data');

var ZWJ = 0x200d;
var KEYCAP = 0x20e3;
var TAG_END = 0xe007f;

var tiers = {};
var activeTier = null;

function buildLookup(ranges) {
  var lookup = {};
  for (var i = 0; i < ranges.length; i += 1) {
    for (var cp = ranges[i][0]; cp <= ranges[i][1]; cp += 1) {
      lookup[cp] = true;
    }
  }
  return lookup;
}

function inRanges(ranges, cp) {
  var low = 0;
  var high = ranges.length - 1;
  while (low <= high) {
    var mid = (low + high) >> 1;
    if (cp < ranges[mid][0]) {
      high = mid - 1;
    } else if (cp > ranges[mid][1]) {
      low = mid + 1;
    } else {
      return true;
    }
  }
  return false;
}

function tier(name) {
  if (!tiers[name]) {
    var source = data.tiers[name];
    tiers[name] = {
      emoji: buildLookup(source.emoji),
      gothic: buildLookup(source.gothic),
      routed: source.routed
    };
  }
  return tiers[name];
}

function versionAtLeast(version, minimum) {
  for (var i = 0; i < 3; i += 1) {
    var a = version[i] || 0;
    var b = minimum[i] || 0;
    if (a !== b) {
      return a > b;
    }
  }
  return true;
}

// firmware: Pebble.getActiveWatchInfo().firmware ({major, minor, patch}).
function setFirmware(firmware) {
  var version = firmware ? [firmware.major, firmware.minor, firmware.patch] : null;
  activeTier = version && versionAtLeast(version, data.tiers['new'].minFirmware) ? 'new' : 'old';
  return activeTier;
}

function currentTier() {
  return tier(activeTier || 'old');
}

function codepoints(text) {
  var out = [];
  for (var i = 0; i < text.length; i += 1) {
    var code = text.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      var low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        out.push(((code - 0xd800) << 10) + (low - 0xdc00) + 0x10000);
        i += 1;
        continue;
      }
    }
    out.push(code);
  }
  return out;
}

function fromCodepoint(cp) {
  if (cp < 0x10000) {
    return String.fromCharCode(cp);
  }
  cp -= 0x10000;
  return String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
}

function isInvisible(cp) {
  return cp === 0xfe0e || cp === 0xfe0f || (cp >= 0x1f3fb && cp <= 0x1f3ff);
}

function isRegionalIndicator(cp) {
  return cp >= 0x1f1e6 && cp <= 0x1f1ff;
}

function isTag(cp) {
  return cp >= 0xe0020 && cp <= TAG_END;
}

// Would PebbleOS send this codepoint to its emoji font?
function isRouted(t, cp) {
  return inRanges(t.routed, cp);
}

// Emoji-range codepoints outside the name list, e.g. emoji newer than our data.
function looksLikeEmoji(cp) {
  return (cp >= 0x1f000 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf);
}

function canDraw(t, cp) {
  if (cp < 0x80) {
    return true;
  }
  return isRouted(t, cp) ? !!t.emoji[cp] : !!t.gothic[cp];
}

function shortcode(name) {
  return ':' + name + ':';
}

// Longest known emoji sequence starting at index, or null.
function matchSequence(cps, index) {
  var limit = Math.min(data.maxSequence, cps.length - index);
  for (var length = limit; length >= 1; length -= 1) {
    var parts = [];
    for (var j = 0; j < length; j += 1) {
      parts.push(cps[index + j].toString(16));
    }
    var name = data.names[parts.join('-')];
    if (name) {
      return {length: length, name: name};
    }
  }
  return null;
}

function flagName(first, second) {
  var a = String.fromCharCode(97 + first - 0x1f1e6);
  var b = String.fromCharCode(97 + second - 0x1f1e6);
  return 'flag_' + a + b;
}

function convert(text) {
  var t = currentTier();
  var cps = codepoints(String(text === undefined || text === null ? '' : text)).filter(function(cp) {
    return !isInvisible(cp);
  });
  var out = [];
  var lastWasCode = false;

  function emit(piece, isCode) {
    if (isCode && out.length) {
      var previous = out[out.length - 1];
      // Keep neighbouring shortcodes apart so they stay readable and wrap.
      if (lastWasCode || /[A-Za-z0-9]$/.test(previous)) {
        out.push(' ');
      }
    } else if (!isCode && lastWasCode && /^[A-Za-z0-9]/.test(piece)) {
      out.push(' ');
    }
    out.push(piece);
    lastWasCode = !!isCode;
  }

  for (var i = 0; i < cps.length; i += 1) {
    var cp = cps[i];

    if (isRegionalIndicator(cp) && i + 1 < cps.length && isRegionalIndicator(cps[i + 1])) {
      emit(shortcode(flagName(cp, cps[i + 1])), true);
      i += 1;
      continue;
    }

    if (i + 1 < cps.length && cps[i + 1] === KEYCAP && cp < 0x80) {
      emit(String.fromCharCode(cp), false);
      i += 1;
      continue;
    }

    var match = cp >= 0x80 ? matchSequence(cps, i) : null;
    if (match && match.length > 1) {
      // Joined emoji (people with jobs, families, heart on fire, subdivision
      // flags) would draw as separate pieces, so name them instead.
      emit(shortcode(match.name), true);
      i += match.length - 1;
      continue;
    }

    if (cp === ZWJ || isTag(cp)) {
      continue;
    }

    if (canDraw(t, cp)) {
      emit(fromCodepoint(cp), false);
    } else if (match) {
      emit(shortcode(match.name), true);
    } else if (looksLikeEmoji(cp) || isRouted(t, cp)) {
      emit(shortcode('emoji_' + cp.toString(16)), true);
    } else {
      // Other scripts (Chinese, Cyrillic, ...) are left to the watch's language pack.
      emit(fromCodepoint(cp), false);
    }
  }
  return out.join('');
}

// Emoji a watch on this firmware can draw, for building reply menus.
function drawable(emoji) {
  var t = currentTier();
  var cps = codepoints(emoji).filter(function(cp) {
    return !isInvisible(cp);
  });
  return cps.length === 1 && canDraw(t, cps[0]);
}

function nameOf(emoji) {
  var cps = codepoints(emoji).filter(function(cp) {
    return !isInvisible(cp);
  });
  var match = cps.length ? matchSequence(cps, 0) : null;
  return match && match.length === cps.length ? match.name : '';
}

module.exports = {
  convert: convert,
  drawable: drawable,
  nameOf: nameOf,
  setFirmware: setFirmware,
  tierName: function() {
    return activeTier || 'old';
  }
};
