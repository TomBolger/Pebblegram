var MessageKeys = require('message_keys');
var pgjsBackend = require('./pgjs/backend');
var watchEmoji = require('./pgjs/emoji');

var DEBUG_LOGS = false;
var TELEGRAM_SETTINGS_PAGE_URL = 'https://tombolger.github.io/Pebblegram/pgjs/config.html';
var MAX_ROWS = 20;
var MAX_SEND_QUEUE = 80;
var MAX_CACHED_CHATS = 12;
var INITIAL_MESSAGE_ROWS = 9;
var OLDER_MESSAGE_ROWS = 7;
var NEWER_MESSAGE_ROWS = 7;
var MESSAGE_PAGE_FETCH_ROWS = 80;
var PHONE_MESSAGE_CACHE_ROWS = 600;
var MAX_MESSAGE_ROWS = 9;
var MESSAGE_EDGE_BUFFER_ROWS = 4;
var MAX_MESSAGE_TEXT = 460;
var MAX_CONTEXT_VIEW_TEXT = 1200;
var MESSAGE_WINDOW_BUDGET = 5400;
var IMAGE_SIZE = 120;
var IMAGE_WIDTH = 130;
var IMAGE_COLORS = 64;
var IMAGE_MAX_BYTES = 10000;
var IMAGE_MAX_PIXELS = 36000;
var IMAGE_CHUNK_SIZE = 500;
var AVATAR_SIZE = 28;
var AVATAR_COLORS = 16;
var AVATAR_MAX_BYTES = 3000;
var AVATAR_CHUNK_SIZE = 500;
var AVATAR_ROWS = MAX_ROWS;
var PREFETCH_CHAT_COUNT = 4;
var sendQueue = [];
var sending = false;
var messageStore = {};
var messageStoreNewest = {};
var messageHistoryStore = {};
var oldestComplete = {};
var newestComplete = {};
var prefetching = {};
var pagePrefetching = {};
var chatCacheOrder = [];
var pgjs = null;
var currentChatId = null;
var currentChatSignature = '';
var chatLoadPromise = null;
var messageLoadPromises = {};
var newerLoadPromises = {};
var updateRefreshTimer = null;
var updatesStarted = false;
var connectionKeepaliveTimer = null;
var chatListStale = false;
var avatarChats = [];
var avatarIndex = 0;
var avatarTimer = null;
var imageTransferSeq = 0;
var avatarTransferSeq = 0;
var imageRequestSeq = 0;
var imageTransferActive = false;
var messageStreamSeq = 0;
var messageStreamTimer = null;
var topPrefetchSeq = 0;
var sendFailureDelay = 250;
var cancelledImageTransferSeq = 0;
var watchReady = false;
var phonePrewarmStarted = false;
var postFirstPaintStarted = false;
var postFirstPaintTimer = null;
var deferredStartupChats = null;
var launchStartedAt = Date.now();
var IMAGE_PREPARE_TIMEOUT_MS = 25000;
var MESSAGE_FETCH_TIMEOUT_MS = 25000;
var MESSAGE_CACHE_ORDER_KEY = 'pebblegram.messageCache.v4.order';
var MESSAGE_CACHE_PREFIX = 'pebblegram.messageCache.v4.';

function getSetting(name, fallback) {
  var value = localStorage.getItem(name);
  return value === null || value === '' ? fallback : value;
}

function cannedReplies() {
  return getSetting('cannedReplies', 'Yes|No|On my way|Call you later|Thanks');
}

function settingsPageUrl() {
  return activePgjs().settingsPageUrl(TELEGRAM_SETTINGS_PAGE_URL);
}

function activePgjs() {
  if (!pgjs) {
    pgjs = pgjsBackend.create({
      cannedReplies: cannedReplies,
      status: status
    });
  }
  return pgjs;
}

function wakePhoneBackend() {
  withTimeout(activePgjs().ready(), 'wake timed out', 10000).catch(function(err) {
    debugLog('Phone wake failed: ' + (err && err.message ? err.message : err));
  });
}

function configureForPlatform() {
  var info = null;
  try {
    info = Pebble.getActiveWatchInfo ? Pebble.getActiveWatchInfo() : null;
  } catch (e) {
    info = null;
  }
  watchEmoji.setFirmware(info && info.firmware);
  if (info && info.platform === 'emery') {
    INITIAL_MESSAGE_ROWS = 9;
    OLDER_MESSAGE_ROWS = 7;
    NEWER_MESSAGE_ROWS = 7;
    MAX_MESSAGE_ROWS = 9;
    MAX_MESSAGE_TEXT = 460;
    MAX_CONTEXT_VIEW_TEXT = 1200;
    MESSAGE_WINDOW_BUDGET = 5400;
    IMAGE_SIZE = 198;
    IMAGE_WIDTH = 198;
    IMAGE_MAX_BYTES = 40000;
    IMAGE_MAX_PIXELS = 56000;
    IMAGE_CHUNK_SIZE = 500;
  } else if (info && info.platform === 'gabbro') {
    INITIAL_MESSAGE_ROWS = 9;
    OLDER_MESSAGE_ROWS = 7;
    NEWER_MESSAGE_ROWS = 7;
    MAX_MESSAGE_ROWS = 9;
    MAX_MESSAGE_TEXT = 460;
    MAX_CONTEXT_VIEW_TEXT = 1200;
    MESSAGE_WINDOW_BUDGET = 5400;
    IMAGE_SIZE = 144;
    IMAGE_WIDTH = 152;
    IMAGE_MAX_BYTES = 23000;
    IMAGE_MAX_PIXELS = 40000;
    IMAGE_CHUNK_SIZE = 500;
  } else if (info && (info.platform === 'diorite' || info.platform === 'flint')) {
    // Pebble 2 Duo (flint) shares Diorite's 144x168 black-and-white screen.
    IMAGE_SIZE = 108;
    IMAGE_WIDTH = 112;
    IMAGE_COLORS = 4;
    IMAGE_MAX_BYTES = 8500;
    IMAGE_MAX_PIXELS = 24000;
    AVATAR_SIZE = 24;
    AVATAR_COLORS = 4;
    AVATAR_MAX_BYTES = 2200;
  } else if (info && info.platform === 'basalt') {
    IMAGE_SIZE = 108;
    IMAGE_WIDTH = 116;
    IMAGE_COLORS = 16;
    IMAGE_MAX_BYTES = 9500;
    IMAGE_MAX_PIXELS = 27000;
  }
}

function debugLog(message) {
  if (DEBUG_LOGS) {
    console.log(message);
  }
}

function logDuration(label, startedAt) {
  if (DEBUG_LOGS) {
    console.log(label + ' took ' + (Date.now() - startedAt) + 'ms');
  }
}

function logLaunch(label) {
  if (DEBUG_LOGS) {
    console.log('launch +' + (Date.now() - launchStartedAt) + 'ms ' + label);
  }
}

function timed(label, promise) {
  if (!DEBUG_LOGS) {
    return promise;
  }
  var startedAt = Date.now();
  return promise.then(function(value) {
    logDuration(label, startedAt);
    return value;
  }, function(err) {
    logDuration(label + ' failed', startedAt);
    throw err;
  });
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

function prewarmPhoneBackend() {
  if (phonePrewarmStarted) {
    return;
  }
  phonePrewarmStarted = true;
  logLaunch('telegram prewarm start');
  timed('telegram prewarm', activePgjs().ready()).then(function() {
    logLaunch('telegram prewarm ready');
  }).catch(function(err) {
    phonePrewarmStarted = false;
    debugLog('Phone prewarm failed: ' + (err && err.message ? err.message : err));
  });
}

prewarmPhoneBackend();

// AppMessage delivery is serialized. Older phones can drop messages if image
// chunks and rows are pushed in parallel.
function payloadType(payload) {
  return payload && payload[MessageKeys.Type];
}

function isLowPriorityPayload(payload) {
  var type = payloadType(payload);
  return type === 'status' || isAvatarTransferPayload(payload);
}

function trimSendQueueFor(payload) {
  var start = sending ? 1 : 0;
  var index;
  while (sendQueue.length >= MAX_SEND_QUEUE) {
    index = -1;
    for (var i = start; i < sendQueue.length; i += 1) {
      if (isObsoleteQueuedPayload(sendQueue[i]) || isLowPriorityPayload(sendQueue[i].payload)) {
        index = i;
        break;
      }
    }
    if (index >= 0) {
      sendQueue.splice(index, 1);
    } else if (isLowPriorityPayload(payload)) {
      return false;
    } else {
      return true;
    }
  }
  return true;
}

function sendToWatch(payload) {
  if (!trimSendQueueFor(payload)) {
    return;
  }
  sendQueue.push({payload: payload, queuedAt: DEBUG_LOGS ? Date.now() : 0});
  flushQueue();
}

function isAvatarTransferPayload(payload) {
  var type = payloadType(payload);
  return type === 'avatar_start' || type === 'avatar' || type === 'avatar_done';
}

function isImageTransferPayload(payload) {
  var type = payloadType(payload);
  return type === 'image_start' || type === 'image' || type === 'image_done' ||
    type === 'image_error' || type === 'image_status';
}

function isMessageTransferPayload(payload) {
  var type = payloadType(payload);
  return type === 'messages_start' || type === 'message' || type === 'message_prepend' || type === 'message_append' || type === 'messages_done';
}

function pruneQueuedPayloads(match) {
  var write = 0;
  for (var read = 0; read < sendQueue.length; read += 1) {
    if ((read === 0 && sending) || !match(sendQueue[read].payload)) {
      sendQueue[write] = sendQueue[read];
      write += 1;
    }
  }
  sendQueue.length = write;
}

function cancelQueuedMessageTransfers() {
  messageStreamSeq += 1;
  if (messageStreamTimer) {
    clearTimeout(messageStreamTimer);
    messageStreamTimer = null;
  }
  pruneQueuedPayloads(isMessageTransferPayload);
}

function cancelQueuedImageTransfers() {
  imageRequestSeq += 1;
  cancelledImageTransferSeq = imageTransferSeq;
  imageTransferActive = false;
  if (pgjs && typeof pgjs.cancelImageRequests === 'function') {
    pgjs.cancelImageRequests();
  }
  pruneQueuedPayloads(isImageTransferPayload);
}

function transferId(payload) {
  return payload && payload[MessageKeys.ImageTransferId] || 0;
}

function isObsoleteQueuedPayload(entry) {
  var payload = entry && entry.payload;
  var id = transferId(payload);
  if (!payload) {
    return true;
  }
  if (isImageTransferPayload(payload)) {
    return id > 0 && id <= cancelledImageTransferSeq;
  }
  if (isMessageTransferPayload(payload)) {
    return id > 0 && id < messageStreamSeq;
  }
  return false;
}

function cancelQueuedAvatarTransfers() {
  if (avatarTimer) {
    clearTimeout(avatarTimer);
    avatarTimer = null;
  }
  pruneQueuedPayloads(isAvatarTransferPayload);
}

function flushQueue() {
  while (sendQueue.length > 0 && isObsoleteQueuedPayload(sendQueue[0])) {
    sendQueue.shift();
  }
  if (sending || sendQueue.length === 0) {
    return;
  }
  sending = true;
  var entry = sendQueue[0];
  Pebble.sendAppMessage(entry.payload, function() {
    sendFailureDelay = 250;
    if (DEBUG_LOGS && (entry.payload[MessageKeys.Type] === 'image_done' ||
        entry.payload[MessageKeys.Type] === 'chats_done' ||
        entry.payload[MessageKeys.Type] === 'messages_done')) {
      logDuration('AppMessage ' + entry.payload[MessageKeys.Type] + ' queue', entry.queuedAt);
    }
    if (entry.payload[MessageKeys.Type] === 'image_done' ||
        entry.payload[MessageKeys.Type] === 'image_error') {
      imageTransferActive = false;
    }
    sendQueue.shift();
    sending = false;
    flushQueue();
  }, function(error) {
    entry.attempts = (entry.attempts || 0) + 1;
    sending = false;
    debugLog('sendAppMessage failed: ' + JSON.stringify(error));
    if (isObsoleteQueuedPayload(entry) || (entry.attempts >= 6 && (isImageTransferPayload(entry.payload) || isAvatarTransferPayload(entry.payload)))) {
      if (sendQueue[0] === entry) {
        sendQueue.shift();
      }
      if (isImageTransferPayload(entry.payload)) {
        imageTransferActive = false;
      }
      sendFailureDelay = 250;
      flushQueue();
      return;
    }
    setTimeout(flushQueue, sendFailureDelay);
    sendFailureDelay = Math.min(5000, Math.floor(sendFailureDelay * 1.6));
  });
}

function status(text) {
  if (!watchReady) {
    debugLog('Status before watch ready: ' + text);
    return;
  }
  var payload = {};
  payload[MessageKeys.Type] = 'status';
  payload[MessageKeys.Status] = text;
  sendToWatch(payload);
}

function sendSettings() {
  var payload = {};
  payload[MessageKeys.Type] = 'settings';
  payload[MessageKeys.CannedReplies] = cannedReplies();
  sendToWatch(payload);
}

function error(text) {
  var payload = {};
  payload[MessageKeys.Type] = 'error';
  payload[MessageKeys.Error] = text;
  sendToWatch(payload);
}

function done(kind, count, transferId, flag) {
  var payload = {};
  payload[MessageKeys.Type] = kind;
  payload[MessageKeys.Count] = count;
  if (transferId) {
    payload[MessageKeys.ImageTransferId] = transferId;
  }
  if (flag) {
    payload[MessageKeys.Text] = flag;
  }
  sendToWatch(payload);
}

function promiseError(prefix, err) {
  var message = err && err.message ? err.message : String(err || 'unknown error');
  debugLog(prefix + ': ' + message);
  error(prefix + ': ' + message);
}

var WATCH_LINK_TLDS = {
  app: true,
  biz: true,
  ca: true,
  co: true,
  com: true,
  dev: true,
  edu: true,
  gov: true,
  info: true,
  io: true,
  me: true,
  net: true,
  org: true,
  tv: true,
  uk: true,
  us: true
};

// Emoji the watch can draw pass through; everything else becomes :shortcode:.
// See pgjs/emoji.js.
function normalizeWatchString(value) {
  return watchEmoji.convert(String(value === undefined || value === null ? '' : value))
    .replace(/[\u200b\u200c\u200e\u200f\ufeff]/g, '');
}

function clampText(value, maxLength) {
  return clampUtf8Bytes(normalizeWatchString(value), maxLength);
}

function isLikelyBareLinkHost(host) {
  var parts = String(host || '').toLowerCase().split('.');
  var tld = parts.length > 1 ? parts[parts.length - 1] : '';
  return !!WATCH_LINK_TLDS[tld];
}

function shortenWatchLinks(value) {
  return String(value || '').replace(/\b((?:https?:\/\/|www\.)[^\s<>"']+|(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}(?:\/[^\s<>"']*)?)/ig, function(url, _link, offset, text) {
    if (offset > 0 && text.charAt(offset - 1) === '@') {
      return url;
    }
    var trailer = '';
    var cleanUrl = url.replace(/[.,!?;:)\]}]+$/g, function(match) {
      trailer = match + trailer;
      return '';
    });
    var match = cleanUrl.match(/^(?:https?:\/\/)?(?:www\.)?([^\/?#]+)/i);
    if (match && cleanUrl.indexOf('://') === -1 && cleanUrl.slice(0, 4).toLowerCase() !== 'www.' &&
        !isLikelyBareLinkHost(match[1])) {
      return url;
    }
    return (match ? '[Link] ' + match[1] : '[Link]') + trailer;
  });
}

function summarizeWatchStackTrace(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n\s+at\s+[^\n]+/g, ' [trace]')
    .replace(/\n\s*\.\.\.\s+\d+\s+more/g, ' [trace]')
    .replace(/(?:\s+\[trace\]){2,}/g, ' [trace]');
}

function shortenTechnicalToken(token) {
  var suffix = '';
  var core = String(token || '').replace(/[.,!?;:)\]}]+$/g, function(match) {
    suffix = match + suffix;
    return '';
  });
  var parts = core.split('.');
  var shortCore = parts.length > 2 ? parts.slice(-2).join('.') : core;
  if (shortCore.length > 24 && parts.length > 1) {
    shortCore = parts[parts.length - 1];
  }
  if (shortCore.length > 24) {
    shortCore = clampUtf8Bytes(shortCore, 21) + '...';
  }
  return shortCore + suffix;
}

function shortenWatchTechnicalTokens(value) {
  return String(value || '')
    .replace(/\br8-map-id-[A-Za-z0-9-]+(?::\d+)?/g, 'r8-map')
    .replace(/\b[A-Za-z_$][A-Za-z0-9_$]*(?:[.$][A-Za-z_$][A-Za-z0-9_$]*){2,}(?::\d+)?/g, shortenTechnicalToken);
}

function shortenToken(token) {
  return clampUtf8Bytes(token, 21) + '...';
}

function watchText(value, maxLength) {
  value = shortenWatchTechnicalTokens(shortenWatchLinks(summarizeWatchStackTrace(normalizeWatchString(value))))
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\b([A-Za-z0-9_.-]{2,})\/([A-Za-z0-9_.-]{2,})\b/g, '$1 / $2')
    .replace(/[^\s]{29,}/g, function(token) {
      // Never cut an emoji :shortcode: in half.
      return /:[a-z0-9_+-]{2,}:/i.test(token) ? token : shortenToken(token);
    })
    .trim();
  return clampUtf8Bytes(value, maxLength);
}

function diagnosticText(value, maxLength) {
  return clampUtf8Bytes(normalizeWatchString(value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim(), maxLength);
}

function utf8ByteLengthAt(value, index) {
  var code = value.charCodeAt(index);
  if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
    var next = value.charCodeAt(index + 1);
    if (next >= 0xdc00 && next <= 0xdfff) {
      return 4;
    }
  }
  if (code < 0x80) {
    return 1;
  }
  if (code < 0x800) {
    return 2;
  }
  return 3;
}

function clampUtf8Bytes(value, maxBytes) {
  value = String(value || '');
  var bytes = 0;
  var output = '';
  for (var i = 0; i < value.length; i += 1) {
    var charBytes = utf8ByteLengthAt(value, i);
    if (bytes + charBytes > maxBytes) {
      break;
    }
    output += value.charAt(i);
    bytes += charBytes;
    if (charBytes === 4 && i + 1 < value.length) {
      output += value.charAt(i + 1);
      i += 1;
    }
  }
  return output;
}

function payloadValue(payload, name) {
  if (!payload) {
    return undefined;
  }
  if (payload[MessageKeys[name]] !== undefined) {
    return payload[MessageKeys[name]];
  }
  return payload[name];
}

function chatPayload(chat, index, total) {
  var payload = {};
  payload[MessageKeys.Type] = 'chat';
  payload[MessageKeys.Index] = index;
  payload[MessageKeys.Count] = Math.min(total, MAX_ROWS);
  payload[MessageKeys.ChatId] = clampText(chat.id, 23);
  payload[MessageKeys.Sender] = clampText(chat.title || 'Untitled', 47);
  payload[MessageKeys.Text] = watchText(chat.preview, 71);
  payload[MessageKeys.IsUnread] = chat.unread ? 1 : 0;
  payload[MessageKeys.UnreadCount] = chat.unread_count || 0;
  if (chat.meta) {
    payload[MessageKeys.MessageMeta] = clampUtf8Bytes(chat.meta, 15);
  }
  return payload;
}

function sendChatRows(chats, silent) {
  var rows = (chats || []).slice(0, MAX_ROWS);
  for (var index = 0; index < rows.length; index += 1) {
    sendToWatch(chatPayload(rows[index], index, rows.length));
  }
  done('chats_done', rows.length);
}

function messageRowCost(message) {
  var contextCost = (message.reply_text || '').length + (message.forward_text || '').length;
  return 64 + String(message.text || '').length + contextCost + (message.image_token ? 180 : 0);
}

function limitMessageWindow(messages, preferNewest) {
  var rows = messages || [];
  var selected = [];
  var used = 0;
  var i;
  if (preferNewest) {
    for (i = rows.length - 1; i >= 0 && selected.length < MAX_MESSAGE_ROWS; i -= 1) {
      used += messageRowCost(rows[i]);
      if (selected.length > 0 && used > MESSAGE_WINDOW_BUDGET) {
        break;
      }
      selected.unshift(rows[i]);
    }
    return selected;
  }
  for (i = 0; i < rows.length && selected.length < MAX_MESSAGE_ROWS; i += 1) {
    used += messageRowCost(rows[i]);
    if (selected.length > 0 && used > MESSAGE_WINDOW_BUDGET) {
      break;
    }
    selected.push(rows[i]);
  }
  return selected;
}

function persistentMessageCacheKey(chatId) {
  return MESSAGE_CACHE_PREFIX + String(chatId || '');
}

function persistentMessageCacheOrder() {
  try {
    return JSON.parse(localStorage.getItem(MESSAGE_CACHE_ORDER_KEY) || '[]');
  } catch (e) {
    return [];
  }
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

function savePersistentMessages(chatId, messages) {
  var id = String(chatId || '');
  if (!id) {
    return;
  }
  try {
    var rows = limitMessageWindow(messages || [], true);
    if (!rows.length) {
      return;
    }
    localStorage.setItem(persistentMessageCacheKey(id), JSON.stringify(rows));
    var order = removeArrayValue(persistentMessageCacheOrder(), id);
    order.push(id);
    while (order.length > MAX_CACHED_CHATS) {
      localStorage.removeItem(persistentMessageCacheKey(order.shift()));
    }
    localStorage.setItem(MESSAGE_CACHE_ORDER_KEY, JSON.stringify(order));
  } catch (e) {
    debugLog('Message cache save skipped: ' + (e && e.message ? e.message : e));
  }
}

function loadPersistentMessages(chatId) {
  var id = String(chatId || '');
  if (!id) {
    return [];
  }
  try {
    var rows = JSON.parse(localStorage.getItem(persistentMessageCacheKey(id)) || '[]');
    return Array.isArray(rows) ? limitMessageWindow(rows, true) : [];
  } catch (e) {
    localStorage.removeItem(persistentMessageCacheKey(id));
    return [];
  }
}

function removePersistentMessages(chatId) {
  var id = String(chatId || '');
  if (!id) {
    return;
  }
  localStorage.removeItem(persistentMessageCacheKey(id));
  try {
    var order = removeArrayValue(persistentMessageCacheOrder(), id);
    localStorage.setItem(MESSAGE_CACHE_ORDER_KEY, JSON.stringify(order));
  } catch (e) {}
}

function messagePayload(message, type, index, count, transferId) {
  var payload = {};
  payload[MessageKeys.Type] = type || 'message';
  payload[MessageKeys.Index] = index || 0;
  payload[MessageKeys.Count] = count;
  if (transferId) {
    payload[MessageKeys.ImageTransferId] = transferId;
  }
  payload[MessageKeys.MessageId] = clampText(message.id, 23);
  payload[MessageKeys.Sender] = clampText(message.sender, 35);
  payload[MessageKeys.Text] = watchText(message.text, MAX_MESSAGE_TEXT);
  if (message.reactions) {
    payload[MessageKeys.Reactions] = clampText(message.reactions, 63);
  }
  if (message.meta) {
    payload[MessageKeys.MessageMeta] = clampUtf8Bytes(message.meta, 15);
  }
  if (message.reply_sender) {
    payload[MessageKeys.ReplySender] = clampText(message.reply_sender, 35);
  }
  if (message.reply_text) {
    payload[MessageKeys.ReplyText] = watchText(message.reply_text, 95);
  }
  if (message.forward_sender) {
    payload[MessageKeys.ForwardSender] = clampText(message.forward_sender, 35);
  }
  if (message.forward_text) {
    payload[MessageKeys.ForwardText] = watchText(message.forward_text, 95);
  }
  payload[MessageKeys.IsOutgoing] = message.outgoing ? 1 : 0;
  if (message.image_token) {
    payload[MessageKeys.ImageToken] = String(message.image_token);
    if (message.image_width && message.image_height) {
      payload[MessageKeys.ImageWidth] = message.image_width;
      payload[MessageKeys.ImageHeight] = message.image_height;
    }
  }
  return payload;
}

function streamMessageRows(chatId, messages, mode, finalCount) {
  var isSilent = mode === 'older_silent' || mode === 'newer_silent';
  var isOlder = mode === 'older' || mode === 'older_silent';
  var isNewer = mode === 'newer' || mode === 'newer_silent';
  var rows = limitMessageWindow(messages || [], !isOlder && !isNewer);
  var doneCount = finalCount === undefined ? rows.length : finalCount;
  var transferId = ++messageStreamSeq;
  var cursor = isNewer ? 0 : rows.length - 1;
  var modeCode = isOlder ? 1 : (isNewer ? 2 : 0);
  var start = {};
  start[MessageKeys.Type] = 'messages_start';
  start[MessageKeys.Count] = doneCount;
  start[MessageKeys.Index] = modeCode;
  if (isSilent) {
    start[MessageKeys.Text] = 'silent';
  }
  start[MessageKeys.ImageTransferId] = transferId;
  sendToWatch(start);

  function pump() {
    if (transferId !== messageStreamSeq || currentChatId !== chatId) {
      return;
    }
    if ((!isNewer && cursor < 0) || (isNewer && cursor >= rows.length)) {
      messageStreamTimer = null;
      done('messages_done', doneCount, transferId);
      return;
    }
    sendToWatch(messagePayload(rows[cursor], isNewer ? 'message_append' : 'message_prepend', 0, doneCount, transferId));
    cursor += isNewer ? 1 : -1;
    messageStreamTimer = setTimeout(pump, isOlder || isNewer ? 16 : 20);
  }
  pump();
}

function sendMessageRows(messages, chatId, mode, finalCount) {
  mode = mode || 'initial';
  if (mode === 'initial') {
    sendMessageWindow(chatId || currentChatId, messages, mode, false, finalCount);
    return;
  }
  streamMessageRows(chatId || currentChatId, messages, mode, finalCount);
}

function sendMessageWindow(chatId, messages, mode, silent, finalCount) {
  var rows = limitMessageWindow(messages || [], mode === 'initial');
  var doneCount = finalCount === undefined ? rows.length : finalCount;
  var transferId = ++messageStreamSeq;
  var modeCode = mode === 'older' ? 1 : (mode === 'newer' ? 2 : 0);
  var start = {};
  start[MessageKeys.Type] = 'messages_start';
  start[MessageKeys.Count] = doneCount;
  start[MessageKeys.Index] = modeCode;
  if (silent) {
    start[MessageKeys.Text] = 'silent';
  }
  start[MessageKeys.ImageTransferId] = transferId;
  sendToWatch(start);
  rows.forEach(function(message, index) {
    sendToWatch(messagePayload(message, 'message', index, rows.length, transferId));
  });
  done('messages_done', doneCount, transferId);
}

function sendMessagePatches(chatId, messages) {
  var count = (messageStore[chatId] || []).length;
  (messages || []).forEach(function(message) {
    sendToWatch(messagePayload(message, 'message_update', 0, count, 0));
  });
}

function messageSortValue(id) {
  var parsed = parseInt(id, 10);
  return isNaN(parsed) ? String(id || '') : parsed;
}

function compareMessageIds(a, b) {
  var av = messageSortValue(a && a.id);
  var bv = messageSortValue(b && b.id);
  if (typeof av === 'number' && typeof bv === 'number') {
    return av - bv;
  }
  av = String(av);
  bv = String(bv);
  return av < bv ? -1 : (av > bv ? 1 : 0);
}

function removeChatCache(chatId, clearPersistent) {
  var id = String(chatId || '');
  if (!id) {
    return;
  }
  delete messageStore[id];
  delete messageStoreNewest[id];
  delete messageHistoryStore[id];
  delete oldestComplete[id];
  delete newestComplete[id];
  delete prefetching[id];
  Object.keys(pagePrefetching).forEach(function(key) {
    if (key.indexOf(id + ':') === 0) {
      delete pagePrefetching[key];
    }
  });
  removeArrayValue(chatCacheOrder, id);
  if (clearPersistent !== false) {
    removePersistentMessages(id);
  }
}

function touchChatCache(chatId) {
  var id = String(chatId || '');
  if (!id) {
    return;
  }
  removeArrayValue(chatCacheOrder, id);
  chatCacheOrder.push(id);
}

function trimChatCaches(protectedChatId) {
  var protectedId = String(protectedChatId || '');
  var attempts = 0;
  while (chatCacheOrder.length > MAX_CACHED_CHATS && attempts <= chatCacheOrder.length) {
    var id = chatCacheOrder.shift();
    if (id === protectedId) {
      chatCacheOrder.push(id);
      attempts += 1;
      continue;
    }
    removeChatCache(id, false);
    attempts = 0;
  }
}

function mergeHistoryMessages(chatId, rows) {
  var existing = messageHistoryStore[chatId] || [];
  var byId = {};
  var merged;

  function ingest(source) {
    (source || []).forEach(function(message) {
      if (message && message.id !== undefined && message.id !== null) {
        byId[String(message.id)] = message;
      }
    });
  }

  ingest(existing);
  ingest(rows);
  merged = Object.keys(byId).map(function(id) {
    return byId[id];
  }).sort(compareMessageIds);
  if (merged.length > PHONE_MESSAGE_CACHE_ROWS) {
    merged = merged.slice(merged.length - PHONE_MESSAGE_CACHE_ROWS);
  }
  messageHistoryStore[chatId] = merged;
  touchChatCache(chatId);
  trimChatCaches(currentChatId || chatId);
  return merged;
}

function cachedOlderRows(chatId, beforeId, limit) {
  var rows = messageHistoryStore[chatId] || [];
  var before = String(beforeId);
  var index = rows.length;
  for (var i = 0; i < rows.length; i += 1) {
    if (String(rows[i].id) === before) {
      index = i;
      break;
    }
  }
  return rows.slice(Math.max(0, index - limit), index);
}

function cachedNewerRows(chatId, afterId, limit) {
  var rows = messageHistoryStore[chatId] || [];
  var after = String(afterId);
  var index = -1;
  for (var i = 0; i < rows.length; i += 1) {
    if (String(rows[i].id) === after) {
      index = i;
      break;
    }
  }
  return index < 0 ? [] : rows.slice(index + 1, index + 1 + limit);
}

function messageIndexById(rows, messageId) {
  var id = String(messageId || '');
  for (var i = 0; i < rows.length; i += 1) {
    if (String(rows[i].id) === id) {
      return i;
    }
  }
  return -1;
}

function messageWindowAroundAnchor(rows, anchorId, olderAhead) {
  var anchorIndex = messageIndexById(rows, anchorId);
  var start;
  if (anchorIndex < 0) {
    return rows.slice(Math.max(0, rows.length - MAX_MESSAGE_ROWS));
  }
  start = anchorIndex - olderAhead;
  if (start < 0) {
    start = 0;
  }
  if (start + MAX_MESSAGE_ROWS > rows.length) {
    start = Math.max(0, rows.length - MAX_MESSAGE_ROWS);
  }
  return rows.slice(start, start + MAX_MESSAGE_ROWS);
}

function sendOlderWindow(chatId, anchorId, beforeId, silent) {
  var rows = cachedOlderRows(chatId, beforeId || anchorId, OLDER_MESSAGE_ROWS);
  var merged;
  if (!rows.length) {
    done('messages_done', 0, 0, silent ? 'silent' : null);
    return 0;
  }
  touchChatCache(chatId);
  trimChatCaches(currentChatId || chatId);
  merged = messageHistoryStore[chatId] || [];
  messageStore[chatId] = messageWindowAroundAnchor(merged, anchorId, MESSAGE_EDGE_BUFFER_ROWS);
  messageStoreNewest[chatId] = false;
  sendMessageWindow(chatId, messageStore[chatId], 'older', silent, messageStore[chatId].length);
  return rows.length;
}

function sendNewerWindow(chatId, anchorId, afterId, silent) {
  var rows = cachedNewerRows(chatId, afterId || anchorId, NEWER_MESSAGE_ROWS);
  var merged;
  if (!rows.length) {
    done('messages_done', 0, 0, silent ? 'silent' : null);
    return 0;
  }
  touchChatCache(chatId);
  trimChatCaches(currentChatId || chatId);
  merged = messageHistoryStore[chatId] || [];
  messageStore[chatId] = messageWindowAroundAnchor(merged, anchorId,
                                                     MAX_MESSAGE_ROWS - MESSAGE_EDGE_BUFFER_ROWS - 1);
  messageStoreNewest[chatId] = false;
  sendMessageWindow(chatId, messageStore[chatId], 'newer', silent, messageStore[chatId].length);
  return rows.length;
}

function warmChatHistory(chatId) {
  if (!chatId || prefetching[chatId]) {
    return;
  }
  touchChatCache(chatId);
  prefetching[chatId] = true;
  timed('warm history ' + chatId, activePgjs().messages(chatId, MESSAGE_PAGE_FETCH_ROWS)).then(function(messages) {
    delete prefetching[chatId];
    messages = messages || [];
    mergeHistoryMessages(chatId, messages);
    if (!messageStore[chatId]) {
      messageStore[chatId] = limitMessageWindow(messages, true);
      messageStoreNewest[chatId] = true;
      savePersistentMessages(chatId, messageStore[chatId]);
    }
  }).catch(function(err) {
    delete prefetching[chatId];
    debugLog('History warm failed for ' + chatId + ': ' + (err && err.message ? err.message : err));
  });
}

function rememberMessages(chatId, messages) {
  messages = messages || [];
  mergeHistoryMessages(chatId, messages);
  messageStore[chatId] = limitMessageWindow(messages, true);
  messageStoreNewest[chatId] = true;
  savePersistentMessages(chatId, messageStore[chatId]);
}

function mergeMessages(existing, incoming, allowAppend, trimNewest) {
  var byId = {};
  var merged = [];
  var changed = false;

  existing.forEach(function(message) {
    byId[message.id] = message;
    merged.push(message);
  });

  incoming.forEach(function(message) {
    var previous = byId[message.id];
    if (previous) {
      if (singleMessageSignature(previous) !== singleMessageSignature(message)) {
        for (var i = 0; i < merged.length; i += 1) {
          if (merged[i].id === message.id) {
            merged[i] = message;
            changed = true;
            break;
          }
        }
      }
      return;
    }
    if (!allowAppend) {
      return;
    }
    byId[message.id] = message;
    merged.push(message);
    changed = true;
  });

  if (trimNewest && merged.length > MAX_MESSAGE_ROWS) {
    merged = merged.slice(merged.length - MAX_MESSAGE_ROWS);
    changed = true;
  }

  return {
    messages: merged,
    changed: changed
  };
}

function storedWindowTouchesNewestTail(existing, latest) {
  if (!existing || existing.length === 0) {
    return true;
  }
  if (!latest || latest.length === 0) {
    return false;
  }
  var newestKnownId = existing[existing.length - 1].id;
  for (var i = 0; i < latest.length; i += 1) {
    if (latest[i].id === newestKnownId) {
      return true;
    }
  }
  return false;
}

function sendStoredMessages(chatId) {
  var messages = messageStore[chatId];
  if ((!messages || messages.length === 0) && chatId && messageStoreNewest[chatId] === true) {
    messages = loadPersistentMessages(chatId);
    if (messages.length > 0) {
      messageStore[chatId] = messages;
      mergeHistoryMessages(chatId, messages);
    }
  }
  if (messageStoreNewest[chatId] !== true) {
    return false;
  }
  if (!messages || messages.length === 0) {
    return false;
  }
  currentChatSignature = messageSignature(messages);
  touchChatCache(chatId);
  markRead(chatId);
  sendMessageRows(messages, chatId, 'initial');
  return true;
}

function storedMessage(chatId, messageId) {
  var rows = messageStore[chatId] || [];
  for (var i = 0; i < rows.length; i += 1) {
    if (String(rows[i].id) === String(messageId)) {
      return rows[i];
    }
  }
  return null;
}

function sendFullMessageText(chatId, messageId) {
  var message = storedMessage(chatId, messageId);
  var payload = {};
  payload[MessageKeys.Type] = 'message_context';
  payload[MessageKeys.MessageId] = clampText(messageId, 23);
  payload[MessageKeys.Sender] = '';
  payload[MessageKeys.Text] = watchText(message ? message.text : 'Message not loaded', MAX_CONTEXT_VIEW_TEXT);
  sendToWatch(payload);
}

function sendMessageContext(chatId, messageId) {
  var message = storedMessage(chatId, messageId);
  var payload = {};
  var title = 'Reply';
  var text = 'Message not loaded';
  if (message) {
    if (message.reply_text || message.reply_sender) {
      title = message.reply_sender || 'Reply';
      text = message.reply_text || 'Message';
    } else if (message.forward_text || message.forward_sender) {
      title = 'Fwd from ' + (message.forward_sender || 'Forwarded');
      text = message.forward_text || 'Message';
    }
  }
  payload[MessageKeys.Type] = 'message_context';
  payload[MessageKeys.MessageId] = clampText(messageId, 23);
  payload[MessageKeys.Sender] = clampText(title, 35);
  payload[MessageKeys.Text] = watchText(text, MAX_CONTEXT_VIEW_TEXT);
  sendToWatch(payload);
}

function prefetchMessages(chatId) {
  warmChatHistory(chatId);
}

function prefetchTopChats(chats) {
  var rows = (chats || []).slice(0, PREFETCH_CHAT_COUNT);
  var seq = ++topPrefetchSeq;

  function prefetchAt(index) {
    if (seq !== topPrefetchSeq || index >= rows.length) {
      return;
    }
    setTimeout(function() {
      if (seq !== topPrefetchSeq) {
        return;
      }
      if (currentChatId || avatarTimer || avatarIndex < avatarChats.length) {
        prefetchAt(index);
        return;
      }
      prefetchMessages(rows[index].id);
      prefetchAt(index + 1);
    }, index === 0 ? 2500 : 900);
  }

  prefetchAt(0);
}

function scheduleUpdateRefresh(delay) {
  if (updateRefreshTimer) {
    return;
  }
  updateRefreshTimer = setTimeout(function() {
    updateRefreshTimer = null;
    if (imageTransferActive) {
      scheduleUpdateRefresh(1500);
      return;
    }
    if (!currentChatId) {
      getChats(true);
    } else {
      refreshOpenChat(true);
    }
  }, delay || 1000);
}

function cancelUpdateRefresh() {
  if (updateRefreshTimer) {
    clearTimeout(updateRefreshTimer);
    updateRefreshTimer = null;
  }
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
  return idPart(value.userId || value.chatId || value.channelId || value.peerId || value.id);
}

function updateChatId(update) {
  var message = update && (update.message || update.Message);
  return peerId(message && message.peerId) ||
    peerId(message && message.peer) ||
    peerId(update && update.peer) ||
    idPart(update && (update.userId || update.chatId || update.channelId));
}

function handleTelegramUpdate(update) {
  var chatId = updateChatId(update);
  if (currentChatId) {
    if (chatId && chatId === currentChatId) {
      scheduleUpdateRefresh(900);
    } else if (!chatId || chatId !== currentChatId) {
      chatListStale = true;
    }
    return;
  }
  scheduleUpdateRefresh(900);
}


function startConnectionKeepalive() {
  if (connectionKeepaliveTimer) {
    return;
  }
  connectionKeepaliveTimer = setInterval(function() {
    var keepalive;
    if (imageTransferActive) {
      return;
    }
    keepalive = activePgjs().keepalive || activePgjs().ready;
    withTimeout(keepalive(), 'keepalive timed out', 10000).catch(function(err) {
      debugLog('Keepalive reconnect failed: ' + (err && err.message ? err.message : err));
    });
  }, 45000);
}

function startTelegramUpdates() {
  if (updatesStarted) {
    return;
  }
  updatesStarted = true;
  activePgjs().ready().then(function(client) {
    if (!client || typeof client.addEventHandler !== 'function') {
      debugLog('Telegram updates unavailable; chat list refresh is manual only.');
      return;
    }
    client.addEventHandler(handleTelegramUpdate);
    debugLog('Telegram updates enabled.');
  }).catch(function(err) {
    updatesStarted = false;
    debugLog('Telegram updates failed: ' + (err && err.message ? err.message : err));
  });
}

function runPostFirstPaintWork(chats) {
  if (postFirstPaintTimer) {
    clearTimeout(postFirstPaintTimer);
    postFirstPaintTimer = null;
  }
  if (!postFirstPaintStarted) {
    postFirstPaintStarted = true;
    sendSettings();
    startConnectionKeepalive();
    startTelegramUpdates();
  }
  chats = chats || deferredStartupChats || [];
  deferredStartupChats = null;
  if (chats.length > 0) {
    queueChatAvatars(chats);
    prefetchTopChats(chats);
  }
}

function deferPostFirstPaintWork(chats) {
  if (postFirstPaintStarted) {
    runPostFirstPaintWork(chats);
    return;
  }
  deferredStartupChats = chats || [];
  if (!postFirstPaintTimer) {
    postFirstPaintTimer = setTimeout(function() {
      postFirstPaintTimer = null;
      runPostFirstPaintWork();
    }, 2500);
  }
}

function getChats(silent) {
  if (chatLoadPromise) {
    if (!silent) {
      status('Connecting...');
    }
    return chatLoadPromise;
  }
  if (!silent) {
    status('Connecting...');
  }
  chatLoadPromise = timed('telegram connect', activePgjs().ready()).then(function() {
    if (!silent) {
      status('Fetching chats...');
    }
    return timed('chat list load', activePgjs().chats(MAX_ROWS));
  }).then(function(chats) {
    chats = chats || [];
    sendChatRows(chats, silent);
    deferPostFirstPaintWork(chats);
  }).catch(function(err) {
    if (silent) {
      debugLog('Silent chats failed: ' + (err && err.message ? err.message : err));
    } else {
      promiseError('Chats failed', err);
    }
  }).then(function(value) {
    chatLoadPromise = null;
    return value;
  }, function(err) {
    chatLoadPromise = null;
    throw err;
  });
  return chatLoadPromise;
}

function getMessages(chatId) {
  var key = String(chatId || '');
  currentChatId = chatId;
  topPrefetchSeq += 1;
  currentChatSignature = '';
  touchChatCache(chatId);
  cancelUpdateRefresh();
  cancelQueuedMessageTransfers();
  cancelQueuedAvatarTransfers();
  cancelQueuedImageTransfers();
  if (sendStoredMessages(chatId)) {
    return;
  }
  if (messageLoadPromises[key]) {
    status('Loading messages...');
    return;
  }
  status('Loading messages...');
  messageLoadPromises[key] = timed('messages load ' + chatId, withTimeout(activePgjs().messages(chatId, INITIAL_MESSAGE_ROWS),
                                      'messages load timed out', MESSAGE_FETCH_TIMEOUT_MS)).then(function(messages) {
    delete messageLoadPromises[key];
    rememberMessages(chatId, messages || []);
    currentChatSignature = messageSignature(messages || []);
    markRead(chatId);
    sendMessageRows(messages || [], chatId, 'initial');
    warmChatHistory(chatId);
  }).catch(function(err) {
    delete messageLoadPromises[key];
    promiseError('Messages failed', err);
  });
}

function refreshOpenChat() {
  var chatId = currentChatId;
  if (!chatId) {
    return;
  }
  withTimeout(activePgjs().messages(chatId, INITIAL_MESSAGE_ROWS),
              'chat refresh timed out', MESSAGE_FETCH_TIMEOUT_MS).then(function(messages) {
    var signature;
    if (currentChatId !== chatId) {
      return;
    }
    messages = messages || [];
    signature = messageSignature(messages);
    if (signature === currentChatSignature) {
      return;
    }
    currentChatSignature = signature;
    var existing = messageStore[chatId] || [];
    var attachedToNewest = storedWindowTouchesNewestTail(existing, messages);
    var previousById = {};
    var appended = [];
    var patches = [];
    existing.forEach(function(message) {
      previousById[message.id] = message;
    });
    mergeHistoryMessages(chatId, messages);
    if (attachedToNewest) {
      messages.forEach(function(message) {
        if (!previousById[message.id]) {
          appended.push(message);
        }
      });
    }
    var merged = mergeMessages(existing, messages, attachedToNewest, attachedToNewest);
    if (merged.changed) {
      messageStore[chatId] = merged.messages;
      messageStoreNewest[chatId] = attachedToNewest;
      if (attachedToNewest) {
        savePersistentMessages(chatId, messageStore[chatId]);
      }
      merged.messages.forEach(function(message) {
        var previous = previousById[message.id];
        if (previous && singleMessageSignature(previous) !== singleMessageSignature(message)) {
          patches.push(message);
        }
      });
      if (patches.length) {
        sendMessagePatches(chatId, patches);
      }
      if (appended.length) {
        sendMessageRows(appended, chatId, 'newer', messageStore[chatId].length);
      }
      if (attachedToNewest) {
        markRead(chatId);
      }
    }
  }).catch(function(err) {
    debugLog('Open chat refresh failed for ' + chatId + ': ' + (err && err.message ? err.message : err));
  });
}

function verifyReaction(chatId, messageId, token) {
  if (typeof activePgjs().message !== 'function') {
    return Promise.resolve(false);
  }
  return withTimeout(activePgjs().message(chatId, messageId),
                     'reaction verify timed out', MESSAGE_FETCH_TIMEOUT_MS).then(function(message) {
    var existing;
    var merged;
    if (!message) {
      return false;
    }
    mergeHistoryMessages(chatId, [message]);
    existing = messageStore[chatId] || [];
    merged = mergeMessages(existing, [message], false, false);
    if (merged.changed) {
      messageStore[chatId] = merged.messages;
      savePersistentMessages(chatId, messageStore[chatId]);
      sendMessagePatches(chatId, [message]);
    }
    return reactionApplied(message, token);
  }).catch(function(err) {
    debugLog('Reaction verify failed: ' + (err && err.message ? err.message : err));
    return false;
  });
}

function retryReactionAfterError(chatId, messageId, token, originalError) {
  setTimeout(function() {
    activePgjs().sendReaction(chatId, messageId, token).then(function() {
      var payload = {};
      payload[MessageKeys.Type] = 'reacted';
      sendToWatch(payload);
      refreshOpenChat();
    }).catch(function(retryErr) {
      verifyReaction(chatId, messageId, token).then(function(applied) {
        var payload = {};
        if (applied) {
          payload[MessageKeys.Type] = 'reacted';
          sendToWatch(payload);
        } else {
          promiseError('Reaction failed', retryErr || originalError);
        }
      });
    });
  }, 700);
}

function leaveChat(chatId) {
  if (!chatId || currentChatId === chatId) {
    currentChatId = null;
    currentChatSignature = '';
    cancelQueuedMessageTransfers();
    cancelQueuedImageTransfers();
    avatarIndex = 0;
    scheduleChatAvatars(300);
    if (chatListStale) {
      chatListStale = false;
      getChats(true);
    }
  }
}

function singleMessageSignature(message) {
  return [
    message.id,
    message.text,
    message.reactions || '',
    message.meta || '',
    message.reply_sender || '',
    message.reply_text || '',
    message.forward_sender || '',
    message.forward_text || '',
    message.image_token || '',
    message.outgoing ? '1' : '0'
  ].join('|');
}

function messageSignature(messages) {
  return (messages || []).map(singleMessageSignature).join('~');
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

function reactionGlyph(token) {
  // The watch sends either a legacy name ("like") or the emoji itself.
  if (REACTION_TOKENS.hasOwnProperty(token)) {
    return REACTION_TOKENS[token];
  }
  return token && /[^\x00-\x7f]/.test(token) ? token : '';
}

function reactionApplied(message, token) {
  var reactions = (message && message.reactions) || '';
  var glyph = reactionGlyph(token);
  if (token === 'remove') {
    return reactions === '';
  }
  return !!(glyph && reactions.indexOf(glyph) !== -1);
}

function markRead(chatId) {
  activePgjs().markRead(chatId).catch(function(err) {
    debugLog('Mark read failed for ' + chatId + ': ' + (err && err.message ? err.message : err));
  });
}

function getOlderMessages(chatId, anchorId, beforeId, silent) {
  beforeId = beforeId || anchorId;
  if (!beforeId) {
    done('messages_done', 0, 0, silent ? 'silent' : null);
    return;
  }
  if (!silent) {
    cancelQueuedImageTransfers();
  }
  if (cachedOlderRows(chatId, beforeId, OLDER_MESSAGE_ROWS).length >= OLDER_MESSAGE_ROWS || oldestComplete[chatId]) {
    sendOlderWindow(chatId, anchorId, beforeId, silent);
    return;
  }
  if (!silent) {
    status('Loading older...');
  }
  timed('older messages load ' + chatId, withTimeout(activePgjs().olderMessages(chatId, MESSAGE_PAGE_FETCH_ROWS, beforeId),
                                            'older messages timed out', MESSAGE_FETCH_TIMEOUT_MS)).then(function(older) {
    older = older || [];
    if (older.length === 0) {
      oldestComplete[chatId] = true;
    }
    mergeHistoryMessages(chatId, older);
    sendOlderWindow(chatId, anchorId, beforeId, silent);
  }).catch(function(err) {
    done('messages_done', 0, 0, silent ? 'silent' : null);
    promiseError('Older failed', err);
  });
}

function getNewerMessages(chatId, anchorId, afterId, silent) {
  afterId = afterId || anchorId;
  var key = String(chatId || '') + ':' + String(afterId || '');
  if (!afterId) {
    done('messages_done', 0, 0, silent ? 'silent' : null);
    return;
  }
  if (!silent) {
    cancelQueuedImageTransfers();
  }
  if (cachedNewerRows(chatId, afterId, NEWER_MESSAGE_ROWS).length >= NEWER_MESSAGE_ROWS || newestComplete[chatId]) {
    sendNewerWindow(chatId, anchorId, afterId, silent);
    return;
  }
  if (!silent) {
    status('Loading newer...');
  }
  if (newerLoadPromises[key]) {
    return;
  }
  newerLoadPromises[key] = timed('newer messages load ' + chatId, withTimeout(activePgjs().newerMessages(chatId, MESSAGE_PAGE_FETCH_ROWS, afterId),
                                            'newer messages timed out', MESSAGE_FETCH_TIMEOUT_MS)).then(function(newer) {
    delete newerLoadPromises[key];
    newer = newer || [];
    if (newer.length === 0) {
      newestComplete[chatId] = true;
    }
    mergeHistoryMessages(chatId, newer);
    sendNewerWindow(chatId, anchorId, afterId, silent);
  }).catch(function(err) {
    delete newerLoadPromises[key];
    done('messages_done', 0, 0, silent ? 'silent' : null);
    promiseError('Newer failed', err);
  });
}

function prefetchOlderMessages(chatId, beforeId) {
  beforeId = beforeId || '';
  var key = String(chatId || '') + ':older:' + beforeId;
  if (!chatId || !beforeId || cachedOlderRows(chatId, beforeId, OLDER_MESSAGE_ROWS).length >= OLDER_MESSAGE_ROWS || oldestComplete[chatId]) {
    return;
  }
  if (pagePrefetching[key]) {
    return;
  }
  pagePrefetching[key] = true;
  timed('older prefetch ' + chatId, withTimeout(activePgjs().olderMessages(chatId, MESSAGE_PAGE_FETCH_ROWS, beforeId),
                                      'older prefetch timed out', MESSAGE_FETCH_TIMEOUT_MS)).then(function(older) {
    delete pagePrefetching[key];
    older = older || [];
    if (older.length === 0) {
      oldestComplete[chatId] = true;
    }
    mergeHistoryMessages(chatId, older);
  }).catch(function(err) {
    delete pagePrefetching[key];
    debugLog('Older prefetch failed: ' + (err && err.message ? err.message : err));
  });
}

function prefetchNewerMessages(chatId, afterId) {
  afterId = afterId || '';
  var key = String(chatId || '') + ':newer:' + afterId;
  if (!chatId || !afterId || cachedNewerRows(chatId, afterId, NEWER_MESSAGE_ROWS).length >= NEWER_MESSAGE_ROWS || newestComplete[chatId]) {
    return;
  }
  if (pagePrefetching[key]) {
    return;
  }
  pagePrefetching[key] = true;
  timed('newer prefetch ' + chatId, withTimeout(activePgjs().newerMessages(chatId, MESSAGE_PAGE_FETCH_ROWS, afterId),
                                      'newer prefetch timed out', MESSAGE_FETCH_TIMEOUT_MS)).then(function(newer) {
    delete pagePrefetching[key];
    newer = newer || [];
    if (newer.length === 0) {
      newestComplete[chatId] = true;
    }
    mergeHistoryMessages(chatId, newer);
  }).catch(function(err) {
    delete pagePrefetching[key];
    debugLog('Newer prefetch failed: ' + (err && err.message ? err.message : err));
  });
}

function sendMessage(chatId, text, replyTo) {
  if (!text || !String(text).trim()) {
    error('Send failed: the watch sent an empty message.');
    return;
  }
  timed('send message ' + chatId, activePgjs().sendMessage(chatId, text, replyTo)).then(function() {
    var payload = {};
    payload[MessageKeys.Type] = 'sent';
    sendToWatch(payload);
    refreshOpenChat();
  }).catch(function(err) {
    promiseError('Send failed', err);
  });
}

function deleteMessage(chatId, messageId) {
  timed('delete message ' + chatId, activePgjs().deleteMessage(chatId, messageId)).then(function() {
    var payload = {};
    removeChatCache(chatId);
    payload[MessageKeys.Type] = 'deleted';
    payload[MessageKeys.MessageId] = String(messageId || '');
    sendToWatch(payload);
  }).catch(function(err) {
    promiseError('Delete failed', err);
  });
}

function editMessage(chatId, messageId, text) {
  timed('edit message ' + chatId, activePgjs().editMessage(chatId, messageId, text)).then(function() {
    var payload = {};
    payload[MessageKeys.Type] = 'edited';
    sendToWatch(payload);
    refreshOpenChat();
  }).catch(function(err) {
    promiseError('Edit failed', err);
  });
}

function sendReaction(chatId, messageId, token) {
  timed('send reaction ' + chatId, activePgjs().sendReaction(chatId, messageId, token)).then(function() {
    var payload = {};
    payload[MessageKeys.Type] = 'reacted';
    sendToWatch(payload);
    refreshOpenChat();
  }).catch(function(err) {
    verifyReaction(chatId, messageId, token).then(function(applied) {
      var payload = {};
      if (applied) {
        payload[MessageKeys.Type] = 'reacted';
        sendToWatch(payload);
      } else {
        retryReactionAfterError(chatId, messageId, token, err);
      }
    });
  });
}

function chatAction(kind, chatId) {
  var action = activePgjs()[kind];
  if (typeof action !== 'function') {
    error('Action unavailable');
    return;
  }
  timed(kind + ' ' + chatId, action(chatId)).then(function() {
    var payload = {};
    removeChatCache(chatId);
    payload[MessageKeys.Type] = 'chat_action_done';
    payload[MessageKeys.ChatId] = String(chatId || '');
    payload[MessageKeys.Text] = kind;
    sendToWatch(payload);
  }).catch(function(err) {
    promiseError('Chat action failed', err);
  });
}

function imageRequestOptions(value) {
  var text = String(value || '');
  var parts = text.split(':');
  var level = parseInt(parts[0], 10);
  var maxCost = parseInt(parts[1], 10);
  if (!isFinite(level) || level < 0) {
    level = 0;
  }
  if (!isFinite(maxCost) || maxCost <= 0) {
    maxCost = 0;
  }
  return {
    retryLevel: Math.min(3, level),
    maxCost: Math.min(65000, maxCost)
  };
}

function messageNeedsSafeImagePath(message) {
  return message && message.image_width > 0 && message.image_height > 0 &&
    message.image_height > message.image_width &&
    message.image_height / message.image_width >= 1.2;
}

function sendImage(chatId, messageId, requestText) {
  var startedAt = DEBUG_LOGS ? Date.now() : 0;
  var requestOptions = imageRequestOptions(requestText);
  var message = storedMessage(chatId, messageId);
  var forceTall = messageNeedsSafeImagePath(message);
  debugLog('PGIMG phone request chat=' + chatId + ' msg=' + messageId +
           ' retry=' + requestOptions.retryLevel +
           ' maxCost=' + requestOptions.maxCost +
           ' forceTall=' + (forceTall ? 1 : 0));
  cancelQueuedAvatarTransfers();
  cancelQueuedImageTransfers();
  imageTransferActive = true;
  var requestSeq = imageRequestSeq;
  sendImageStatus(messageId, requestOptions.retryLevel > 0 ? 'Resizing' : 'Preparing');
  withTimeout(activePgjs().imageBytes(chatId, messageId, IMAGE_WIDTH, IMAGE_SIZE, IMAGE_COLORS, IMAGE_MAX_BYTES,
                                      IMAGE_MAX_PIXELS, requestOptions.retryLevel, requestOptions.maxCost, forceTall,
                                      function(text) {
                if (requestSeq === imageRequestSeq && currentChatId === chatId) {
                  sendImageStatus(messageId, text);
                }
              }),
              'image prepare timed out', IMAGE_PREPARE_TIMEOUT_MS).then(function(bytes) {
    if (requestSeq !== imageRequestSeq || currentChatId !== chatId) {
      return;
    }
    if (DEBUG_LOGS) {
      logDuration('image prepare ' + messageId, startedAt);
    }
    sendImageStatus(messageId, 'Sending');
    sendImageBytes(messageId, bytes);
  }).catch(function(err) {
    if (requestSeq !== imageRequestSeq || currentChatId !== chatId) {
      return;
    }
    var detail = err && err.message ? err.message : String(err || 'unknown image error');
    debugLog('Image failed for ' + messageId + ': ' + detail);
    imageTransferActive = false;
    var failed = {};
    failed[MessageKeys.Type] = 'image_error';
    failed[MessageKeys.MessageId] = String(messageId || '');
    failed[MessageKeys.Error] = diagnosticText(detail, 95);
    sendToWatch(failed);
  });
}

function sendImageStatus(messageId, text) {
  var payload = {};
  payload[MessageKeys.Type] = 'image_status';
  payload[MessageKeys.MessageId] = String(messageId || '');
  payload[MessageKeys.Error] = diagnosticText(text || 'Preparing', 40);
  sendToWatch(payload);
}

function readUint32BE(bytes, offset) {
  return ((bytes[offset] << 24) >>> 0) +
         (bytes[offset + 1] << 16) +
         (bytes[offset + 2] << 8) +
         bytes[offset + 3];
}

function readUint16LE(bytes, offset) {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function pngDimensions(bytes) {
  if (!bytes || bytes.length < 24 ||
      bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
    return null;
  }
  return {
    width: readUint32BE(bytes, 16),
    height: readUint32BE(bytes, 20)
  };
}

function pbiDimensions(bytes) {
  if (!bytes || bytes.length < 12 || pngDimensions(bytes)) {
    return null;
  }
  var flags = readUint16LE(bytes, 2);
  var format = (flags >> 1) & 31;
  var width = readUint16LE(bytes, 8);
  var height = readUint16LE(bytes, 10);
  if (format > 4 || width <= 0 || height <= 0 || width > 512 || height > 512) {
    return null;
  }
  return {
    width: width,
    height: height
  };
}

function sendImageBytes(messageId, bytes) {
  var start = {};
  var dimensions = pngDimensions(bytes);
  var isPbi = false;
  if (!dimensions) {
    dimensions = pbiDimensions(bytes);
    isPbi = !!dimensions;
  }
  var transferId = ++imageTransferSeq;
  imageTransferActive = true;
  start[MessageKeys.Type] = 'image_start';
  start[MessageKeys.MessageId] = String(messageId || '');
  start[MessageKeys.ImageSize] = bytes.length;
  start[MessageKeys.ImageTransferId] = transferId;
  if (isPbi) {
    start[MessageKeys.Text] = 'pbi';
  }
  if (dimensions && dimensions.width > 0 && dimensions.height > 0) {
    start[MessageKeys.ImageWidth] = dimensions.width;
    start[MessageKeys.ImageHeight] = dimensions.height;
  }
  debugLog('PGIMG phone image_start msg=' + messageId +
           ' transfer=' + transferId +
           ' bytes=' + bytes.length +
           ' format=' + (isPbi ? 'pbi' : 'png') +
           ' dims=' + (dimensions ? dimensions.width + 'x' + dimensions.height : 'unknown') +
           ' chunks=' + Math.ceil(bytes.length / IMAGE_CHUNK_SIZE));
  sendToWatch(start);

  // PNGs are chunked through AppMessage and reassembled by the C app.
  for (var offset = 0; offset < bytes.length; offset += IMAGE_CHUNK_SIZE) {
    var chunk = {};
    var slice = bytes.subarray(offset, Math.min(offset + IMAGE_CHUNK_SIZE, bytes.length));
    var data = [];
    for (var i = 0; i < slice.length; i++) {
      data.push(slice[i]);
    }
    chunk[MessageKeys.Type] = 'image';
    chunk[MessageKeys.MessageId] = String(messageId || '');
    chunk[MessageKeys.Index] = offset;
    chunk[MessageKeys.ImageData] = data;
    chunk[MessageKeys.ImageTransferId] = transferId;
    sendToWatch(chunk);
  }

  var donePayload = {};
  donePayload[MessageKeys.Type] = 'image_done';
  donePayload[MessageKeys.MessageId] = String(messageId || '');
  donePayload[MessageKeys.ImageTransferId] = transferId;
  debugLog('PGIMG phone image_done queued msg=' + messageId +
           ' transfer=' + transferId);
  sendToWatch(donePayload);
}

function sendAvatar(chatId, bytes) {
  var start = {};
  var transferId = ++avatarTransferSeq;
  start[MessageKeys.Type] = 'avatar_start';
  start[MessageKeys.ChatId] = String(chatId || '');
  start[MessageKeys.ImageSize] = bytes.length;
  start[MessageKeys.ImageTransferId] = transferId;
  sendToWatch(start);

  for (var offset = 0; offset < bytes.length; offset += AVATAR_CHUNK_SIZE) {
    var chunk = {};
    var slice = bytes.subarray(offset, Math.min(offset + AVATAR_CHUNK_SIZE, bytes.length));
    var data = [];
    for (var i = 0; i < slice.length; i++) {
      data.push(slice[i]);
    }
    chunk[MessageKeys.Type] = 'avatar';
    chunk[MessageKeys.ChatId] = String(chatId || '');
    chunk[MessageKeys.Index] = offset;
    chunk[MessageKeys.ImageData] = data;
    chunk[MessageKeys.ImageTransferId] = transferId;
    sendToWatch(chunk);
  }

  var donePayload = {};
  donePayload[MessageKeys.Type] = 'avatar_done';
  donePayload[MessageKeys.ChatId] = String(chatId || '');
  donePayload[MessageKeys.ImageTransferId] = transferId;
  sendToWatch(donePayload);
}

function queueChatAvatars(chats) {
  avatarChats = (chats || []).slice(0, Math.min(MAX_ROWS, AVATAR_ROWS)).filter(function(chat) {
    return chat && chat.id;
  });
  avatarIndex = 0;
  scheduleChatAvatars(350);
}

function scheduleChatAvatars(delay) {
  if (avatarTimer) {
    clearTimeout(avatarTimer);
    avatarTimer = null;
  }
  if (currentChatId) {
    return;
  }
  if (avatarIndex >= avatarChats.length) {
    return;
  }
  avatarTimer = setTimeout(function() {
    avatarTimer = null;
    sendChatAvatars();
  }, delay);
}

function sendChatAvatars() {
  if (currentChatId) {
    return;
  }
  var chat = avatarChats[avatarIndex];
  if (!chat) {
    return;
  }
  activePgjs().avatarBytes(chat.id, AVATAR_SIZE, AVATAR_SIZE, AVATAR_COLORS, AVATAR_MAX_BYTES).then(function(bytes) {
    if (currentChatId) {
      return;
    }
    sendAvatar(chat.id, bytes);
    avatarIndex++;
    scheduleChatAvatars(80);
  }).catch(function(err) {
    debugLog('Avatar failed for ' + chat.id + ': ' + (err && err.message ? err.message : err));
    avatarIndex++;
    scheduleChatAvatars(20);
  });
}

Pebble.addEventListener('ready', function() {
  watchReady = true;
  logLaunch('Pebble ready event');
  configureForPlatform();
  debugLog('Pebblegram JS ready, backend=pgjs, canned=' + cannedReplies());
  prewarmPhoneBackend();
  getChats(false);
});

Pebble.addEventListener('appmessage', function(event) {
  var command = payloadValue(event.payload, 'Command');
  var chatId = payloadValue(event.payload, 'ChatId');
  var text = payloadValue(event.payload, 'Text');
  var replyTo = payloadValue(event.payload, 'ReplyTo');
  var messageId = payloadValue(event.payload, 'MessageId');
  var editMessageId = payloadValue(event.payload, 'EditMessageId');

  if (command === 'wake') {
    wakePhoneBackend();
  } else if (command === 'chat_first_paint') {
    runPostFirstPaintWork();
  } else if (command === 'get_chats') {
    getChats(false);
  } else if (command === 'get_messages') {
    getMessages(chatId);
  } else if (command === 'get_older_messages') {
    getOlderMessages(chatId, messageId, replyTo, text === 'silent');
  } else if (command === 'get_newer_messages') {
    getNewerMessages(chatId, messageId, replyTo, text === 'silent');
  } else if (command === 'prefetch_older_messages') {
    prefetchOlderMessages(chatId, messageId);
  } else if (command === 'prefetch_newer_messages') {
    prefetchNewerMessages(chatId, messageId);
  } else if (command === 'get_context') {
    sendMessageContext(chatId, messageId);
  } else if (command === 'get_message_text') {
    sendFullMessageText(chatId, messageId);
  } else if (command === 'leave_chat') {
    leaveChat(chatId);
  } else if (command === 'send_message') {
    sendMessage(chatId, text, replyTo);
  } else if (command === 'delete_message') {
    deleteMessage(chatId, messageId);
  } else if (command === 'edit_message') {
    editMessage(chatId, editMessageId || messageId, text);
  } else if (command === 'send_reaction') {
    sendReaction(chatId, messageId, text);
  } else if (command === 'archive_chat') {
    chatAction('archiveChat', chatId);
  } else if (command === 'delete_chat') {
    chatAction('deleteChat', chatId);
  } else if (command === 'mute_chat') {
    chatAction('muteChat', chatId);
  } else if (command === 'mark_unread') {
    chatAction('markUnread', chatId);
  } else if (command === 'get_image') {
    sendImage(chatId, messageId, text);
  } else if (command === 'cancel_image') {
    cancelQueuedImageTransfers();
  } else {
    error('Command failed');
  }
});

Pebble.addEventListener('showConfiguration', function() {
  Pebble.openURL(settingsPageUrl());
});

Pebble.addEventListener('webviewclosed', function(event) {
  if (!event || !event.response) {
    return;
  }
  var data;
  try {
    data = JSON.parse(decodeURIComponent(event.response));
  } catch (e) {
    debugLog('settings parse failed: ' + e.message);
    return;
  }

  activePgjs().applySettings(data);
  if (data.cannedReplies) {
    localStorage.setItem('cannedReplies', data.cannedReplies);
  }
  sendSettings();
  status('Requesting Telegram login...');
  timed('telegram login', activePgjs().ready()).then(function() {
    status('Telegram connected');
    getChats(false);
  }).catch(function(err) {
    debugLog('Auth failed: ' + (err && err.message ? err.message : String(err || 'unknown error')));
    error(err && err.message ? err.message : 'Auth failed');
  });
});
