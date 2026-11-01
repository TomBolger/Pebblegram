var telegram = require('./telegram');
var codecs = require('./codecs.bundle');
var imageCache = {};
var imageCacheOrder = [];
var imageInflight = {};
var MAX_IMAGE_CACHE_ITEMS = 64;
var MAX_PERSISTENT_IMAGE_CACHE_ITEMS = 32;
var PERSISTENT_IMAGE_CACHE_ORDER_KEY = 'pgjs.imageCacheOrder';
var IMAGE_CACHE_VERSION = 'v28';
var MEDIA_PIPELINE_TIMEOUT_MS = 22000;
var DEBUG_LOGS = false;
var foregroundImageGeneration = 0;

function debugLog(message) {
  if (DEBUG_LOGS) {
    console.log(message);
  }
}

function withTimeout(promise, label, timeoutMs) {
  var timer = null;
  var timeoutPromise = new Promise(function(resolve, reject) {
    timer = setTimeout(function() {
      reject(new Error(label));
    }, timeoutMs);
  });
  return Promise.race([promise, timeoutPromise]).then(function(value) {
    clearTimeout(timer);
    return value;
  }, function(err) {
    clearTimeout(timer);
    throw err;
  });
}

function toUint8Array(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value.buffer) {
    return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength || value.length || 0);
  }
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return null;
}

function isPng(bytes) {
  return bytes && bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

function isJpeg(bytes) {
  return bytes && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function byteKind(bytes) {
  if (!bytes || !bytes.length) {
    return 'empty';
  }
  if (isPng(bytes)) {
    return 'png';
  }
  if (isJpeg(bytes)) {
    return 'jpeg';
  }
  return 'unknown';
}

function byteSummary(bytes) {
  var summary = byteKind(bytes) + ' ' + (bytes && bytes.length ? bytes.length : 0) + 'b';
  var limit = bytes && bytes.length ? Math.min(bytes.length, 8) : 0;
  var sig = [];
  for (var i = 0; i < limit; i += 1) {
    sig.push((bytes[i] < 16 ? '0' : '') + bytes[i].toString(16));
  }
  return sig.length ? summary + ' sig ' + sig.join('') : summary;
}

function readUint32BE(bytes, offset) {
  return ((bytes[offset] << 24) >>> 0) +
         (bytes[offset + 1] << 16) +
         (bytes[offset + 2] << 8) +
         bytes[offset + 3];
}

function pngDimensions(bytes) {
  if (!bytes || bytes.length < 24 || !isPng(bytes)) {
    return null;
  }
  return {
    width: readUint32BE(bytes, 16),
    height: readUint32BE(bytes, 20)
  };
}

function bitmapHeapEstimate(width, height) {
  return (((width + 3) & ~3) * height);
}

function encodedDecodeCost(encoded) {
  var dimensions = pngDimensions(encoded);
  if (!dimensions) {
    return encoded ? encoded.length : 0;
  }
  return encoded.length + bitmapHeapEstimate(dimensions.width, dimensions.height);
}

function encodedFits(encoded, maxBytes, maxCost) {
  if (maxBytes && encoded.length > maxBytes) {
    return false;
  }
  if (maxCost && encodedDecodeCost(encoded) > maxCost) {
    return false;
  }
  return true;
}

function rgbaBuffer(bytes) {
  var decoded;
  if (isJpeg(bytes)) {
    try {
      decoded = codecs.JPEG.decode(bytes, {useTArray: true});
      return {
        width: decoded.width,
        height: decoded.height,
        data: new Uint8Array(decoded.data.buffer, decoded.data.byteOffset || 0, decoded.data.byteLength || decoded.data.length || 0)
      };
    } catch (err) {
      throw new Error('phone jpeg decode failed: ' + (err && err.message ? err.message : err) + '; ' + byteSummary(bytes));
    }
  }
  if (isPng(bytes)) {
    try {
      decoded = codecs.UPNG.decode(bytes.buffer.slice(bytes.byteOffset || 0, (bytes.byteOffset || 0) + bytes.byteLength));
      return {
        width: decoded.width,
        height: decoded.height,
        data: new Uint8Array(codecs.UPNG.toRGBA8(decoded)[0])
      };
    } catch (err) {
      throw new Error('phone png decode failed: ' + (err && err.message ? err.message : err) + '; ' + byteSummary(bytes));
    }
  }
  throw new Error('phone image format unsupported: ' + byteSummary(bytes));
}

function liftChannel(value) {
  if (value <= 0) {
    return 4;
  }
  return Math.min(255, Math.round((Math.pow(value / 255, 0.82) * 255) + 4));
}

function darkScreenshotChannel(value) {
  if (value < 96) {
    return Math.max(0, Math.round(value * 0.55));
  }
  if (value < 160) {
    return Math.max(0, Math.round(96 + ((value - 96) * 0.86)));
  }
  return value;
}

function lightScreenshotChannel(value) {
  if (value >= 248) {
    return 255;
  }
  if (value >= 210) {
    return Math.max(0, Math.round(186 + ((value - 210) * 0.74)));
  }
  if (value >= 128) {
    return Math.max(0, Math.round(value * 0.9));
  }
  return Math.max(0, Math.round(value * 0.82));
}

function ditherOffset(x, y) {
  var matrix = [
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5
  ];
  return matrix[((y & 3) * 4) + (x & 3)] - 7.5;
}

function toneChannel(value, x, y, mode) {
  if (mode === 'dark') {
    return darkScreenshotChannel(value);
  }
  if (mode === 'light') {
    return lightScreenshotChannel(value);
  }
  var lifted = liftChannel(value);
  return Math.max(0, Math.min(255, Math.round(lifted + ditherOffset(x, y) * 1.4)));
}

function channelToneMode(value) {
  if (value === 'dark' || value === 'light') {
    return value;
  }
  return value ? 'lift' : '';
}

function resizeCover(source, width, height, maskCircle, liftColors) {
  var output = new Uint8Array(width * height * 4);
  var scale = Math.max(width / source.width, height / source.height);
  var cropW = width / scale;
  var cropH = height / scale;
  var startX = (source.width - cropW) / 2;
  var startY = (source.height - cropH) / 2;
  var cx = (width - 1) / 2;
  var cy = (height - 1) / 2;
  var radius = Math.min(width, height) / 2;
  var x;
  var y;
  var srcX;
  var srcY;
  var srcIndex;
  var dstIndex;
  var dx;
  var dy;
  var toneMode = channelToneMode(liftColors);

  for (y = 0; y < height; y += 1) {
    srcY = Math.min(source.height - 1, Math.max(0, Math.floor(startY + y / scale)));
    for (x = 0; x < width; x += 1) {
      srcX = Math.min(source.width - 1, Math.max(0, Math.floor(startX + x / scale)));
      srcIndex = (srcY * source.width + srcX) * 4;
      dstIndex = (y * width + x) * 4;
      output[dstIndex] = toneMode ? toneChannel(source.data[srcIndex], x, y, toneMode) : source.data[srcIndex];
      output[dstIndex + 1] = toneMode ? toneChannel(source.data[srcIndex + 1], x, y, toneMode) : source.data[srcIndex + 1];
      output[dstIndex + 2] = toneMode ? toneChannel(source.data[srcIndex + 2], x, y, toneMode) : source.data[srcIndex + 2];
      if (maskCircle) {
        dx = x - cx;
        dy = y - cy;
        if (dx * dx + dy * dy <= radius * radius) {
          output[dstIndex + 3] = 255;
        } else {
          output[dstIndex] = 170;
          output[dstIndex + 1] = 170;
          output[dstIndex + 2] = 170;
          output[dstIndex + 3] = 255;
        }
      } else {
        output[dstIndex + 3] = 255;
      }
    }
  }
  return output;
}

function resizeContain(source, width, height, liftColors) {
  var scale = Math.min(width / source.width, height / source.height);
  var outputWidth = Math.max(1, Math.floor(source.width * scale));
  var outputHeight = Math.max(1, Math.floor(source.height * scale));
  var output = new Uint8Array(outputWidth * outputHeight * 4);
  var x;
  var y;
  var srcX;
  var srcY;
  var srcIndex;
  var dstIndex;
  var toneMode = channelToneMode(liftColors);

  for (y = 0; y < outputHeight; y += 1) {
    srcY = Math.min(source.height - 1, Math.max(0, Math.floor(y / scale)));
    for (x = 0; x < outputWidth; x += 1) {
      srcX = Math.min(source.width - 1, Math.max(0, Math.floor(x / scale)));
      srcIndex = (srcY * source.width + srcX) * 4;
      dstIndex = (y * outputWidth + x) * 4;
      output[dstIndex] = toneMode ? toneChannel(source.data[srcIndex], x, y, toneMode) : source.data[srcIndex];
      output[dstIndex + 1] = toneMode ? toneChannel(source.data[srcIndex + 1], x, y, toneMode) : source.data[srcIndex + 1];
      output[dstIndex + 2] = toneMode ? toneChannel(source.data[srcIndex + 2], x, y, toneMode) : source.data[srcIndex + 2];
      output[dstIndex + 3] = 255;
    }
  }
  return {
    width: outputWidth,
    height: outputHeight,
    data: output
  };
}

function arrayBufferFromBytes(bytes) {
  return bytes.buffer.slice(bytes.byteOffset || 0, (bytes.byteOffset || 0) + bytes.byteLength);
}

function encodePng(source, width, height, colors, maskCircle, liftColors, fitMode) {
  var resized;
  if (fitMode === 'contain') {
    resized = resizeContain(source, width, height, liftColors);
    return new Uint8Array(codecs.UPNG.encode([arrayBufferFromBytes(resized.data)], resized.width, resized.height, colors));
  }
  resized = resizeCover(source, width, height, maskCircle, liftColors);
  return new Uint8Array(codecs.UPNG.encode([arrayBufferFromBytes(resized)], width, height, colors));
}

function writeUint16LE(bytes, offset, value) {
  bytes[offset] = value & 255;
  bytes[offset + 1] = (value >> 8) & 255;
}

function imageStats(source) {
  var pixels = source.width * source.height;
  var step = Math.max(1, Math.floor(pixels / 1200));
  var count = 0;
  var white = 0;
  var transparent = 0;
  var dark = 0;
  var i;
  var r;
  var g;
  var b;
  for (i = 0; i < pixels; i += step) {
    r = source.data[i * 4];
    g = source.data[(i * 4) + 1];
    b = source.data[(i * 4) + 2];
    if (source.data[(i * 4) + 3] < 24) {
      transparent += 1;
    }
    if (r > 238 && g > 238 && b > 238) {
      white += 1;
    }
    if (r < 210 || g < 210 || b < 210) {
      dark += 1;
    }
    count += 1;
  }
  return {
    mostlyWhite: count > 0 && white / count > 0.92,
    mostlyTransparent: count > 0 && transparent / count > 0.92,
    hasNonWhiteDetail: count > 0 && dark / count > 0.08
  };
}

function encodedLooksBlank(encoded, sourceStats) {
  try {
    var stats = imageStats(rgbaBuffer(encoded));
    return stats.mostlyTransparent || (!sourceStats.mostlyWhite && stats.mostlyWhite);
  } catch (e) {
    return true;
  }
}

function logDuration(label, startedAt) {
  if (DEBUG_LOGS) {
    console.log(label + ' took ' + (Date.now() - startedAt) + 'ms');
  }
}

function nextTurn() {
  return new Promise(function(resolve) {
    setTimeout(resolve, 0);
  });
}

function throwIfCancelled(options) {
  if (options && options.isCancelled && options.isCancelled()) {
    throw new Error('image request superseded');
  }
}

function imageStatus(options, text) {
  if (options && typeof options.status === 'function') {
    options.status(text);
  }
}

function compactPng(source, width, height, colors, maxBytes, maskCircle, liftColors, scaleSteps, fitMode, maxCost) {
  var colorSteps = [colors, 32, 16, 8, 4, 2];
  scaleSteps = scaleSteps || [1, 0.9, 0.8, 0.7, 0.6];
  var best = null;
  var bestDetail = '';
  var step;
  var colorIndex;
  var nextWidth;
  var nextHeight;
  var nextColors;
  var encoded;

  for (step = 0; step < scaleSteps.length; step += 1) {
    nextWidth = Math.max(32, Math.floor(width * scaleSteps[step]));
    nextHeight = Math.max(32, Math.floor(height * scaleSteps[step]));
    for (colorIndex = 0; colorIndex < colorSteps.length; colorIndex += 1) {
      nextColors = colorSteps[colorIndex];
      if (nextColors > colors) {
        continue;
      }
      encoded = encodePng(source, nextWidth, nextHeight, nextColors, maskCircle, liftColors, fitMode);
      if (!best || encoded.length < best.length) {
        best = encoded;
        bestDetail = nextWidth + 'x' + nextHeight + '/' + nextColors + 'c';
      }
      if (encodedFits(encoded, maxBytes, maxCost)) {
        return encoded;
      }
    }
  }
  if (best && encodedFits(best, maxBytes, maxCost)) {
    return best;
  }
  throw new Error('phone png encode over budget: best ' + (best ? best.length : 0) +
                  'b cost ' + (best ? encodedDecodeCost(best) : 0) + ' at ' + bestDetail +
                  ' > ' + maxBytes + 'b/' + (maxCost || 0) + 'c from ' +
                  source.width + 'x' + source.height);
}

function safeCompactPng(source, width, height, colors, maxBytes, maskCircle) {
  var sourceStats = imageStats(source);
  var encoded = compactPng(source, width, height, colors, maxBytes, maskCircle, false, [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.42]);
  var scaleSteps = [0.85, 0.75, 0.65, 0.55];
  var colorSteps = [Math.max(colors, 128), 128, 64, 32, 16];
  var step;
  var colorIndex;
  var fallback;
  var nextWidth;
  var nextHeight;

  if (!sourceStats.hasNonWhiteDetail || !encodedLooksBlank(encoded, sourceStats)) {
    return encoded;
  }

  for (step = 0; step < scaleSteps.length; step += 1) {
    nextWidth = Math.max(32, Math.floor(width * scaleSteps[step]));
    nextHeight = Math.max(32, Math.floor(height * scaleSteps[step]));
    for (colorIndex = 0; colorIndex < colorSteps.length; colorIndex += 1) {
      fallback = encodePng(source, nextWidth, nextHeight, colorSteps[colorIndex], maskCircle, false);
      if ((!maxBytes || fallback.length <= maxBytes) && !encodedLooksBlank(fallback, sourceStats)) {
        if (DEBUG_LOGS) {
          debugLog('image blank fallback used at ' + nextWidth + 'x' + nextHeight);
        }
        return fallback;
      }
    }
  }

  throw new Error('Photo encoded as blank.');
}

function cacheKey(chatId, messageId, width, height, colors, maxBytes, maxPixels, maxCost, forceTall) {
  return [IMAGE_CACHE_VERSION, chatId, messageId, width, height, colors, maxBytes, maxPixels || 0,
          maxCost || 0, forceTall ? 1 : 0].join(':');
}

function removeArrayValue(items, value) {
  var write = 0;
  for (var read = 0; read < items.length; read += 1) {
    if (items[read] !== value) {
      items[write] = items[read];
      write += 1;
    }
  }
  items.length = write;
  return items;
}

function noteImageCacheUse(key) {
  removeArrayValue(imageCacheOrder, key);
  imageCacheOrder.push(key);
}

function cacheSet(key, bytes) {
  noteImageCacheUse(key);
  imageCache[key] = bytes;
  while (imageCacheOrder.length > MAX_IMAGE_CACHE_ITEMS) {
    delete imageCache[imageCacheOrder.shift()];
  }
  persistentCacheSet(key, bytes);
}

function persistentCacheGet(key) {
  var raw;
  var bytes;
  try {
    raw = localStorage.getItem('pgjs.imageCache.' + key);
    if (!raw) {
      return null;
    }
    bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i += 1) {
      bytes[i] = raw.charCodeAt(i) & 255;
    }
    cacheSetMemoryOnly(key, bytes);
    persistentCacheNoteUse(key);
    return bytes;
  } catch (e) {
    return null;
  }
}

function cacheSetMemoryOnly(key, bytes) {
  noteImageCacheUse(key);
  imageCache[key] = bytes;
  while (imageCacheOrder.length > MAX_IMAGE_CACHE_ITEMS) {
    delete imageCache[imageCacheOrder.shift()];
  }
}

function persistentCacheNoteUse(key) {
  var order;
  try {
    order = JSON.parse(localStorage.getItem(PERSISTENT_IMAGE_CACHE_ORDER_KEY) || '[]');
    removeArrayValue(order, key);
    order.push(key);
    localStorage.setItem(PERSISTENT_IMAGE_CACHE_ORDER_KEY, JSON.stringify(order));
  } catch (e) {}
}

function bytesToStorageString(bytes) {
  var chunks = [];
  var chunkSize = 4096;
  for (var i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, bytes.length))));
  }
  return chunks.join('');
}

function persistentCacheSet(key, bytes) {
  var order;
  var encoded;
  try {
    order = JSON.parse(localStorage.getItem(PERSISTENT_IMAGE_CACHE_ORDER_KEY) || '[]');
    removeArrayValue(order, key);
    while (order.length >= MAX_PERSISTENT_IMAGE_CACHE_ITEMS) {
      localStorage.removeItem('pgjs.imageCache.' + order.shift());
    }
    encoded = bytesToStorageString(bytes);
    try {
      localStorage.setItem('pgjs.imageCache.' + key, encoded);
    } catch (writeErr) {
      if (order.length > 0) {
        localStorage.removeItem('pgjs.imageCache.' + order.shift());
        localStorage.setItem('pgjs.imageCache.' + key, encoded);
      } else {
        throw writeErr;
      }
    }
    order.push(key);
    localStorage.setItem(PERSISTENT_IMAGE_CACHE_ORDER_KEY, JSON.stringify(order));
  } catch (e) {
    debugLog('Persistent image cache skipped: ' + (e && e.message ? e.message : e));
  }
}

function cachedBytes(key, label, downloader, width, height, colors, maxBytes, maskCircle, options, maxPixels, maxCost) {
  var pipeline;
  var wrapped;
  options = options || {};
  if (imageCache[key]) {
    noteImageCacheUse(key);
    if (DEBUG_LOGS) {
      debugLog('image cache hit ' + label);
    }
    imageStatus(options, 'Cache hit');
    return Promise.resolve(imageCache[key]);
  }
  var cached = persistentCacheGet(key);
  if (cached) {
    if (DEBUG_LOGS) {
      debugLog('persistent image cache hit ' + label);
    }
    imageStatus(options, 'Storage cache hit');
    return Promise.resolve(cached);
  }
  if (imageInflight[key] && !options.noInflightReuse) {
    if (DEBUG_LOGS) {
      debugLog('image inflight hit ' + label);
    }
    return imageInflight[key];
  }
  if (imageInflight[key]) {
    if (DEBUG_LOGS) {
      debugLog('image inflight bypass ' + label);
    }
  }
  var downloadStartedAt = DEBUG_LOGS ? Date.now() : 0;
  pipeline = withTimeout(Promise.resolve().then(downloader), 'image pipeline timed out', MEDIA_PIPELINE_TIMEOUT_MS).then(function(raw) {
    if (DEBUG_LOGS) {
      logDuration('image download ' + label, downloadStartedAt);
    }
    var encodeStartedAt = DEBUG_LOGS ? Date.now() : 0;
    var bytes = toUint8Array(raw);
    var source;
    if (!bytes || !bytes.length) {
      throw new Error('empty image');
    }
    throwIfCancelled(options);
    imageStatus(options, 'Decoding');
    source = rgbaBuffer(bytes);
    throwIfCancelled(options);
    imageStatus(options, 'Encoding');
    return Promise.resolve(safeCompactPng(source, width, height, colors, maxBytes, true)).then(function(encoded) {
      throwIfCancelled(options);
      if (DEBUG_LOGS) {
        logDuration('image encode ' + label, encodeStartedAt);
      }
      cacheSet(key, encoded);
      return encoded;
    });
  });
  wrapped = pipeline.then(function(bytes) {
    if (imageInflight[key] === wrapped) {
      delete imageInflight[key];
    }
    return bytes;
  }, function(err) {
    if (imageInflight[key] === wrapped) {
      delete imageInflight[key];
    }
    throw err;
  });
  imageInflight[key] = wrapped;
  return wrapped;
}

// ---------------------------------------------------------------------------
// Chat photos
//
// The watch asks for a photo at an exact size with a byte budget (its free
// heap). Photos are sent as ready-to-draw Pebble bitmaps, so the watch never
// decodes anything: the bytes it receives are the bytes it keeps. The best
// colour depth that fits the budget is chosen per photo:
//   8-bit (all 64 Pebble colours, dithered)   photos
//   4-bit (16 chosen colours)                  graphics, colourful screenshots
//   2-bit (4 chosen colours)                   text screenshots
//   1-bit (dithered black and white)           Pebble 2 / black-and-white
// Only if even the smallest depth does not fit is the photo shrunk.

var PHOTO_CACHE_VERSION = 'p1';
var PHOTO_DEBUG = false;
var PHOTO_SCALES = [1, 0.9, 0.8, 0.7, 0.6, 0.5, 0.42, 0.35, 0.28];
var photoKinds = null;
var PHOTO_KIND_KEY = 'pgjs.photoKinds';
var MAX_PHOTO_KINDS = 160;
var workCache = [];
var MAX_WORK_CACHE = 3;

function pbiRowBytes(width, bpp) {
  return bpp === 1 ? Math.ceil(width / 32) * 4 : Math.ceil(width * bpp / 8);
}

function pbiSize(width, height, bpp) {
  return 12 + pbiRowBytes(width, bpp) * height + (bpp === 2 ? 4 : (bpp === 4 ? 16 : 0));
}

function depthsFor(kind, blackAndWhite) {
  if (blackAndWhite) {
    return [1];
  }
  if (kind === 'flat') {
    return [2];
  }
  if (kind === 'graphic') {
    return [4, 2];
  }
  return [8, 4, 2];
}

// Picks the output size and depth: full resolution first, colour second.
function choosePhotoPlan(width, height, budget, kind, blackAndWhite) {
  var depths = depthsFor(kind, blackAndWhite);
  for (var s = 0; s < PHOTO_SCALES.length; s += 1) {
    var w = Math.max(16, Math.round(width * PHOTO_SCALES[s]));
    var h = Math.max(16, Math.round(height * PHOTO_SCALES[s]));
    for (var d = 0; d < depths.length; d += 1) {
      if (pbiSize(w, h, depths[d]) <= budget) {
        return {width: w, height: h, bpp: depths[d]};
      }
    }
  }
  return null;
}

function loadPhotoKinds() {
  if (!photoKinds) {
    try {
      photoKinds = JSON.parse(localStorage.getItem(PHOTO_KIND_KEY) || '{}') || {};
    } catch (e) {
      photoKinds = {};
    }
  }
  return photoKinds;
}

function rememberPhotoKind(key, kind) {
  var kinds = loadPhotoKinds();
  if (kinds[key] === kind) {
    return;
  }
  kinds[key] = kind;
  var keys = Object.keys(kinds);
  while (keys.length > MAX_PHOTO_KINDS) {
    delete kinds[keys.shift()];
  }
  try {
    localStorage.setItem(PHOTO_KIND_KEY, JSON.stringify(kinds));
  } catch (e) {}
}

// Area-average downscale (every source pixel counts, so thin text strokes
// survive), or bilinear when the source is smaller than the target.
// Transparent pixels are composited onto white. Returns 8-bit RGB.
function resizeForWatch(source, width, height) {
  var out = new Float32Array(width * height * 3);
  var sw = source.width;
  var sh = source.height;
  var data = source.data;
  var x;
  var y;
  var i;
  if (sw >= width && sh >= height) {
    var counts = new Uint32Array(width * height);
    var xMap = new Uint16Array(sw);
    for (x = 0; x < sw; x += 1) {
      xMap[x] = Math.min(width - 1, Math.floor(x * width / sw));
    }
    for (y = 0; y < sh; y += 1) {
      var rowOut = Math.min(height - 1, Math.floor(y * height / sh)) * width;
      var src = y * sw * 4;
      for (x = 0; x < sw; x += 1) {
        var a = data[src + 3] / 255;
        var o = rowOut + xMap[x];
        var o3 = o * 3;
        out[o3] += data[src] * a + 255 * (1 - a);
        out[o3 + 1] += data[src + 1] * a + 255 * (1 - a);
        out[o3 + 2] += data[src + 2] * a + 255 * (1 - a);
        counts[o] += 1;
        src += 4;
      }
    }
    for (i = 0; i < width * height; i += 1) {
      var c = counts[i] || 1;
      out[i * 3] /= c;
      out[i * 3 + 1] /= c;
      out[i * 3 + 2] /= c;
    }
    return new Uint8ClampedArray(out);
  }
  for (y = 0; y < height; y += 1) {
    var fy = Math.max(0, Math.min(sh - 1, (y + 0.5) * sh / height - 0.5));
    var y0 = Math.floor(fy);
    var y1 = Math.min(sh - 1, y0 + 1);
    var ty = fy - y0;
    for (x = 0; x < width; x += 1) {
      var fx = Math.max(0, Math.min(sw - 1, (x + 0.5) * sw / width - 0.5));
      var x0 = Math.floor(fx);
      var x1 = Math.min(sw - 1, x0 + 1);
      var tx = fx - x0;
      for (var ch = 0; ch < 3; ch += 1) {
        var p00 = sampleOnWhite(data, (y0 * sw + x0) * 4, ch);
        var p10 = sampleOnWhite(data, (y0 * sw + x1) * 4, ch);
        var p01 = sampleOnWhite(data, (y1 * sw + x0) * 4, ch);
        var p11 = sampleOnWhite(data, (y1 * sw + x1) * 4, ch);
        out[(y * width + x) * 3 + ch] = (p00 * (1 - tx) + p10 * tx) * (1 - ty) + (p01 * (1 - tx) + p11 * tx) * ty;
      }
    }
  }
  return new Uint8ClampedArray(out);
}

function sampleOnWhite(data, index, channel) {
  var a = data[index + 3] / 255;
  return data[index + channel] * a + 255 * (1 - a);
}

function level4(value) {
  return Math.max(0, Math.min(3, Math.round(value / 85)));
}

// Histogram over the 64 Pebble colours (index = r*16 + g*4 + b, 0..3 each).
function pebbleHistogram(rgb, pixels) {
  var hist = new Uint32Array(64);
  for (var i = 0; i < pixels; i += 1) {
    hist[level4(rgb[i * 3]) * 16 + level4(rgb[i * 3 + 1]) * 4 + level4(rgb[i * 3 + 2])] += 1;
  }
  return hist;
}

function topShare(hist, count, pixels) {
  var sorted = Array.prototype.slice.call(hist).sort(function(a, b) { return b - a; });
  var total = 0;
  for (var i = 0; i < count; i += 1) {
    total += sorted[i];
  }
  return total / Math.max(1, pixels);
}

// 'flat': a few flat colours, e.g. a chat or text screenshot.
// 'graphic': limited palette, e.g. a colourful app screenshot.
// 'photo': everything else.
function photoKind(rgb, pixels) {
  // Measured on a fine (4096-colour) histogram: screenshots are mostly a few
  // exact colours, photos spread over many.
  var hist = new Uint32Array(4096);
  for (var i = 0; i < pixels; i += 1) {
    hist[((rgb[i * 3] >> 4) << 8) | ((rgb[i * 3 + 1] >> 4) << 4) | (rgb[i * 3 + 2] >> 4)] += 1;
  }
  var top4 = topShare(hist, 4, pixels);
  var top16 = topShare(hist, 16, pixels);
  if (PHOTO_DEBUG) {
    console.log('photo kind top4=' + top4.toFixed(3) + ' top16=' + top16.toFixed(3));
  }
  if (top4 >= 0.72) {
    return 'flat';
  }
  if (top16 >= 0.72) {
    return 'graphic';
  }
  return 'photo';
}

function paletteRgb(index) {
  return [((index >> 4) & 3) * 85, ((index >> 2) & 3) * 85, (index & 3) * 85];
}

function colorDistance(a, b) {
  var dr = a[0] - b[0];
  var dg = a[1] - b[1];
  var db = a[2] - b[2];
  return dr * dr * 3 + dg * dg * 4 + db * db * 2;
}

// Chooses `count` Pebble colours for a palettized bitmap: the most common
// colour first, then colours that are both common and unlike those chosen,
// refined with a few k-means passes.
function choosePalette(hist, count) {
  var colors = [];
  var weights = [];
  var i;
  for (i = 0; i < 64; i += 1) {
    if (hist[i]) {
      colors.push(paletteRgb(i));
      weights.push(hist[i]);
    }
  }
  var chosen = [];
  if (!colors.length) {
    return [[255, 255, 255]];
  }
  var first = 0;
  for (i = 1; i < colors.length; i += 1) {
    if (weights[i] > weights[first]) {
      first = i;
    }
  }
  chosen.push(colors[first]);
  while (chosen.length < count && chosen.length < colors.length) {
    var best = -1;
    var bestScore = -1;
    for (i = 0; i < colors.length; i += 1) {
      var nearest = Infinity;
      for (var j = 0; j < chosen.length; j += 1) {
        nearest = Math.min(nearest, colorDistance(colors[i], chosen[j]));
      }
      var score = weights[i] * nearest;
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0 || bestScore <= 0) {
      break;
    }
    chosen.push(colors[best]);
  }
  for (var pass = 0; pass < 4; pass += 1) {
    var sums = chosen.map(function() { return [0, 0, 0, 0]; });
    for (i = 0; i < colors.length; i += 1) {
      var k = nearestIndex(colors[i], chosen);
      sums[k][0] += colors[i][0] * weights[i];
      sums[k][1] += colors[i][1] * weights[i];
      sums[k][2] += colors[i][2] * weights[i];
      sums[k][3] += weights[i];
    }
    for (k = 0; k < chosen.length; k += 1) {
      if (sums[k][3]) {
        chosen[k] = [level4(sums[k][0] / sums[k][3]) * 85,
                     level4(sums[k][1] / sums[k][3]) * 85,
                     level4(sums[k][2] / sums[k][3]) * 85];
      }
    }
  }
  var unique = [];
  var seen = {};
  chosen.forEach(function(color) {
    var key = color.join(',');
    if (!seen[key]) {
      seen[key] = true;
      unique.push(color);
    }
  });
  return unique;
}

function nearestIndex(color, palette) {
  var best = 0;
  var bestDistance = Infinity;
  for (var i = 0; i < palette.length; i += 1) {
    var d = colorDistance(color, palette[i]);
    if (d < bestDistance) {
      bestDistance = d;
      best = i;
    }
  }
  return best;
}

// Maps every pixel to an index in `palette`, optionally with Floyd-Steinberg
// error diffusion (serpentine) so photos keep their gradients.
function mapToPalette(rgb, width, height, palette, dither) {
  var work = dither ? Float32Array.from(rgb) : rgb;
  var out = new Uint8Array(width * height);
  var cache = new Int8Array(32768).fill(-1);
  var direct = palette.length === 64;
  var pixel = [0, 0, 0];
  for (var y = 0; y < height; y += 1) {
    var reverse = dither && (y & 1);
    for (var step = 0; step < width; step += 1) {
      var x = reverse ? width - 1 - step : step;
      var i = y * width + x;
      pixel[0] = Math.max(0, Math.min(255, work[i * 3]));
      pixel[1] = Math.max(0, Math.min(255, work[i * 3 + 1]));
      pixel[2] = Math.max(0, Math.min(255, work[i * 3 + 2]));
      var index;
      if (direct) {
        index = level4(pixel[0]) * 16 + level4(pixel[1]) * 4 + level4(pixel[2]);
      } else {
        var key = ((pixel[0] >> 3) << 10) | ((pixel[1] >> 3) << 5) | (pixel[2] >> 3);
        index = cache[key];
        if (index < 0) {
          index = nearestIndex(pixel, palette);
          cache[key] = index;
        }
      }
      out[i] = index;
      if (!dither) {
        continue;
      }
      var chosen = palette[index];
      var dir = reverse ? -1 : 1;
      for (var ch = 0; ch < 3; ch += 1) {
        var err = pixel[ch] - chosen[ch];
        if (!err) {
          continue;
        }
        if (x + dir >= 0 && x + dir < width) {
          work[(i + dir) * 3 + ch] += err * 7 / 16;
        }
        if (y + 1 < height) {
          if (x - dir >= 0 && x - dir < width) {
            work[(i + width - dir) * 3 + ch] += err * 3 / 16;
          }
          work[(i + width) * 3 + ch] += err * 5 / 16;
          if (x + dir >= 0 && x + dir < width) {
            work[(i + width + dir) * 3 + ch] += err / 16;
          }
        }
      }
    }
  }
  return out;
}

function argb8(color) {
  return 0xc0 | (level4(color[0]) << 4) | (level4(color[1]) << 2) | level4(color[2]);
}

function writePbiHeader(output, rowBytes, format, width, height) {
  writeUint16LE(output, 0, rowBytes);
  writeUint16LE(output, 2, (1 << 12) | (format << 1));
  writeUint16LE(output, 4, 0);
  writeUint16LE(output, 6, 0);
  writeUint16LE(output, 8, width);
  writeUint16LE(output, 10, height);
}

// Black-and-white: luminance with Atkinson dithering for photos (keeps
// contrast on the small screen) or a clean threshold for flat screenshots.
function encodePbi1(rgb, width, height, kind) {
  var rowBytes = pbiRowBytes(width, 1);
  var output = new Uint8Array(pbiSize(width, height, 1));
  var luma = new Float32Array(width * height);
  var i;
  for (i = 0; i < width * height; i += 1) {
    luma[i] = rgb[i * 3] * 0.299 + rgb[i * 3 + 1] * 0.587 + rgb[i * 3 + 2] * 0.114;
  }
  if (kind !== 'flat') {
    stretchLevels(luma);
  }
  // Flat screenshots: compare each pixel with its neighbourhood so both dark
  // text on light and light text on dark (or coloured) bubbles stay legible.
  var localMean = null;
  if (kind === 'flat') {
    localMean = boxMean(luma, width, height, 3);
  }
  writePbiHeader(output, rowBytes, 0, width, height);
  for (var y = 0; y < height; y += 1) {
    for (var x = 0; x < width; x += 1) {
      i = y * width + x;
      var white;
      if (localMean && Math.abs(luma[i] - localMean[i]) >= 16) {
        white = luma[i] > localMean[i];
      } else {
        white = luma[i] >= 128;
      }
      if (white) {
        output[12 + y * rowBytes + (x >> 3)] |= 1 << (x & 7);
      }
      if (kind !== 'flat') {
        var err = (luma[i] - (white ? 255 : 0)) / 8;
        if (x + 1 < width) luma[i + 1] += err;
        if (x + 2 < width) luma[i + 2] += err;
        if (y + 1 < height) {
          if (x > 0) luma[i + width - 1] += err;
          luma[i + width] += err;
          if (x + 1 < width) luma[i + width + 1] += err;
        }
        if (y + 2 < height) luma[i + width * 2] += err;
      }
    }
  }
  return output;
}

// Spreads a photo's brightness over the full range (ignoring the darkest and
// brightest 2%), so dim photos do not dither into black on a 1-bit screen.
function stretchLevels(luma) {
  var hist = new Uint32Array(256);
  var i;
  for (i = 0; i < luma.length; i += 1) {
    hist[Math.max(0, Math.min(255, luma[i] | 0))] += 1;
  }
  var cut = luma.length * 0.02;
  var low = 0;
  var high = 255;
  var seen = 0;
  while (low < 255 && seen + hist[low] <= cut) {
    seen += hist[low];
    low += 1;
  }
  seen = 0;
  while (high > 0 && seen + hist[high] <= cut) {
    seen += hist[high];
    high -= 1;
  }
  if (high - low < 32) {
    return;
  }
  var scale = 255 / (high - low);
  for (i = 0; i < luma.length; i += 1) {
    luma[i] = Math.max(0, Math.min(255, (luma[i] - low) * scale));
  }
}

// Mean of each pixel's (2r+1)^2 neighbourhood, via a summed-area table.
function boxMean(values, width, height, radius) {
  var sums = new Float64Array((width + 1) * (height + 1));
  var x;
  var y;
  for (y = 0; y < height; y += 1) {
    var rowSum = 0;
    for (x = 0; x < width; x += 1) {
      rowSum += values[y * width + x];
      sums[(y + 1) * (width + 1) + x + 1] = sums[y * (width + 1) + x + 1] + rowSum;
    }
  }
  var out = new Float32Array(width * height);
  for (y = 0; y < height; y += 1) {
    var y0 = Math.max(0, y - radius);
    var y1 = Math.min(height, y + radius + 1);
    for (x = 0; x < width; x += 1) {
      var x0 = Math.max(0, x - radius);
      var x1 = Math.min(width, x + radius + 1);
      var total = sums[y1 * (width + 1) + x1] - sums[y0 * (width + 1) + x1] -
                  sums[y1 * (width + 1) + x0] + sums[y0 * (width + 1) + x0];
      out[y * width + x] = total / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
}

function encodePbiIndexed(rgb, width, height, bpp, kind) {
  var pixels = width * height;
  var dither = kind === 'photo';
  var palette;
  if (bpp === 8) {
    palette = [];
    for (var c = 0; c < 64; c += 1) {
      palette.push(paletteRgb(c));
    }
  } else {
    palette = choosePalette(pebbleHistogram(rgb, pixels), 1 << bpp);
  }
  var indexes = mapToPalette(rgb, width, height, palette, dither);
  var rowBytes = pbiRowBytes(width, bpp);
  var output = new Uint8Array(pbiSize(width, height, bpp));
  var format = bpp === 8 ? 1 : (bpp === 4 ? 4 : 3);
  writePbiHeader(output, rowBytes, format, width, height);
  var perByte = 8 / bpp;
  for (var y = 0; y < height; y += 1) {
    var row = 12 + y * rowBytes;
    for (var x = 0; x < width; x += 1) {
      var index = indexes[y * width + x];
      if (bpp === 8) {
        output[row + x] = argb8(palette[index]);
      } else {
        var shift = 8 - bpp * ((x % perByte) + 1);
        output[row + Math.floor(x / perByte)] |= index << shift;
      }
    }
  }
  if (bpp !== 8) {
    var paletteStart = 12 + rowBytes * height;
    for (var p = 0; p < (1 << bpp); p += 1) {
      output[paletteStart + p] = argb8(palette[p] || palette[0]);
    }
  }
  return output;
}

function encodeWatchPhoto(work, plan) {
  var rgb = work.rgb;
  var width = work.width;
  var height = work.height;
  if (plan.width !== width || plan.height !== height) {
    rgb = resizeForWatch(rgbToRgba(rgb, width, height), plan.width, plan.height);
  }
  if (plan.bpp === 1) {
    return encodePbi1(rgb, plan.width, plan.height, work.kind);
  }
  return encodePbiIndexed(rgb, plan.width, plan.height, plan.bpp, work.kind);
}

function rgbToRgba(rgb, width, height) {
  var data = new Uint8Array(width * height * 4);
  for (var i = 0; i < width * height; i += 1) {
    data[i * 4] = rgb[i * 3];
    data[i * 4 + 1] = rgb[i * 3 + 1];
    data[i * 4 + 2] = rgb[i * 3 + 2];
    data[i * 4 + 3] = 255;
  }
  return {width: width, height: height, data: data};
}

function findWork(key) {
  for (var i = 0; i < workCache.length; i += 1) {
    if (workCache[i].key === key) {
      return workCache[i];
    }
  }
  return null;
}

function keepWork(work) {
  workCache = workCache.filter(function(item) { return item.key !== work.key; });
  workCache.push(work);
  while (workCache.length > MAX_WORK_CACHE) {
    workCache.shift();
  }
}

function photoCacheKey(chatId, messageId, plan) {
  return [PHOTO_CACHE_VERSION, chatId, messageId, plan.width, plan.height, plan.bpp].join(':');
}

// request: {width, height, budget, blackAndWhite}
function imageBytes(chatId, messageId, request, status) {
  var generation = ++foregroundImageGeneration;
  function isCancelled() {
    return generation !== foregroundImageGeneration;
  }
  var options = {isCancelled: isCancelled, status: status};
  var width = Math.max(16, request.width || 120);
  var height = Math.max(16, request.height || 120);
  var budget = request.budget || 8000;
  var bw = !!request.blackAndWhite;
  var workKey = [chatId, messageId, width, height].join(':');
  var kinds = loadPhotoKinds();

  function fromWork(work) {
    var plan = choosePhotoPlan(width, height, budget, work.kind, bw);
    if (!plan) {
      throw new Error('Not enough memory');
    }
    var key = photoCacheKey(chatId, messageId, plan);
    if (imageCache[key]) {
      noteImageCacheUse(key);
      return imageCache[key];
    }
    imageStatus(options, 'Encoding');
    var encoded = encodeWatchPhoto(work, plan);
    cacheSet(key, encoded);
    return encoded;
  }

  // Fast path: the phone already made this photo at this size and depth.
  var knownKind = kinds[workKey];
  if (knownKind) {
    var knownPlan = choosePhotoPlan(width, height, budget, knownKind, bw);
    if (knownPlan) {
      var knownKey = photoCacheKey(chatId, messageId, knownPlan);
      if (imageCache[knownKey]) {
        noteImageCacheUse(knownKey);
        imageStatus(options, 'Cache hit');
        return Promise.resolve(imageCache[knownKey]);
      }
      var stored = persistentCacheGet(knownKey);
      if (stored) {
        imageStatus(options, 'Cache hit');
        return Promise.resolve(stored);
      }
    }
  }
  var cachedWork = findWork(workKey);
  if (cachedWork) {
    return Promise.resolve().then(function() {
      return fromWork(cachedWork);
    });
  }
  if (status) {
    status('Downloading');
  }
  return withTimeout(Promise.resolve().then(function() {
    return telegram.downloadMedia(chatId, messageId, {
      targetWidth: width,
      targetHeight: height,
      cancelled: isCancelled
    });
  }), 'image pipeline timed out', MEDIA_PIPELINE_TIMEOUT_MS).then(function(raw) {
    var bytes = toUint8Array(raw);
    if (!bytes || !bytes.length) {
      throw new Error('empty image');
    }
    throwIfCancelled(options);
    imageStatus(options, 'Decoding');
    return nextTurn().then(function() {
      var source = rgbaBuffer(bytes);
      throwIfCancelled(options);
      imageStatus(options, 'Resizing');
      var rgb = resizeForWatch(source, width, height);
      var work = {key: workKey, width: width, height: height, rgb: rgb,
                  kind: photoKind(rgb, width * height)};
      keepWork(work);
      rememberPhotoKind(workKey, work.kind);
      throwIfCancelled(options);
      return fromWork(work);
    });
  });
}

// PackBits: compresses the flat areas of screenshots several times over; the
// watch expands it straight into the bitmap.
function packBits(data) {
  var out = new Uint8Array(data.length + Math.ceil(data.length / 128) + 1);
  var o = 0;
  var i = 0;
  var n = data.length;
  while (i < n) {
    var run = 1;
    while (i + run < n && run < 128 && data[i + run] === data[i]) {
      run += 1;
    }
    if (run >= 3) {
      out[o++] = (257 - run) & 255;
      out[o++] = data[i];
      i += run;
      continue;
    }
    var start = i;
    var length = 0;
    while (i < n && length < 128) {
      if (i + 2 < n && data[i] === data[i + 1] && data[i] === data[i + 2]) {
        break;
      }
      i += 1;
      length += 1;
    }
    out[o++] = length - 1;
    for (var k = 0; k < length; k += 1) {
      out[o++] = data[start + k];
    }
  }
  return out.subarray(0, o);
}

function avatarBytes(chatId, width, height, colors, maxBytes) {
  width = width || 28;
  height = height || 28;
  colors = colors || 16;
  maxBytes = maxBytes || 3000;
  var key = cacheKey(chatId, 'avatar', width, height, colors, maxBytes);
  return cachedBytes(key, 'avatar ' + chatId, function() {
    return telegram.downloadProfilePhoto(chatId);
  }, width, height, colors, maxBytes, true);
}

function cancelImageRequests() {
  foregroundImageGeneration += 1;
}

module.exports = {
  imageBytes: imageBytes,
  packBits: packBits,
  choosePhotoPlan: choosePhotoPlan,
  encodeForTest: function(source, width, height, budget, blackAndWhite) {
    var rgb = resizeForWatch(source, width, height);
    var work = {width: width, height: height, rgb: rgb, kind: photoKind(rgb, width * height)};
    var plan = choosePhotoPlan(width, height, budget, work.kind, blackAndWhite);
    return {kind: work.kind, plan: plan, bytes: plan ? encodeWatchPhoto(work, plan) : null};
  },
  avatarBytes: avatarBytes,
  cancelImageRequests: cancelImageRequests
};
