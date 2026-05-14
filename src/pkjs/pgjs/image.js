var telegram = require('./telegram');
var codecs = require('./gramjs.bundle');
var imageCache = {};
var imageCacheOrder = [];
var MAX_IMAGE_CACHE_ITEMS = 8;
var MAX_PERSISTENT_IMAGE_CACHE_ITEMS = 4;
var PERSISTENT_IMAGE_CACHE_ORDER_KEY = 'pgjs.imageCacheOrder';
var IMAGE_CACHE_VERSION = 'v11';

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

function rgbaBuffer(bytes) {
  var decoded;
  if (isJpeg(bytes)) {
    decoded = codecs.JPEG.decode(bytes, {useTArray: true});
    return {
      width: decoded.width,
      height: decoded.height,
      data: new Uint8Array(decoded.data.buffer, decoded.data.byteOffset || 0, decoded.data.byteLength || decoded.data.length || 0)
    };
  }
  if (isPng(bytes)) {
    decoded = codecs.UPNG.decode(bytes.buffer.slice(bytes.byteOffset || 0, (bytes.byteOffset || 0) + bytes.byteLength));
    return {
      width: decoded.width,
      height: decoded.height,
      data: new Uint8Array(codecs.UPNG.toRGBA8(decoded)[0])
    };
  }
  throw new Error('Unsupported image format.');
}

function liftChannel(value) {
  if (value <= 0) {
    return 4;
  }
  return Math.min(255, Math.round((Math.pow(value / 255, 0.82) * 255) + 4));
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

function toneChannel(value, x, y) {
  var lifted = liftChannel(value);
  return Math.max(0, Math.min(255, Math.round(lifted + ditherOffset(x, y) * 1.4)));
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

  for (y = 0; y < height; y += 1) {
    srcY = Math.min(source.height - 1, Math.max(0, Math.floor(startY + y / scale)));
    for (x = 0; x < width; x += 1) {
      srcX = Math.min(source.width - 1, Math.max(0, Math.floor(startX + x / scale)));
      srcIndex = (srcY * source.width + srcX) * 4;
      dstIndex = (y * width + x) * 4;
      output[dstIndex] = liftColors ? toneChannel(source.data[srcIndex], x, y) : source.data[srcIndex];
      output[dstIndex + 1] = liftColors ? toneChannel(source.data[srcIndex + 1], x, y) : source.data[srcIndex + 1];
      output[dstIndex + 2] = liftColors ? toneChannel(source.data[srcIndex + 2], x, y) : source.data[srcIndex + 2];
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

  for (y = 0; y < outputHeight; y += 1) {
    srcY = Math.min(source.height - 1, Math.max(0, Math.floor(y / scale)));
    for (x = 0; x < outputWidth; x += 1) {
      srcX = Math.min(source.width - 1, Math.max(0, Math.floor(x / scale)));
      srcIndex = (srcY * source.width + srcX) * 4;
      dstIndex = (y * outputWidth + x) * 4;
      output[dstIndex] = liftColors ? toneChannel(source.data[srcIndex], x, y) : source.data[srcIndex];
      output[dstIndex + 1] = liftColors ? toneChannel(source.data[srcIndex + 1], x, y) : source.data[srcIndex + 1];
      output[dstIndex + 2] = liftColors ? toneChannel(source.data[srcIndex + 2], x, y) : source.data[srcIndex + 2];
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
  console.log(label + ' took ' + (Date.now() - startedAt) + 'ms');
}

function compactPng(source, width, height, colors, maxBytes, maskCircle, liftColors, scaleSteps, fitMode) {
  var colorSteps = [colors, 32, 16, 8, 4, 2];
  scaleSteps = scaleSteps || [1, 0.9, 0.8, 0.7, 0.6];
  var best = null;
  var step;
  var colorIndex;
  var nextWidth;
  var nextHeight;
  var encoded;

  for (step = 0; step < scaleSteps.length; step += 1) {
    nextWidth = Math.max(32, Math.floor(width * scaleSteps[step]));
    nextHeight = Math.max(32, Math.floor(height * scaleSteps[step]));
    for (colorIndex = 0; colorIndex < colorSteps.length; colorIndex += 1) {
      if (colorSteps[colorIndex] > colors) {
        continue;
      }
      encoded = encodePng(source, nextWidth, nextHeight, colorSteps[colorIndex], maskCircle, liftColors, fitMode);
      if (!best || encoded.length < best.length) {
        best = encoded;
      }
      if (!maxBytes || encoded.length <= maxBytes) {
        return encoded;
      }
    }
  }
  if (best && (!maxBytes || best.length <= maxBytes)) {
    return best;
  }
  throw new Error('Photo too large after resize.');
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
        console.log('image blank fallback used at ' + nextWidth + 'x' + nextHeight);
        return fallback;
      }
    }
  }

  throw new Error('Photo encoded as blank.');
}

function cacheKey(chatId, messageId, width, height, colors, maxBytes) {
  return [IMAGE_CACHE_VERSION, chatId, messageId, width, height, colors, maxBytes].join(':');
}

function cacheSet(key, bytes) {
  if (!imageCache[key]) {
    imageCacheOrder.push(key);
  }
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
    return bytes;
  } catch (e) {
    return null;
  }
}

function cacheSetMemoryOnly(key, bytes) {
  if (!imageCache[key]) {
    imageCacheOrder.push(key);
  }
  imageCache[key] = bytes;
  while (imageCacheOrder.length > MAX_IMAGE_CACHE_ITEMS) {
    delete imageCache[imageCacheOrder.shift()];
  }
}

function persistentCacheSet(key, bytes) {
  var order;
  var encoded = '';
  try {
    order = JSON.parse(localStorage.getItem(PERSISTENT_IMAGE_CACHE_ORDER_KEY) || '[]');
    order = order.filter(function(item) {
      return item !== key;
    });
    order.push(key);
    for (var i = 0; i < bytes.length; i += 1) {
      encoded += String.fromCharCode(bytes[i]);
    }
    localStorage.setItem('pgjs.imageCache.' + key, encoded);
    while (order.length > MAX_PERSISTENT_IMAGE_CACHE_ITEMS) {
      localStorage.removeItem('pgjs.imageCache.' + order.shift());
    }
    localStorage.setItem(PERSISTENT_IMAGE_CACHE_ORDER_KEY, JSON.stringify(order));
  } catch (e) {
    console.log('Persistent image cache skipped: ' + (e && e.message ? e.message : e));
  }
}

function cachedBytes(key, label, downloader, width, height, colors, maxBytes, maskCircle) {
  if (imageCache[key]) {
    console.log('image cache hit ' + label);
    return Promise.resolve(imageCache[key]);
  }
  var cached = persistentCacheGet(key);
  if (cached) {
    console.log('persistent image cache hit ' + label);
    return Promise.resolve(cached);
  }
  var downloadStartedAt = Date.now();
  return downloader().then(function(raw) {
    logDuration('image download ' + label, downloadStartedAt);
    var encodeStartedAt = Date.now();
    var bytes = toUint8Array(raw);
    var source;
    var encoded;
    if (!bytes || !bytes.length) {
      throw new Error('empty image');
    }
    source = rgbaBuffer(bytes);
    encoded = maskCircle ?
      safeCompactPng(source, width, height, colors, maxBytes, true) :
      compactPng(source, width, height, colors, maxBytes, false, true, [1, 0.9, 0.8, 0.7, 0.6], 'contain');
    logDuration('image encode ' + label, encodeStartedAt);
    cacheSet(key, encoded);
    return encoded;
  });
}

function imageBytes(chatId, messageId, width, height, colors, maxBytes) {
  var key;
  width = width || 120;
  height = height || 120;
  colors = colors || 64;
  maxBytes = maxBytes || 10000;
  height = height * 2;
  key = cacheKey(chatId, messageId, width, height, colors, maxBytes);
  return cachedBytes(key, messageId, function() {
    return telegram.downloadMedia(chatId, messageId);
  }, width, height, colors, maxBytes, false);
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

module.exports = {
  imageBytes: imageBytes,
  avatarBytes: avatarBytes
};
