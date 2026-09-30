var auth = require('./auth');
var gram = require('./gramjs.bundle');
var codecs = null;
var readOutboxByChatId = {};
var MEDIA_DOWNLOAD_TIMEOUT_MS = 3000;
var FULL_MEDIA_DOWNLOAD_TIMEOUT_MS = 18000;
var MAX_SAFE_CHANNEL_PARTICIPANTS = 2000;
var MAX_MEDIA_PREVIEW_CANDIDATES = 5;
var MAX_MEDIA_PREVIEW_ATTEMPTS = 4;
var MAX_REPLY_CONTEXT_FETCHES = 12;
var MAX_FORWARD_ENTITY_FETCHES = 12;
var DEBUG_LOGS = false;
var STRIPPED_JPEG_HEADER_HEX = 'ffd8ffe000104a46494600010100000100010000ffdb004300281c1e231e19282321232d2b28303c64413c37373c7b585d4964918099968f808c8aa0b4e6c3a0aadaad8a8cc8ffcbdaeef5ffffff9bc1fffffffaffe6fdfff8ffdb0043012b2d2d3c353c76414176f8a58ca5f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8f8ffc00011080000000003012200021101031101ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffc4001f0100030101010101010101010000000000000102030405060708090a0bffc400b51100020102040403040705040400010277000102031104052131061241510761711322328108144291a1b1c109233352f0156272d10a162434e125f11718191a262728292a35363738393a434445464748494a535455565758595a636465666768696a737475767778797a82838485868788898a92939495969798999aa2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae2e3e4e5e6e7e8e9eaf2f3f4f5f6f7f8f9faffda000c03010002110311003f00';

function debugLog(message) {
  if (DEBUG_LOGS) {
    console.log(message);
  }
}

function imageCodecs() {
  if (!codecs) {
    codecs = require('./codecs.bundle');
  }
  return codecs;
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


function hexToBytes(hex) {
  var bytes = new Uint8Array(hex.length / 2);
  for (var i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function concatBytes(parts) {
  var total = 0;
  var offset = 0;
  parts.forEach(function(part) {
    total += part.length;
  });
  var merged = new Uint8Array(total);
  parts.forEach(function(part) {
    merged.set(part, offset);
    offset += part.length;
  });
  return merged;
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

function strippedPhotoToJpg(bytes) {
  if (!bytes || bytes.length < 3 || bytes[0] !== 1) {
    return bytes;
  }
  var header = hexToBytes(STRIPPED_JPEG_HEADER_HEX);
  header[164] = bytes[1];
  header[166] = bytes[2];
  return concatBytes([header, bytes.slice(3), new Uint8Array([0xff, 0xd9])]);
}

function idPart(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value);
}

function peerId(value) {
  if (!value) {
    return '';
  }
  return idPart(value.userId || value.user_id || value.chatId || value.chat_id ||
    value.channelId || value.channel_id || value.peerId || value.peer_id || value.id);
}

function entityId(entity) {
  if (!entity) {
    return '';
  }
  if (entity.id !== undefined && entity.id !== null) {
    return String(entity.id);
  }
  return String(entity.peerId || '');
}

function displayName(entity) {
  if (!entity) {
    return 'Untitled';
  }
  if (entity.title) {
    return entity.title;
  }
  var parts = [];
  if (entity.firstName) {
    parts.push(entity.firstName);
  }
  if (entity.lastName) {
    parts.push(entity.lastName);
  }
  return parts.join(' ') || entity.username || 'Untitled';
}

function messageText(message) {
  if (!message) {
    return '';
  }
  return message.message || message.text || '';
}

function hasPhoto(message) {
  return !!messagePhoto(message);
}

function objectName(value) {
  return value && (value.className || value.classType || value.constructorName || (value.constructor && value.constructor.name) || '');
}

function messagePhoto(message) {
  var media = message && message.media;
  var webpage = messageWebpage(message);
  return (message && message.photo) || (media && media.photo) || (webpage && webpage.photo) || null;
}

function hasDirectPhoto(message) {
  var media = message && message.media;
  return !!((message && message.photo) || (media && media.photo));
}

function messageWebpage(message) {
  var media = message && message.media;
  return media && (media.webpage || media.webPage) || null;
}

function photoDimensions(message) {
  var photo = messagePhoto(message);
  var sizes = (photo && photo.sizes) || [];
  var best = null;
  var width = photo && (photo.w || photo.width);
  var height = photo && (photo.h || photo.height);
  for (var i = 0; i < sizes.length; i += 1) {
    var size = sizes[i];
    var sizeWidth = size && (size.w || size.width);
    var sizeHeight = size && (size.h || size.height);
    if (!sizeWidth || !sizeHeight) {
      continue;
    }
    if (!best || (sizeWidth * sizeHeight) > (best.width * best.height)) {
      best = {width: sizeWidth, height: sizeHeight};
    }
  }
  if (best) {
    return best;
  }
  if (width && height) {
    return {width: width, height: height};
  }
  return null;
}

function isTallDimensions(dimensions) {
  return dimensions && dimensions.width > 0 && dimensions.height / dimensions.width >= 1.85;
}

function validMediaBytes(bytes) {
  bytes = toUint8Array(bytes);
  if (!isPreviewImageBytes(bytes)) {
    throw new Error('media download was not jpeg/png: ' + byteSignature(bytes));
  }
  return bytes;
}

function errorText(err) {
  return err && err.message ? err.message : String(err || 'unknown');
}

function messageDocument(message) {
  var media = message && message.media;
  return (message && message.document) || (media && media.document) || null;
}

function attributeName(attribute) {
  return objectName(attribute);
}

function documentAttributes(document) {
  return (document && document.attributes) || [];
}

function documentFileName(document) {
  var attrs = documentAttributes(document);
  for (var i = 0; i < attrs.length; i += 1) {
    if ((attributeName(attrs[i]).indexOf('Filename') !== -1 || attrs[i].fileName) && attrs[i].fileName) {
      return attrs[i].fileName;
    }
  }
  return document && (document.fileName || document.name) || '';
}

function firstStringField(source, fields) {
  var value;
  if (!source) {
    return '';
  }
  for (var i = 0; i < fields.length; i += 1) {
    value = source[fields[i]];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
}

function stickerSetLabel(stickerset) {
  return firstStringField(stickerset, [
    'title',
    'shortName',
    'short_name',
    'name',
    'slug'
  ]);
}

function stickerAttributeLabel(attribute) {
  return firstStringField(attribute, [
    'alt',
    'emoticon',
    'emoji',
    'title',
    'shortName',
    'short_name',
    'name'
  ]) || stickerSetLabel(attribute && attribute.stickerset);
}

function hasDocumentAttribute(document, name) {
  var attrs = documentAttributes(document);
  var propName = name.charAt(0).toLowerCase() + name.slice(1);
  for (var i = 0; i < attrs.length; i += 1) {
    if (attributeName(attrs[i]).indexOf(name) !== -1 || attrs[i][propName]) {
      return attrs[i];
    }
  }
  return null;
}

function documentDimensions(message) {
  var document = messageDocument(message);
  var attrs = documentAttributes(document);
  var candidates = mediaPreviewCandidates(message);
  var i;
  for (i = 0; i < attrs.length; i += 1) {
    var attr = attrs[i];
    var width = attr && (attr.w || attr.width);
    var height = attr && (attr.h || attr.height);
    if (width && height) {
      return {width: width, height: height};
    }
  }
  for (i = 0; i < candidates.length; i += 1) {
    var candidate = candidates[i];
    var candidateWidth = candidate && (candidate.w || candidate.width);
    var candidateHeight = candidate && (candidate.h || candidate.height);
    if (candidateWidth && candidateHeight) {
      return {width: candidateWidth, height: candidateHeight};
    }
  }
  return null;
}

function isPngBytes(bytes) {
  return bytes && bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

function isJpegBytes(bytes) {
  return bytes && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isPreviewImageBytes(bytes) {
  return isPngBytes(bytes) || isJpegBytes(bytes);
}

function arrayBufferFromBytes(bytes) {
  return bytes.buffer.slice(bytes.byteOffset || 0, (bytes.byteOffset || 0) + bytes.byteLength);
}

function previewDecodeError(bytes) {
  var image = imageCodecs();
  try {
    if (isJpegBytes(bytes) && image.JPEG && image.JPEG.decode) {
      image.JPEG.decode(bytes, {useTArray: true});
      return null;
    }
    if (isPngBytes(bytes) && image.UPNG && image.UPNG.decode) {
      image.UPNG.decode(arrayBufferFromBytes(bytes));
      return null;
    }
  } catch (err) {
    return err && err.message ? err.message : String(err || 'decode failed');
  }
  return null;
}

function validatedPreviewBytes(bytes) {
  bytes = toUint8Array(bytes);
  if (!isPreviewImageBytes(bytes)) {
    throw new Error('media preview was not jpeg/png: ' + byteSignature(bytes));
  }
  var decodeError = previewDecodeError(bytes);
  if (decodeError) {
    throw new Error('media preview decode failed: ' + decodeError + '; ' + byteSignature(bytes));
  }
  return bytes;
}

function hexByte(value) {
  var text = (value || 0).toString(16);
  return text.length < 2 ? '0' + text : text;
}

function imageByteKind(bytes) {
  if (!bytes || !bytes.length) {
    return 'empty';
  }
  if (isPngBytes(bytes)) {
    return 'png';
  }
  if (isJpegBytes(bytes)) {
    return 'jpeg';
  }
  if (bytes.length > 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return 'webp';
  }
  if (bytes.length > 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'gif';
  }
  if (bytes.length > 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    return 'mp4';
  }
  return 'unknown';
}

function byteSignature(bytes) {
  bytes = toUint8Array(bytes);
  if (!bytes || !bytes.length) {
    return 'empty';
  }
  var limit = Math.min(bytes.length, 12);
  var parts = [];
  for (var i = 0; i < limit; i += 1) {
    parts.push(hexByte(bytes[i]));
  }
  return imageByteKind(bytes) + ' len ' + bytes.length + ' sig ' + parts.join('');
}

function isGif(message) {
  if (isSticker(message)) {
    return false;
  }
  var document = messageDocument(message);
  var file = message && message.file;
  if (document) {
    return !!(hasDocumentAttribute(document, 'Animated') || document.mimeType === 'image/gif');
  }
  return !!(file && file.mimeType === 'image/gif');
}

function isVideo(message) {
  var document = messageDocument(message);
  var file = message && message.file;
  if (document) {
    return !!(hasDocumentAttribute(document, 'Video') || (document.mimeType || '').indexOf('video/') === 0);
  }
  return !!(file && (file.mimeType || '').indexOf('video/') === 0);
}

function isSticker(message) {
  var document = messageDocument(message);
  return !!(document && (hasDocumentAttribute(document, 'Sticker') || hasDocumentAttribute(document, 'CustomEmoji')));
}

function stickerLabel(message) {
  var document = messageDocument(message);
  var attr = hasDocumentAttribute(document, 'Sticker') ||
             hasDocumentAttribute(document, 'CustomEmoji');
  var label = attributeName(attr).indexOf('CustomEmoji') !== -1 ? 'Emoji' : 'Sticker';
  var detail = stickerAttributeLabel(attr);
  var text = messageText(message);
  return compactMediaLabel(label, detail || documentFileName(document) || text || 'not shown');
}

function hasPreviewableStill(message) {
  return !isSticker(message) &&
         (isGif(message) || isVideo(message));
}

function compactMediaLabel(label, detail) {
  return detail ? '[' + label + '] ' + detail : '[' + label + ']';
}

function webpageHost(webpage) {
  var url = webpage && (webpage.url || webpage.displayUrl || webpage.display_url);
  var match = String(url || '').match(/^(?:https?:\/\/)?(?:www\.)?([^\/?#\s]+)/i);
  return match && match[1] ? match[1] : '';
}

function mediaLabel(message) {
  var media = message && message.media;
  var mediaName = objectName(media);
  var webpage = messageWebpage(message);
  var document = messageDocument(message);
  var file = message && message.file;
  var fileName;
  var mimeType;
  var audioAttr;

  if (!message) {
    return '';
  }
  if (hasDirectPhoto(message)) {
    return compactMediaLabel('photo');
  }
  if (media) {
    if (media.phoneNumber || media.firstName || media.lastName || mediaName.indexOf('Contact') !== -1) {
      return compactMediaLabel('Contact', [media.firstName, media.lastName].filter(Boolean).join(' ') || media.phoneNumber);
    }
    if (media.geo || media.venue || mediaName.indexOf('Geo') !== -1 || mediaName.indexOf('Venue') !== -1) {
      return compactMediaLabel('Location');
    }
    if (media.poll || mediaName.indexOf('Poll') !== -1) {
      return compactMediaLabel('Poll');
    }
    if (media.invoice || mediaName.indexOf('Invoice') !== -1) {
      return compactMediaLabel('Invoice');
    }
    if (media.game || mediaName.indexOf('Game') !== -1) {
      return compactMediaLabel('Game', media.game && media.game.title);
    }
    if (webpage || mediaName.indexOf('WebPage') !== -1) {
      webpage = webpage || {};
      return compactMediaLabel('Link', webpageHost(webpage));
    }
  }
  if (!document) {
    if (file) {
      fileName = file.name || '';
      mimeType = file.mimeType || '';
      if (mimeType === 'image/gif') {
        return compactMediaLabel('GIF', fileName);
      }
      if (mimeType.indexOf('image/') === 0) {
        return compactMediaLabel('photo', fileName);
      }
      if (mimeType.indexOf('video/') === 0) {
        return compactMediaLabel('Video', fileName);
      }
      if (mimeType.indexOf('audio/') === 0) {
        return compactMediaLabel('Audio', fileName || file.title);
      }
      return compactMediaLabel('File', fileName);
    }
    return media ? compactMediaLabel('Media') : '';
  }

  fileName = documentFileName(document);
  mimeType = document.mimeType || '';
  audioAttr = hasDocumentAttribute(document, 'Audio');

  if (isSticker(message)) {
    return stickerLabel(message);
  }
  if (hasDocumentAttribute(document, 'Animated') || mimeType === 'image/gif') {
    return compactMediaLabel('GIF', fileName);
  }
  if (hasDocumentAttribute(document, 'Video') || mimeType.indexOf('video/') === 0) {
    return compactMediaLabel('Video preview', fileName);
  }
  if (audioAttr || mimeType.indexOf('audio/') === 0) {
    return compactMediaLabel(audioAttr && audioAttr.voice ? 'Voice' : 'Audio', fileName || (audioAttr && audioAttr.title));
  }
  return compactMediaLabel('File', fileName);
}

function displayMessageText(message) {
  var text = messageText(message);
  var label = mediaLabel(message);
  if (messageWebpage(message)) {
    return label || compactMediaLabel('Link');
  }
  if (label && text) {
    return label + ' ' + text;
  }
  return text || label;
}

function displayChatMessageText(message) {
  if (hasDirectPhoto(message)) {
    return messageText(message);
  }
  if (isGif(message)) {
    var gifText = messageText(message);
    return gifText ? compactMediaLabel('GIF preview') + ' ' + gifText : compactMediaLabel('GIF preview');
  }
  if (isVideo(message)) {
    var videoText = messageText(message);
    return videoText ? compactMediaLabel('Video preview') + ' ' + videoText : compactMediaLabel('Video preview');
  }
  if (isSticker(message)) {
    return stickerLabel(message);
  }
  return displayMessageText(message);
}

function pushMediaPreviewCandidate(candidates, candidate) {
  if (!candidate) {
    return;
  }
  if (Array.isArray(candidate)) {
    for (var i = 0; i < candidate.length; i += 1) {
      pushMediaPreviewCandidate(candidates, candidate[i]);
    }
    return;
  }
  if (objectName(candidate).indexOf('PhotoPathSize') !== -1) {
    return;
  }
  candidates.push(candidate);
}

function isStrippedPreviewCandidate(candidate) {
  return objectName(candidate).indexOf('PhotoStrippedSize') !== -1;
}

function isVideoPreviewCandidate(candidate) {
  return objectName(candidate).indexOf('VideoSize') !== -1;
}

function previewCandidateBytesLength(candidate) {
  var bytes = toUint8Array(candidate && (candidate.bytes || candidate.data));
  return bytes ? bytes.length : 0;
}

function previewCandidateDimensionArea(candidate) {
  if (typeof candidate === 'string') {
    return 0;
  }
  var width = candidate && (candidate.w || candidate.width);
  var height = candidate && (candidate.h || candidate.height);
  return (width || 0) * (height || 0);
}

function previewCandidateSize(candidate) {
  var sizes = candidate && candidate.sizes;
  var best = 0;
  if (typeof candidate === 'string') {
    return 0;
  }
  if (typeof (candidate && candidate.size) === 'number') {
    best = candidate.size;
  }
  if (Array.isArray(sizes)) {
    for (var i = 0; i < sizes.length; i += 1) {
      if (typeof sizes[i] === 'number' && sizes[i] > best) {
        best = sizes[i];
      }
    }
  }
  return best;
}

function mediaPreviewScore(candidate) {
  var name = objectName(candidate);
  var bytesLength = previewCandidateBytesLength(candidate);
  var area = previewCandidateDimensionArea(candidate);
  var size = previewCandidateSize(candidate);
  if (typeof candidate === 'string') {
    return 0;
  }
  if (bytesLength && !isStrippedPreviewCandidate(candidate)) {
    return 900000000 + Math.max(area, size, bytesLength);
  }
  if (name.indexOf('PhotoSizeProgressive') !== -1) {
    return 800000000 + Math.max(area, size);
  }
  if (name.indexOf('PhotoSize') !== -1) {
    return 700000000 + Math.max(area, size);
  }
  if (isVideoPreviewCandidate(candidate)) {
    return 600000000 + Math.max(area, size);
  }
  if (isStrippedPreviewCandidate(candidate)) {
    return 1000 + bytesLength;
  }
  if (area || size) {
    return 10000 + Math.max(area, size);
  }
  return 1;
}

function mediaPreviewDedupKey(candidate) {
  if (typeof candidate === 'string') {
    return 'string:' + candidate;
  }
  return [
    objectName(candidate),
    candidate && candidate.type || '',
    candidate && (candidate.w || candidate.width) || '',
    candidate && (candidate.h || candidate.height) || '',
    previewCandidateSize(candidate),
    previewCandidateBytesLength(candidate)
  ].join(':');
}

function mediaPreviewCandidates(message) {
  var media = message && message.media;
  var document = messageDocument(message);
  var file = message && message.file;
  var extendedMedia = media && (media.extendedMedia || media.extended_media);
  var candidates = [];
  var unique = [];
  var seen = {};

  pushMediaPreviewCandidate(candidates, media && (media.videoCover || media.video_cover));
  pushMediaPreviewCandidate(candidates, extendedMedia && (extendedMedia.thumb || extendedMedia.thumbs));
  pushMediaPreviewCandidate(candidates, document && (document.thumb || document.thumbnail));
  pushMediaPreviewCandidate(candidates, document && document.thumbs);
  pushMediaPreviewCandidate(candidates, file && (file.thumb || file.thumbnail || file.thumbs));
  pushMediaPreviewCandidate(candidates, media && media.photo && media.photo.sizes);
  pushMediaPreviewCandidate(candidates, document && (document.videoThumbs || document.video_thumbs));

  candidates.sort(function(a, b) {
    return mediaPreviewScore(b) - mediaPreviewScore(a);
  });
  for (var i = 0; i < candidates.length && unique.length < MAX_MEDIA_PREVIEW_CANDIDATES; i += 1) {
    var candidate = candidates[i];
    var key = mediaPreviewDedupKey(candidate);
    if (!seen[key]) {
      seen[key] = true;
      unique.push(candidate);
    }
  }
  return unique;
}

function previewThumbOption(candidate) {
  if (!candidate) {
    return null;
  }
  if (typeof candidate === 'string') {
    return candidate;
  }
  return candidate;
}

function isThumbNameCandidate(candidate) {
  return typeof candidate === 'string';
}

function candidateBytes(candidate) {
  var bytes = toUint8Array(candidate && (candidate.bytes || candidate.data));
  if (bytes && objectName(candidate).indexOf('PhotoStrippedSize') !== -1) {
    return strippedPhotoToJpg(bytes);
  }
  return bytes;
}

function imageRequestCancelled(options) {
  return options && typeof options.cancelled === 'function' && options.cancelled();
}

function throwIfImageRequestCancelled(options) {
  if (imageRequestCancelled(options)) {
    throw new Error('image request superseded');
  }
}

function gramDownloadOptions(options) {
  var output = {};
  var previousProgress = options && options.progressCallback;
  if (options && options.outputFile) {
    output.outputFile = options.outputFile;
  }
  if (options && options.thumb) {
    output.thumb = options.thumb;
  }
  output.progressCallback = function(downloaded, total) {
    throwIfImageRequestCancelled(options);
    if (previousProgress) {
      return previousProgress(downloaded, total);
    }
    return null;
  };
  return output;
}

function downloadImageBytes(client, target, options) {
  return withTimeout(Promise.resolve().then(function() {
    throwIfImageRequestCancelled(options);
    return client.downloadMedia(target, gramDownloadOptions(options));
  }), 'media preview download timed out', MEDIA_DOWNLOAD_TIMEOUT_MS).then(function(bytes) {
    throwIfImageRequestCancelled(options);
    return validatedPreviewBytes(bytes);
  });
}

function downloadFullMediaBytes(client, target, options) {
  return withTimeout(Promise.resolve().then(function() {
    throwIfImageRequestCancelled(options);
    return client.downloadMedia(target, gramDownloadOptions(options));
  }), 'media download timed out', FULL_MEDIA_DOWNLOAD_TIMEOUT_MS).then(function(bytes) {
    throwIfImageRequestCancelled(options);
    return validMediaBytes(bytes);
  });
}

function photoSizeDimensions(size) {
  var width = size && (size.w || size.width);
  var height = size && (size.h || size.height);
  if (!width || !height) {
    return null;
  }
  return {width: width, height: height};
}

function selectTallPhotoCandidate(photo, targetWidth, targetHeight) {
  var sizes = (photo && photo.sizes) || [];
  var targetArea = Math.max(1, (targetWidth || 120) * (targetHeight || 240));
  var minimumHeight = Math.max(96, targetHeight || 240);
  var best = null;
  var bestScore = 0;
  var fallback = null;
  var fallbackArea = 0;
  for (var i = 0; i < sizes.length; i += 1) {
    var size = sizes[i];
    var dimensions = photoSizeDimensions(size);
    var area;
    var score;
    if (!dimensions) {
      continue;
    }
    area = dimensions.width * dimensions.height;
    if (area > fallbackArea) {
      fallback = size;
      fallbackArea = area;
    }
    if (dimensions.height < minimumHeight) {
      continue;
    }
    score = Math.abs(area - targetArea);
    if (!best || score < bestScore) {
      best = size;
      bestScore = score;
    }
  }
  return best || fallback;
}

function downloadTallPhotoBytes(client, message, photo, options) {
  var dimensions = photoDimensions(message);
  var candidate;
  var option;
  if (!isTallDimensions(dimensions)) {
    return null;
  }
  candidate = selectTallPhotoCandidate(photo, options && options.targetWidth, options && options.targetHeight);
  option = previewThumbOption(candidate);
  if (!candidate || !option) {
    return null;
  }
  if (DEBUG_LOGS) {
    debugLog('Tall photo using Telegram size ' + option + ' for ' + dimensions.width + 'x' + dimensions.height);
  }
  return downloadImageBytes(client, message, {thumb: option, cancelled: options && options.cancelled}).catch(function(messageErr) {
    throwIfImageRequestCancelled(options);
    return downloadImageBytes(client, photo, {thumb: option, cancelled: options && options.cancelled}).catch(function(photoErr) {
      throw new Error('tall photo size ' + option + ' failed: message=' + errorText(messageErr) +
                      '; photo=' + errorText(photoErr));
    });
  });
}

function attemptLabel(prefix, candidate, option) {
  var candidateName = objectName(candidate) || String(candidate || 'candidate');
  var optionText = option ? '/' + String(option) : '';
  return prefix + ':' + candidateName + optionText;
}

function downloadMediaPreviewCandidate(client, message, candidate) {
  var media = message && message.media;
  var document = messageDocument(message);
  var option = previewThumbOption(candidate);
  var directBytes = candidateBytes(candidate);
  var attempts = [];
  var target = 0;
  var errors = [];

  function pushAttempt(label, fn) {
    if (attempts.length < MAX_MEDIA_PREVIEW_ATTEMPTS) {
      attempts.push({label: label, run: fn});
    }
  }

  if (directBytes && !isStrippedPreviewCandidate(candidate)) {
    pushAttempt(attemptLabel('direct', candidate, option), function() {
      try {
        return Promise.resolve(validatedPreviewBytes(directBytes));
      } catch (err) {
        return Promise.reject(err);
      }
    });
  }
  if (option) {
    pushAttempt(attemptLabel('message-thumb', candidate, option), function() {
      return downloadImageBytes(client, message, {thumb: option});
    });
    if (document) {
      pushAttempt(attemptLabel('document-thumb', candidate, option), function() {
        return downloadImageBytes(client, document, {thumb: option});
      });
    }
    if (media && !document && !isThumbNameCandidate(candidate)) {
      pushAttempt(attemptLabel('media-thumb', candidate, option), function() {
        return downloadImageBytes(client, media, {thumb: option});
      });
    }
  }
  if (directBytes && isStrippedPreviewCandidate(candidate)) {
    pushAttempt(attemptLabel('stripped-direct', candidate, option), function() {
      try {
        return Promise.resolve(validatedPreviewBytes(directBytes));
      } catch (err) {
        return Promise.reject(err);
      }
    });
  }

  function tryNext() {
    var attempt;
    if (target >= attempts.length) {
      throw new Error(errors.slice(-4).join(' | ') || 'no usable media preview candidate');
    }
    attempt = attempts[target++];
    return attempt.run().catch(function(err) {
      var detail = attempt.label + ': ' + (err && err.message ? err.message : err);
      errors.push(detail);
      if (DEBUG_LOGS) {
        debugLog('Media preview attempt failed ' + detail);
      }
      return tryNext();
    });
  }
  return tryNext();
}

function candidateDebugName(candidate) {
  return objectName(candidate) || String(candidate || 'candidate');
}

function downloadStillPreview(client, message) {
  var candidates = mediaPreviewCandidates(message);
  var index = 0;
  var errors = [];

  function tryNext() {
    if (index >= candidates.length) {
      throw new Error(errors.slice(-6).join(' | ') || 'media has no usable still preview; candidates=' + candidates.length);
    }
    var candidate = candidates[index++];
    return downloadMediaPreviewCandidate(client, message, candidate).catch(function(err) {
      errors.push(candidateDebugName(candidate) + ': ' + (err && err.message ? err.message : err));
      return tryNext();
    });
  }
  return tryNext();
}

function dialogUnreadMarked(dialog) {
  return !!(
    dialog.unreadMark ||
    dialog.unread_mark ||
    (dialog.dialog && (dialog.dialog.unreadMark || dialog.dialog.unread_mark))
  );
}

function numericId(value) {
  var raw = idPart(value);
  var parsed = parseInt(raw || value || 0, 10);
  return isNaN(parsed) ? 0 : parsed;
}

function dialogReadOutboxMaxId(dialog) {
  return numericId(dialog && (dialog.readOutboxMaxId || dialog.read_outbox_max_id ||
    (dialog.dialog && (dialog.dialog.readOutboxMaxId || dialog.dialog.read_outbox_max_id))));
}

function padMinute(value) {
  return value < 10 ? '0' + value : String(value);
}

function messageTimestamp(message) {
  var value = message && message.date;
  var date;
  if (!value) {
    return '';
  }
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'number') {
    date = new Date(value < 1000000000000 ? value * 1000 : value);
  } else {
    date = new Date(value);
  }
  if (!date || isNaN(date.getTime())) {
    return '';
  }
  return String(date.getHours()) + ':' + padMinute(date.getMinutes());
}

function messageReadReceipt(message, readOutboxMaxId) {
  if (!message || !message.out) {
    return 0;
  }
  return numericId(message.id) <= numericId(readOutboxMaxId) ? 2 : 1;
}

function messageMeta(message, readOutboxMaxId) {
  var timestamp = messageTimestamp(message);
  var receipt = messageReadReceipt(message, readOutboxMaxId);
  return timestamp + (receipt ? '|' + receipt : '');
}

function senderName(message) {
  if (message.out) {
    return 'You';
  }
  if (message.sender && message.sender.firstName) {
    return message.sender.firstName;
  }
  if (message.sender && message.sender.title) {
    return message.sender.title;
  }
  return '';
}

// Custom (Premium) emoji reactions only carry a document id. Telegram tells us
// which regular emoji each one stands for, so we look that up and cache it.
var customEmojiAlt = {};
var MAX_CUSTOM_EMOJI_LOOKUP = 100;

function customEmojiId(reaction) {
  var id = reaction && (reaction.documentId || reaction.document_id);
  return id === undefined || id === null ? '' : String(id);
}

function resolveCustomEmoji(client, rows) {
  var wanted = [];
  var seen = {};
  (rows || []).forEach(function(row) {
    var results = (row && row.reactions && row.reactions.results) || [];
    results.forEach(function(result) {
      var reaction = result && result.reaction;
      var id = objectName(reaction).indexOf('CustomEmoji') !== -1 ? customEmojiId(reaction) : '';
      if (id && customEmojiAlt[id] === undefined && !seen[id]) {
        seen[id] = true;
        wanted.push(reaction.documentId || reaction.document_id);
      }
    });
  });
  if (!wanted.length || !client || typeof client.invoke !== 'function') {
    return Promise.resolve();
  }
  return withTimeout(client.invoke(new gram.Api.messages.GetCustomEmojiDocuments({
    documentId: wanted.slice(0, MAX_CUSTOM_EMOJI_LOOKUP)
  })), 'custom emoji lookup', 8000).then(function(documents) {
    (documents || []).forEach(function(document) {
      var attr = hasDocumentAttribute(document, 'CustomEmoji');
      if (document && document.id !== undefined) {
        customEmojiAlt[String(document.id)] = (attr && attr.alt) || '';
      }
    });
  }).catch(function(err) {
    debugLog('custom emoji lookup failed: ' + errorText(err));
  });
}

function reactionGlyph(reaction) {
  var name = objectName(reaction);
  var glyph;
  if (!reaction) {
    return '';
  }
  glyph = reaction.emoticon || reaction.emoji || '';
  if (glyph) {
    return glyph;
  }
  if (name.indexOf('CustomEmoji') !== -1) {
    return customEmojiAlt[customEmojiId(reaction)] || ':custom_emoji:';
  }
  if (name.indexOf('Paid') !== -1) {
    return '$';
  }
  return '';
}

var MAX_REACTION_SUMMARY = 6;

function reactionSummary(message) {
  var reactions = message && message.reactions;
  var results = (reactions && reactions.results) || [];
  var parts = [];
  for (var i = 0; i < results.length && parts.length < MAX_REACTION_SUMMARY; i += 1) {
    var result = results[i];
    var glyph = reactionGlyph(result && result.reaction);
    var count = result && result.count;
    if (!glyph) {
      continue;
    }
    parts.push(glyph + (count && count > 1 ? String(count) : ''));
  }
  return parts.join(' ');
}


function replyMessageId(message) {
  var reply = message && (message.replyTo || message.reply_to);
  if (!reply) {
    return '';
  }
  return String(reply.replyToMsgId || reply.reply_to_msg_id || reply.replyToTopId || reply.reply_to_top_id || '');
}

function contextText(message) {
  return displayChatMessageText(message) || mediaLabel(message) || 'Message';
}

function replyContext(message) {
  if (!message) {
    return null;
  }
  return {
    sender: senderName(message) || 'Message',
    text: contextText(message)
  };
}

function forwardHeader(message) {
  return message && (message.fwdFrom || message.fwd_from) || null;
}

function forwardPeer(message) {
  var forward = forwardHeader(message);
  if (!forward) {
    return null;
  }
  return forward.fromId || forward.from_id || forward.savedFromPeer || forward.saved_from_peer || null;
}

function peerLabel(peer) {
  var id = peerId(peer);
  return id ? 'Peer ' + id : '';
}

function peerCacheKey(peer) {
  var name = objectName(peer);
  var id = peerId(peer);
  return id ? name + ':' + id : '';
}

function namedForwardSender(message, forwardEntities) {
  var forward = forwardHeader(message);
  var peer;
  var key;
  var entity;
  if (!forward) {
    return '';
  }
  peer = forwardPeer(message);
  key = peerCacheKey(peer);
  entity = key && forwardEntities ? forwardEntities[key] : null;
  return forward.fromName || forward.from_name || forward.postAuthor || forward.post_author ||
    forward.savedFromName || forward.saved_from_name || (entity ? displayName(entity) : '') ||
    peerLabel(peer) || 'Forwarded';
}

function forwardContext(message, forwardEntities) {
  var sender = namedForwardSender(message, forwardEntities);
  if (!sender) {
    return null;
  }
  return {
    sender: sender,
    text: contextText(message)
  };
}

function resolveForwardEntities(client, rows) {
  var byKey = {};
  var pending = [];
  rows.forEach(function(row) {
    var peer = forwardPeer(row);
    var key = peerCacheKey(peer);
    if (!key || Object.prototype.hasOwnProperty.call(byKey, key)) {
      return;
    }
    byKey[key] = null;
    if (pending.length >= MAX_FORWARD_ENTITY_FETCHES) {
      return;
    }
    try {
      pending.push(Promise.resolve(client.getEntity(peer)).then(function(entity) {
        byKey[key] = entity;
      }).catch(function() {}));
    } catch (e) {}
  });
  if (!pending.length) {
    return Promise.resolve(byKey);
  }
  return Promise.all(pending).then(function() {
    return byKey;
  });
}

function normalizeMessageWithContext(message, replies, forwardEntities, readOutboxMaxId) {
  var row = normalizeMessage(message, readOutboxMaxId);
  var replyId = replyMessageId(message);
  var reply = replyId && replies ? replies[replyId] : null;
  var forward = forwardContext(message, forwardEntities);
  if (reply) {
    row.reply_sender = reply.sender;
    row.reply_text = reply.text;
  }
  if (forward) {
    row.forward_sender = forward.sender;
    row.forward_text = forward.text;
  }
  return row;
}

function normalizeMessageRows(client, chatId, rows, readOutboxMaxId) {
  rows = rows || [];
  var byId = {};
  var replies = {};
  var missing = [];
  rows.forEach(function(row) {
    byId[String(row.id)] = row;
  });
  rows.forEach(function(row) {
    var replyId = replyMessageId(row);
    if (!replyId) {
      return;
    }
    if (byId[replyId]) {
      replies[replyId] = replyContext(byId[replyId]);
    } else if (!replies[replyId]) {
      if (missing.length < MAX_REPLY_CONTEXT_FETCHES) {
        missing.push(parseInt(replyId, 10) || replyId);
      }
      replies[replyId] = {sender: 'Reply', text: 'Message not loaded'};
    }
  });
  function finish() {
    return resolveCustomEmoji(client, rows).then(function() {
      return resolveForwardEntities(client, rows);
    }).then(function(forwardEntities) {
      return rows.map(function(row) {
        return normalizeMessageWithContext(row, replies, forwardEntities, readOutboxMaxId);
      });
    });
  }
  if (!missing.length) {
    return finish();
  }
  return client.getMessages(chatId, {ids: missing}).then(function(replyRows) {
    (replyRows || []).forEach(function(replyRow) {
      if (replyRow && replyRow.id !== undefined && replyRow.id !== null) {
        replies[String(replyRow.id)] = replyContext(replyRow);
      }
    });
    return finish();
  }).catch(function() {
    return finish();
  });
}

function normalizeMessage(message, readOutboxMaxId) {
  var previewable = hasPreviewableStill(message);
  var imageDimensions = hasDirectPhoto(message) ? photoDimensions(message) :
                        (previewable ? documentDimensions(message) : null);
  return {
    id: String(message.id),
    sender: senderName(message),
    text: displayChatMessageText(message),
    reactions: reactionSummary(message),
    meta: messageMeta(message, readOutboxMaxId),
    outgoing: !!message.out,
    image_token: (hasDirectPhoto(message) || previewable) ? String(message.id) : null,
    image_width: imageDimensions ? imageDimensions.width : 0,
    image_height: imageDimensions ? imageDimensions.height : 0
  };
}

function textWithEntitiesText(value) {
  if (!value) {
    return '';
  }
  if (typeof value === 'string') {
    return value;
  }
  return value.text || value.title || '';
}

function dialogFilterTitle(filter) {
  if (!filter) {
    return '';
  }
  return textWithEntitiesText(filter.title) || filter.name || '';
}

function dialogFilters(client) {
  if (!(gram.Api.messages && gram.Api.messages.GetDialogFilters)) {
    return Promise.resolve([]);
  }
  return client.invoke(new gram.Api.messages.GetDialogFilters({})).then(function(result) {
    return result && (result.filters || result) || [];
  }).catch(function(err) {
    debugLog('Dialog filters unavailable: ' + (err && err.message ? err.message : err));
    return [];
  });
}

function channelParticipantCount(entity) {
  return entity && (entity.participantsCount || entity.participants_count || entity.membersCount || entity.members_count || 0) || 0;
}

function isUnsafeLargeChannel(entity) {
  var name = objectName(entity);
  var count = channelParticipantCount(entity);
  if (!entity || name.indexOf('Channel') === -1) {
    return false;
  }
  if (entity.broadcast && !entity.megagroup) {
    return true;
  }
  return count > MAX_SAFE_CHANNEL_PARTICIPANTS;
}

var WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function messageDate(message) {
  var value = message && message.date;
  if (!value) {
    return null;
  }
  var date = value instanceof Date ? value :
             new Date(typeof value === 'number' ? (value < 1000000000000 ? value * 1000 : value) : value);
  return isNaN(date.getTime()) ? null : date;
}

// Telegram chat-list style: time today, weekday this week, otherwise day/month.
function chatListTime(message) {
  var date = messageDate(message);
  if (!date) {
    return '';
  }
  var now = new Date();
  var startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (date.getTime() >= startOfToday) {
    return String(date.getHours()) + ':' + padMinute(date.getMinutes());
  }
  if (date.getTime() >= startOfToday - 6 * 86400000) {
    return WEEKDAYS[date.getDay()];
  }
  return (date.getMonth() + 1) + '/' + date.getDate();
}

function dialogIsMuted(dialog) {
  var settings = dialog && ((dialog.dialog && dialog.dialog.notifySettings) || dialog.notifySettings);
  var until = settings && settings.muteUntil;
  return !!(until && until * 1000 > Date.now());
}

function dialogIsGroup(dialog, entity) {
  if (dialog && (dialog.isGroup || dialog.isChannel)) {
    return !dialog.isUser;
  }
  var name = objectName(entity);
  return name.indexOf('Chat') !== -1 || name.indexOf('Channel') !== -1;
}

// "time|flags" for the watch: g=group m=muted p=pinned 1/2=receipt on my last message.
function dialogMeta(dialog, entity) {
  var flags = '';
  var message = dialog && dialog.message;
  if (dialogIsGroup(dialog, entity)) {
    flags += 'g';
  }
  if (dialogIsMuted(dialog)) {
    flags += 'm';
  }
  if (dialog.pinned || dialog.isPinned || (dialog.dialog && (dialog.dialog.pinned || dialog.dialog.isPinned))) {
    flags += 'p';
  }
  if (message && message.out) {
    flags += numericId(message.id) <= dialogReadOutboxMaxId(dialog) ? '2' : '1';
  }
  return chatListTime(message) + '|' + flags;
}

function dialogRows(dialogs, folderName, folderOrder) {
  return (dialogs || []).map(function(dialog, index) {
    var entity = dialog.entity || {};
    var id = entityId(entity);
    var preview = dialog.message ? displayMessageText(dialog.message) : '';
    if (isUnsafeLargeChannel(entity)) {
      if (DEBUG_LOGS) {
        debugLog('Skipping large/unsupported channel ' + (displayName(entity) || id) + ' members=' + channelParticipantCount(entity));
      }
      return null;
    }
    if (folderName) {
      preview = '[' + folderName + '] ' + preview;
    }
    if (id) {
      readOutboxByChatId[id] = dialogReadOutboxMaxId(dialog);
    }
    return {
      id: id,
      title: displayName(entity),
      preview: preview,
      unread: !!(dialog.unreadCount || dialogUnreadMarked(dialog)),
      unread_count: dialog.unreadCount || 0,
      meta: dialogMeta(dialog, entity),
      pinned: !!(dialog.pinned || dialog.isPinned || (dialog.dialog && (dialog.dialog.pinned || dialog.dialog.isPinned))),
      folder_order: folderOrder || 0,
      order: index
    };
  });
}

function mergeDialogRows(groups) {
  var byId = {};
  var rows = [];
  (groups || []).forEach(function(group) {
    (group || []).forEach(function(row) {
      if (!row || !row.id) {
        return;
      }
      if (!byId[row.id]) {
        byId[row.id] = row;
        rows.push(row);
      } else {
        if (row.preview && row.preview.charAt(0) === '[' && byId[row.id].preview && byId[row.id].preview.charAt(0) !== '[') {
          byId[row.id].preview = row.preview;
        }
        byId[row.id].unread = byId[row.id].unread || row.unread;
        byId[row.id].unread_count = Math.max(byId[row.id].unread_count || 0, row.unread_count || 0);
        byId[row.id].pinned = byId[row.id].pinned || row.pinned;
      }
    });
  });
  return rows.sort(function(a, b) {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    if (a.folder_order !== b.folder_order) {
      return a.folder_order - b.folder_order;
    }
    return a.order - b.order;
  });
}

function chats(limit, options) {
  options = options || {};
  return auth.getClient().then(function(client) {
    var mainDialogsPromise = client.getDialogs({limit: limit, folder: 0});
    var archiveDialogsPromise = options.fast ? Promise.resolve([]) : client.getDialogs({limit: limit, folder: 1}).catch(function() {
      return [];
    });
    var filtersPromise = options.fast ? Promise.resolve([]) : dialogFilters(client);
    return mainDialogsPromise.then(function(mainDialogs) {
      if (options.fast) {
        return mergeDialogRows([dialogRows(mainDialogs, '', 0)]);
      }
      return filtersPromise.then(function(filters) {
        var groups = [dialogRows(mainDialogs, '', 0)];
        var requests = [];
        requests.push(archiveDialogsPromise.then(function(dialogs) {
          groups.push(dialogRows(dialogs, 'Archive', 1));
        }));
        (filters || []).forEach(function(filter, index) {
          var folderId = filter && filter.id;
          var name = dialogFilterTitle(filter);
          if (!folderId || folderId <= 1) {
            return;
          }
          requests.push(client.getDialogs({limit: limit, folder: folderId}).then(function(dialogs) {
            groups.push(dialogRows(dialogs, name || ('Folder ' + folderId), index + 2));
          }).catch(function(err) {
            debugLog('Folder ' + folderId + ' unavailable: ' + (err && err.message ? err.message : err));
          }));
        });
        return Promise.all(requests).then(function() {
          return mergeDialogRows(groups);
        });
      });
    });
  });
}

function messages(chatId, limit, beforeId) {
  return auth.getClient().then(function(client) {
    var options = {limit: limit};
    if (beforeId) {
      options.offsetId = parseInt(beforeId, 10) || 0;
    }
    return client.getMessages(chatId, options).then(function(rows) {
      return normalizeMessageRows(client, chatId, rows.slice().reverse(), readOutboxByChatId[chatId] || 0);
    });
  });
}

function newerMessages(chatId, limit, afterId) {
  return auth.getClient().then(function(client) {
    var options = {limit: limit};
    if (afterId) {
      options.minId = parseInt(afterId, 10) || 0;
    }
    return client.getMessages(chatId, options).then(function(rows) {
      return normalizeMessageRows(client, chatId, rows.slice().reverse(), readOutboxByChatId[chatId] || 0);
    });
  });
}

function sendMessage(chatId, text, replyTo) {
  return auth.getClient().then(function(client) {
    var options = {message: text};
    if (replyTo) {
      options.replyTo = parseInt(replyTo, 10) || replyTo;
    }
    return client.sendMessage(chatId, options);
  });
}

function deleteMessage(chatId, messageId) {
  return auth.getClient().then(function(client) {
    return client.deleteMessages(chatId, [parseInt(messageId, 10) || messageId], {revoke: true});
  });
}

function editMessage(chatId, messageId, text) {
  return auth.getClient().then(function(client) {
    return client.editMessage(chatId, {
      message: parseInt(messageId, 10) || messageId,
      text: text
    });
  });
}

var REACTION_TOKENS = {
  like: '\ud83d\udc4d', heart: '\u2764', laugh: '\ud83e\udd23', wow: '\ud83d\ude31',
  sad: '\ud83d\ude22', angry: '\ud83d\ude21', smile_open: '\ud83d\ude01', smile_eyes: '\ud83d\ude01',
  cry_loud: '\ud83d\ude2d', fire: '\ud83d\udd25', party: '\ud83c\udf89', star_struck: '\ud83e\udd29',
  smiling_hearts: '\ud83e\udd70', symbols_mouth: '\ud83e\udd2c', clap: '\ud83d\udc4f', grin: '\ud83d\ude01',
  think: '\ud83e\udd14', eyes: '\ud83d\udc40', love: '\ud83d\ude0d', kiss: '\ud83d\ude18',
  blush: '\ud83d\ude33', grimace: '\ud83d\ude2c', neutral: '\ud83d\ude10', angel: '\ud83d\ude07',
  devil: '\ud83d\ude08', pray: '\ud83d\ude4f', dislike: '\ud83d\udc4e', ok: '\ud83d\udc4c',
  broken_heart: '\ud83d\udc94', kiss_mark: '\ud83d\udc8b', poop: '\ud83d\udca9', sick: '\ud83e\udd2e',
  sleep: '\ud83d\ude34', cool: '\ud83d\ude0e'
};

function reactionEmoticon(token) {
  // The watch sends either a legacy name ("like") or the emoji itself.
  if (REACTION_TOKENS.hasOwnProperty(token)) {
    return REACTION_TOKENS[token];
  }
  return token && /[^\x00-\x7f]/.test(token) ? token : '';
}

function sendReaction(chatId, messageId, token) {
  return auth.getClient().then(function(client) {
    return inputPeer(client, chatId).then(function(peer) {
      var emoticon = reactionEmoticon(token);
      var request = {
        peer: peer,
        msgId: parseInt(messageId, 10) || messageId,
        addToRecent: true
      };
      if (token !== 'remove') {
        if (!emoticon) {
          throw new Error('unsupported reaction');
        }
        request.reaction = [new gram.Api.ReactionEmoji({emoticon: emoticon})];
      }
      return client.invoke(new gram.Api.messages.SendReaction(request));
    });
  });
}

function message(chatId, messageId) {
  return auth.getClient().then(function(client) {
    return client.getMessages(chatId, {ids: [parseInt(messageId, 10) || messageId]}).then(function(rows) {
      return normalizeMessageRows(client, chatId, rows || [], readOutboxByChatId[chatId] || 0).then(function(normalized) {
        return normalized && normalized[0] ? normalized[0] : null;
      });
    });
  });
}

function markRead(chatId) {
  return auth.getClient().then(function(client) {
    return client.markAsRead(chatId);
  });
}

function inputPeer(client, chatId) {
  return client.getInputEntity(parseInt(chatId, 10) || chatId);
}

function archiveChat(chatId) {
  return auth.getClient().then(function(client) {
    return inputPeer(client, chatId).then(function(peer) {
      return client.invoke(new gram.Api.folders.EditPeerFolders({
        folderPeers: [new gram.Api.InputFolderPeer({peer: peer, folderId: 1})]
      }));
    });
  });
}

function markUnread(chatId) {
  return auth.getClient().then(function(client) {
    return inputPeer(client, chatId).then(function(peer) {
      return client.invoke(new gram.Api.messages.MarkDialogUnread({
        peer: new gram.Api.InputDialogPeer({peer: peer}),
        unread: true
      }));
    });
  });
}

function muteChat(chatId) {
  return auth.getClient().then(function(client) {
    return inputPeer(client, chatId).then(function(peer) {
      return client.invoke(new gram.Api.account.UpdateNotifySettings({
        peer: new gram.Api.InputNotifyPeer({peer: peer}),
        settings: new gram.Api.InputPeerNotifySettings({muteUntil: 2147483647})
      }));
    });
  });
}

function deleteChat(chatId) {
  return auth.getClient().then(function(client) {
    return inputPeer(client, chatId).then(function(peer) {
      return client.invoke(new gram.Api.messages.DeleteHistory({
        peer: peer,
        maxId: 2147483647,
        justClear: false,
        revoke: false
      }));
    });
  });
}

function keepalive() {
  return auth.getClient().then(function(client) {
    if (gram.Api.help && gram.Api.help.GetConfig) {
      return client.invoke(new gram.Api.help.GetConfig({}));
    }
    return client.getDialogs({limit: 1});
  }).then(function() {
    return true;
  });
}

function downloadProfilePhoto(chatId) {
  return auth.getClient().then(function(client) {
    return client.getEntity(parseInt(chatId, 10) || chatId).then(function(entity) {
      return client.downloadProfilePhoto(entity, {isBig: false});
    });
  });
}

function downloadMedia(chatId, messageId, options) {
  return auth.getClient().then(function(client) {
    return client.getMessages(chatId, {ids: [parseInt(messageId, 10) || messageId]}).then(function(rows) {
      var message = rows && rows[0];
      var photo = hasDirectPhoto(message) ? messagePhoto(message) : null;
      var tallDownload;
      if (!message || (!photo && !hasPreviewableStill(message))) {
        throw new Error('message has no previewable media');
      }
      if (hasPreviewableStill(message) && !photo) {
        return downloadStillPreview(client, message);
      }
      tallDownload = downloadTallPhotoBytes(client, message, photo, options || {});
      if (tallDownload) {
        return tallDownload.catch(function(tallErr) {
          throwIfImageRequestCancelled(options);
          return downloadFullMediaBytes(client, message, {cancelled: options && options.cancelled}).catch(function(fullErr) {
            throwIfImageRequestCancelled(options);
            return downloadFullMediaBytes(client, photo || message.media, {cancelled: options && options.cancelled}).catch(function(photoErr) {
              throw new Error('tall/full media failed: tall=' + errorText(tallErr) +
                              '; message=' + errorText(fullErr) + '; photo=' + errorText(photoErr));
            });
          });
        });
      }
      return downloadFullMediaBytes(client, message, {cancelled: options && options.cancelled}).catch(function(fullErr) {
        throwIfImageRequestCancelled(options);
        return downloadFullMediaBytes(client, photo || message.media, {cancelled: options && options.cancelled}).catch(function(photoErr) {
          throw new Error('media download failed: message=' + errorText(fullErr) +
                          '; photo=' + errorText(photoErr));
        });
      });
    });
  });
}

module.exports = {
  chats: chats,
  messages: messages,
  newerMessages: newerMessages,
  keepalive: keepalive,
  sendMessage: sendMessage,
  editMessage: editMessage,
  sendReaction: sendReaction,
  message: message,
  deleteMessage: deleteMessage,
  markRead: markRead,
  archiveChat: archiveChat,
  deleteChat: deleteChat,
  muteChat: muteChat,
  markUnread: markUnread,
  downloadProfilePhoto: downloadProfilePhoto,
  downloadMedia: downloadMedia
};
