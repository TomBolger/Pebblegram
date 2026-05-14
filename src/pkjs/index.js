var MessageKeys = require('message_keys');
var pgjsBackend = require('./pgjs/backend');

var TELEGRAM_SETTINGS_PAGE_URL = 'https://tombolger.github.io/Pebblegram/pgjs/config.html';
var MAX_ROWS = 20;
var INITIAL_MESSAGE_ROWS = 8;
var OLDER_MESSAGE_ROWS = 6;
var MAX_MESSAGE_ROWS = 10;
var MAX_MESSAGE_TEXT = 300;
var IMAGE_SIZE = 120;
var IMAGE_WIDTH = 130;
var IMAGE_COLORS = 64;
var IMAGE_MAX_BYTES = 10000;
var IMAGE_CHUNK_SIZE = 500;
var PREFETCH_CHAT_COUNT = 4;
var sendQueue = [];
var sending = false;
var messageStore = {};
var prefetching = {};
var pgjs = null;

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

function configureForPlatform() {
  var info = null;
  try {
    info = Pebble.getActiveWatchInfo ? Pebble.getActiveWatchInfo() : null;
  } catch (e) {
    info = null;
  }
  if (info && info.platform === 'emery') {
    INITIAL_MESSAGE_ROWS = 12;
    OLDER_MESSAGE_ROWS = 8;
    MAX_MESSAGE_ROWS = 24;
    MAX_MESSAGE_TEXT = 520;
    IMAGE_SIZE = 156;
    IMAGE_WIDTH = 170;
    IMAGE_MAX_BYTES = 20000;
    IMAGE_CHUNK_SIZE = 500;
  } else if (info && info.platform === 'gabbro') {
    INITIAL_MESSAGE_ROWS = 12;
    OLDER_MESSAGE_ROWS = 8;
    MAX_MESSAGE_ROWS = 24;
    MAX_MESSAGE_TEXT = 520;
    IMAGE_SIZE = 118;
    IMAGE_WIDTH = 128;
    IMAGE_MAX_BYTES = 20000;
    IMAGE_CHUNK_SIZE = 500;
  } else if (info && info.platform === 'diorite') {
    IMAGE_SIZE = 96;
    IMAGE_WIDTH = 102;
    IMAGE_COLORS = 4;
    IMAGE_MAX_BYTES = 6000;
  } else if (info && info.platform === 'basalt') {
    IMAGE_SIZE = 120;
    IMAGE_WIDTH = 130;
    IMAGE_MAX_BYTES = 10000;
  }
}

function logDuration(label, startedAt) {
  console.log(label + ' took ' + (Date.now() - startedAt) + 'ms');
}

function timed(label, promise) {
  var startedAt = Date.now();
  return promise.then(function(value) {
    logDuration(label, startedAt);
    return value;
  }, function(err) {
    logDuration(label + ' failed', startedAt);
    throw err;
  });
}

// AppMessage delivery is serialized. Older phones can drop messages if image
// chunks and rows are pushed in parallel.
function sendToWatch(payload) {
  sendQueue.push({payload: payload, queuedAt: Date.now()});
  flushQueue();
}

function flushQueue() {
  if (sending || sendQueue.length === 0) {
    return;
  }
  sending = true;
  var entry = sendQueue[0];
  Pebble.sendAppMessage(entry.payload, function() {
    if (entry.payload[MessageKeys.Type] === 'image_done' ||
        entry.payload[MessageKeys.Type] === 'chats_done' ||
        entry.payload[MessageKeys.Type] === 'messages_done') {
      logDuration('AppMessage ' + entry.payload[MessageKeys.Type] + ' queue', entry.queuedAt);
    }
    sendQueue.shift();
    sending = false;
    flushQueue();
  }, function(error) {
    sending = false;
    console.log('sendAppMessage failed: ' + JSON.stringify(error));
    setTimeout(flushQueue, 250);
  });
}

function status(text) {
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

function done(kind, count) {
  var payload = {};
  payload[MessageKeys.Type] = kind;
  payload[MessageKeys.Count] = count;
  sendToWatch(payload);
}

function promiseError(prefix, err) {
  var message = err && err.message ? err.message : String(err || 'unknown error');
  console.log(prefix + ': ' + message);
  error(prefix + ': ' + message);
}

function clampText(value, maxLength) {
  value = String(value || '');
  if (value.length <= maxLength) {
    return value;
  }
  return value.substring(0, maxLength - 1);
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

function sendChatRows(chats) {
  status('Sending chats...');
  chats.slice(0, MAX_ROWS).forEach(function(chat, index) {
    var payload = {};
    payload[MessageKeys.Type] = 'chat';
    payload[MessageKeys.Index] = index;
    payload[MessageKeys.Count] = Math.min(chats.length, MAX_ROWS);
    payload[MessageKeys.ChatId] = clampText(chat.id, 23);
    payload[MessageKeys.Sender] = clampText(chat.title || 'Untitled', 47);
    payload[MessageKeys.Text] = clampText(chat.preview, 71);
    payload[MessageKeys.IsUnread] = chat.unread ? 1 : 0;
    sendToWatch(payload);
  });
}

function sendMessageRows(messages) {
  messages.slice(0, MAX_MESSAGE_ROWS).forEach(function(message, index) {
    var payload = {};
    payload[MessageKeys.Type] = 'message';
    payload[MessageKeys.Index] = index;
    payload[MessageKeys.Count] = Math.min(messages.length, MAX_MESSAGE_ROWS);
    payload[MessageKeys.MessageId] = clampText(message.id, 23);
    payload[MessageKeys.Sender] = clampText(message.sender, 35);
    payload[MessageKeys.Text] = clampText(message.text, MAX_MESSAGE_TEXT);
    payload[MessageKeys.IsOutgoing] = message.outgoing ? 1 : 0;
    if (message.image_token) {
      payload[MessageKeys.ImageToken] = String(message.image_token);
    }
    sendToWatch(payload);
  });
}

function rememberMessages(chatId, messages) {
  messageStore[chatId] = messages.slice(Math.max(0, messages.length - MAX_MESSAGE_ROWS));
}

function sendStoredMessages(chatId) {
  var messages = messageStore[chatId];
  if (!messages || messages.length === 0) {
    return false;
  }
  delete messageStore[chatId];
  sendMessageRows(messages);
  done('messages_done', Math.min(messages.length, MAX_MESSAGE_ROWS));
  return true;
}

function prefetchMessages(chatId) {
  if (!chatId || messageStore[chatId] || prefetching[chatId]) {
    return;
  }
  prefetching[chatId] = true;
  timed('prefetch messages ' + chatId, activePgjs().messages(chatId, INITIAL_MESSAGE_ROWS)).then(function(messages) {
    delete prefetching[chatId];
    rememberMessages(chatId, messages || []);
  }).catch(function(err) {
    delete prefetching[chatId];
    console.log('Prefetch failed for ' + chatId + ': ' + (err && err.message ? err.message : err));
  });
}

function prefetchTopChats(chats) {
  chats.slice(0, PREFETCH_CHAT_COUNT).forEach(function(chat) {
    prefetchMessages(chat.id);
  });
}

function getChats() {
  status('Connecting...');
  timed('telegram connect', activePgjs().ready()).then(function() {
    status('Fetching chats...');
    return timed('chat list load', activePgjs().chats(MAX_ROWS));
  }).then(function(chats) {
    chats = chats || [];
    sendChatRows(chats);
    done('chats_done', Math.min(chats.length, MAX_ROWS));
    prefetchTopChats(chats);
  }).catch(function(err) {
    promiseError('Chats failed', err);
  });
}

function getMessages(chatId) {
  if (sendStoredMessages(chatId)) {
    return;
  }
  status('Loading messages...');
  timed('messages load ' + chatId, activePgjs().messages(chatId, INITIAL_MESSAGE_ROWS)).then(function(messages) {
    rememberMessages(chatId, messages || []);
    sendMessageRows(messages || []);
    done('messages_done', Math.min((messages || []).length, INITIAL_MESSAGE_ROWS));
  }).catch(function(err) {
    promiseError('Messages failed', err);
  });
}

function getOlderMessages(chatId, beforeId) {
  if (!beforeId) {
    return;
  }
  status('Loading older...');
  timed('older messages load ' + chatId, activePgjs().olderMessages(chatId, OLDER_MESSAGE_ROWS, beforeId)).then(function(older) {
    var current = messageStore[chatId] || [];
    var seen = {};
    var merged = [];
    (older || []).concat(current).forEach(function(message) {
      if (!seen[message.id]) {
        seen[message.id] = true;
        merged.push(message);
      }
    });
    messageStore[chatId] = merged.slice(0, MAX_MESSAGE_ROWS);
    sendMessageRows(messageStore[chatId]);
    done('messages_done', Math.min(messageStore[chatId].length, MAX_MESSAGE_ROWS));
  }).catch(function(err) {
    promiseError('Older failed', err);
  });
}

function sendMessage(chatId, text, replyTo) {
  timed('send message ' + chatId, activePgjs().sendMessage(chatId, text, replyTo)).then(function() {
    var payload = {};
    delete messageStore[chatId];
    payload[MessageKeys.Type] = 'sent';
    sendToWatch(payload);
  }).catch(function(err) {
    promiseError('Send failed', err);
  });
}

function deleteMessage(chatId, messageId) {
  timed('delete message ' + chatId, activePgjs().deleteMessage(chatId, messageId)).then(function() {
    var payload = {};
    delete messageStore[chatId];
    payload[MessageKeys.Type] = 'deleted';
    sendToWatch(payload);
  }).catch(function(err) {
    promiseError('Delete failed', err);
  });
}

function sendImage(chatId, messageId) {
  var startedAt = Date.now();
  activePgjs().imageBytes(chatId, messageId, IMAGE_WIDTH, IMAGE_SIZE, IMAGE_COLORS, IMAGE_MAX_BYTES).then(function(bytes) {
    logDuration('image prepare ' + messageId, startedAt);
    sendImageBytes(messageId, bytes);
  }).catch(function(err) {
    console.log('Image failed: ' + (err && err.message ? err.message : err));
    var failed = {};
    failed[MessageKeys.Type] = 'image_error';
    failed[MessageKeys.MessageId] = String(messageId || '');
    sendToWatch(failed);
  });
}

function sendImageBytes(messageId, bytes) {
  var start = {};
  start[MessageKeys.Type] = 'image_start';
  start[MessageKeys.MessageId] = String(messageId || '');
  start[MessageKeys.ImageSize] = bytes.length;
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
    sendToWatch(chunk);
  }

  var donePayload = {};
  donePayload[MessageKeys.Type] = 'image_done';
  donePayload[MessageKeys.MessageId] = String(messageId || '');
  sendToWatch(donePayload);
}

Pebble.addEventListener('ready', function() {
  configureForPlatform();
  console.log('Pebblegram JS ready, backend=pgjs, canned=' + cannedReplies());
  sendSettings();
  activePgjs().ready().catch(function(err) {
    console.log('Warm connect failed: ' + (err && err.message ? err.message : err));
  });
  getChats();
});

Pebble.addEventListener('appmessage', function(event) {
  var command = payloadValue(event.payload, 'Command');
  var chatId = payloadValue(event.payload, 'ChatId');
  var text = payloadValue(event.payload, 'Text');
  var replyTo = payloadValue(event.payload, 'ReplyTo');
  var messageId = payloadValue(event.payload, 'MessageId');

  if (command === 'get_chats') {
    getChats();
  } else if (command === 'get_messages') {
    getMessages(chatId);
  } else if (command === 'get_older_messages') {
    getOlderMessages(chatId, messageId);
  } else if (command === 'send_message') {
    sendMessage(chatId, text, replyTo);
  } else if (command === 'delete_message') {
    deleteMessage(chatId, messageId);
  } else if (command === 'get_image') {
    sendImage(chatId, messageId);
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
    console.log('settings parse failed: ' + e.message);
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
    getChats();
  }).catch(function(err) {
    console.log('Auth failed: ' + (err && err.message ? err.message : String(err || 'unknown error')));
    error(err && err.message ? err.message : 'Auth failed');
  });
});
