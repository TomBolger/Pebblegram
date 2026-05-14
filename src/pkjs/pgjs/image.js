var telegram = require('./telegram');
var codecs = require('./gramjs.bundle');
var imageCache = {};
var imageCacheOrder = [];
var MAX_IMAGE_CACHE_ITEMS = 8;
var MAX_PERSISTENT_IMAGE_CACHE_ITEMS = 4;
var PERSISTENT_IMAGE_CACHE_ORDER_KEY = 'pgjs.imageCacheOrder';

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

function resizeCover(source, width, height) {
  var output = new Uint8Array(width * height * 4);
  var scale = Math.max(width / source.width, height / source.height);
  var cropW = width / scale;
  var cropH = height / scale;
  var startX = (source.width - cropW) / 2;
  var startY = (source.height - cropH) / 2;
  var x;
  var y;
  var srcX;
  var srcY;
  var srcIndex;
  var dstIndex;

  for (y = 0; y < height; y += 1) {
    srcY = Math.min(source.height - 1, Math.max(0, Math.floor(startY + y / scale)));
    for (x = 0; x < width; x += 1) {
      srcX = Math.min(source.width - 1, Math.max(0, Math.floor(startX + x / scale)));
      srcIndex = (srcY * source.width + srcX) * 4;
      dstIndex = (y * width + x) * 4;
      output[dstIndex] = liftChannel(source.data[srcIndex]);
      output[dstIndex + 1] = liftChannel(source.data[srcIndex + 1]);
      output[dstIndex + 2] = liftChannel(source.data[srcIndex + 2]);
      output[dstIndex + 3] = 255;
    }
  }
  return output;
}

function liftChannel(value) {
  if (value <= 0) {
    return 4;
  }
  return Math.min(255, Math.round((Math.pow(value / 255, 0.82) * 255) + 4));
}

function arrayBufferFromBytes(bytes) {
  return bytes.buffer.slice(bytes.byteOffset || 0, (bytes.byteOffset || 0) + bytes.byteLength);
}

function encodePng(source, width, height, colors) {
  var resized = resizeCover(source, width, height);
  return new Uint8Array(codecs.UPNG.encode([arrayBufferFromBytes(resized)], width, height, colors));
}

function logDuration(label, startedAt) {
  console.log(label + ' took ' + (Date.now() - startedAt) + 'ms');
}

function compactPng(source, width, height, colors, maxBytes) {
  var colorSteps = [colors, 32, 16, 8, 4, 2];
  var scaleSteps = [1, 0.9, 0.8, 0.7, 0.6];
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
      encoded = encodePng(source, nextWidth, nextHeight, colorSteps[colorIndex]);
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

function cacheKey(chatId, messageId, width, height, colors, maxBytes) {
  return [chatId, messageId, width, height, colors, maxBytes].join(':');
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

function imageBytes(chatId, messageId, width, height, colors, maxBytes) {
  var key;
  width = width || 120;
  height = height || 120;
  colors = colors || 64;
  maxBytes = maxBytes || 10000;
  key = cacheKey(chatId, messageId, width, height, colors, maxBytes);
  if (imageCache[key]) {
    console.log('image cache hit ' + messageId);
    return Promise.resolve(imageCache[key]);
  }
  var cached = persistentCacheGet(key);
  if (cached) {
    console.log('persistent image cache hit ' + messageId);
    return Promise.resolve(cached);
  }
  var downloadStartedAt = Date.now();
  return telegram.downloadMedia(chatId, messageId).then(function(raw) {
    logDuration('image download ' + messageId, downloadStartedAt);
    var encodeStartedAt = Date.now();
    var bytes = toUint8Array(raw);
    var source;
    var encoded;
    if (!bytes || !bytes.length) {
      throw new Error('empty image');
    }
    source = rgbaBuffer(bytes);
    encoded = compactPng(source, width, height, colors, maxBytes);
    logDuration('image encode ' + messageId, encodeStartedAt);
    cacheSet(key, encoded);
    return encoded;
  });
}

module.exports = {
  imageBytes: imageBytes
};
