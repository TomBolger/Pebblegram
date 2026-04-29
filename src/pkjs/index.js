var MessageKeys = require('message_keys');

var DEFAULT_BRIDGE_URL = 'http://127.0.0.1:8765';
var MAX_ROWS = 20;
var INITIAL_MESSAGE_ROWS = 8;
var OLDER_MESSAGE_ROWS = 6;
var MAX_MESSAGE_ROWS = 10;
var MAX_MESSAGE_TEXT = 300;
var IMAGE_SIZE = 120;
var IMAGE_COLORS = 64;
var IMAGE_CHUNK_SIZE = 500;
var REQUEST_TIMEOUT_MS = 15000;
var sendQueue = [];
var sending = false;
var messageCache = {};

function getSetting(name, fallback) {
  var value = localStorage.getItem(name);
  return value === null || value === '' ? fallback : value;
}

function bridgeUrl() {
  return getSetting('bridgeUrl', DEFAULT_BRIDGE_URL).replace(/\/+$/, '');
}

function bridgeToken() {
  return getSetting('bridgeToken', '');
}

function cannedReplies() {
  return getSetting('cannedReplies', 'Yes|No|On my way|Call you later|Thanks');
}

function normalizeBridgeUrl(value) {
  value = String(value || '').trim();
  if (!value) {
    return '';
  }
  var configIndex = value.search(/\/config\.html(?:$|[?#])/);
  if (configIndex >= 0) {
    value = value.substring(0, configIndex);
  }
  value = value.replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(value) || /^pebblejs:/i.test(value)) {
    return '';
  }
  return value;
}

function settingsPageUrl() {
  var html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Pebblegram Settings</title><style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f3f4f6;color:#111827}main{max-width:560px;margin:0 auto;padding:18px}h1{margin:0 0 16px;font-size:24px}label{display:block;margin:16px 0 6px;font-weight:700}input,textarea{width:100%;box-sizing:border-box;border:1px solid #cbd5e1;border-radius:6px;padding:11px;font:inherit;background:#fff}textarea{min-height:92px}.hint,.status{margin-top:6px;color:#64748b;font-size:13px;line-height:1.4}.status{color:#0f766e;min-height:18px}.row{display:flex;gap:10px;margin-top:14px}button{flex:1;border:0;border-radius:6px;background:#1683d8;color:#fff;padding:13px;font:inherit;font-weight:700}.secondary{background:#e2e8f0;color:#0f172a}</style></head>' +
    '<body><main><h1>Pebblegram</h1><label for="bridgeUrl">Bridge URL</label><input id="bridgeUrl" type="url" placeholder="http://192.168.1.10:8765"><div class="hint">Use your bridge computer LAN, VPN, or hosted URL. The emulator can use http://127.0.0.1:8765.</div><label for="bridgeToken">Bridge token</label><input id="bridgeToken" type="password" placeholder="Optional, but recommended for hosted bridges"><label for="cannedReplies">Canned replies</label><textarea id="cannedReplies" placeholder="Yes|No|On my way|Call you later|Thanks"></textarea><div class="row"><button id="check" class="secondary" type="button">Check bridge</button><button id="save" type="button">Save</button></div><div id="status" class="status"></div></main>' +
    '<script>function p(){var r={};function read(x){x.split("&").forEach(function(part){if(!part)return;var i=part.indexOf("="),k=i<0?part:part.substring(0,i),v=i<0?"":part.substring(i+1);r[decodeURIComponent(k)]=decodeURIComponent(v.replace(/\\+/g," "))})}if(location.search)read(location.search.substring(1));if(location.hash)read(location.hash.substring(1));return r}var q=p(),u=document.getElementById("bridgeUrl"),t=document.getElementById("bridgeToken"),c=document.getElementById("cannedReplies"),s=document.getElementById("status");u.value=q.bridgeUrl||"http://127.0.0.1:8765";t.value=q.bridgeToken||"";c.value=q.cannedReplies||"Yes|No|On my way|Call you later|Thanks";function st(x){s.textContent=x}function check(){var h={"ngrok-skip-browser-warning":"true"},url=u.value.replace(/\\/+$/,"")+"/v1/chats?limit=1";if(t.value.trim())h.Authorization="Bearer "+t.value.trim();fetch(url,{headers:h}).then(function(r){if(!r.ok)throw new Error("HTTP "+r.status);return r.json()}).then(function(d){st(d&&d.chats?"Bridge is reachable.":"Bridge responded, but not cleanly.")}).catch(function(e){st("Bridge check failed: "+e.message)})}document.getElementById("check").onclick=function(){st("Checking...");setTimeout(check,0)};document.getElementById("save").onclick=function(){var d={bridgeUrl:u.value.trim(),bridgeToken:t.value.trim(),cannedReplies:c.value.trim()};location.href="pebblejs://close#"+encodeURIComponent(JSON.stringify(d))};<\/script></body></html>';
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html) +
    '#bridgeUrl=' + encodeURIComponent(bridgeUrl()) +
    '&bridgeToken=' + encodeURIComponent(bridgeToken()) +
    '&cannedReplies=' + encodeURIComponent(cannedReplies());
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
    IMAGE_CHUNK_SIZE = 500;
  } else if (info && info.platform === 'diorite') {
    IMAGE_SIZE = 96;
    IMAGE_COLORS = 4;
  }
}

// AppMessage delivery is serialized. Older phones can drop messages if image
// chunks and rows are pushed in parallel.
function sendToWatch(payload) {
  sendQueue.push(payload);
  flushQueue();
}

function flushQueue() {
  if (sending || sendQueue.length === 0) {
    return;
  }
  sending = true;
  Pebble.sendAppMessage(sendQueue[0], function() {
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

function clampText(value, maxLength) {
  value = String(value || '');
  if (value.length <= maxLength) {
    return value;
  }
  return value.substring(0, maxLength - 1);
}

function cacheKey(name) {
  return 'cache:' + bridgeUrl() + ':' + name;
}

function readJsonCache(name) {
  try {
    var value = localStorage.getItem(cacheKey(name));
    return value ? JSON.parse(value) : null;
  } catch (e) {
    return null;
  }
}

function writeJsonCache(name, value) {
  try {
    localStorage.setItem(cacheKey(name), JSON.stringify(value));
  } catch (e) {
    // Cache writes are best-effort; storage can be tiny on some phone runtimes.
  }
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

function xhrJson(method, url, body, callback) {
  var req = new XMLHttpRequest();
  req.open(method, url, true);
  req.timeout = REQUEST_TIMEOUT_MS;
  req.setRequestHeader('Content-Type', 'application/json');
  // Allows users to host the bridge behind an ngrok free tunnel.
  req.setRequestHeader('ngrok-skip-browser-warning', 'true');
  if (bridgeToken()) {
    req.setRequestHeader('Authorization', 'Bearer ' + bridgeToken());
  }
  req.onreadystatechange = function() {
    if (req.readyState !== 4) {
      return;
    }
    if (req.status === 0) {
      callback(new Error('Network error'), null);
      return;
    }
    if (req.status < 200 || req.status >= 300) {
      callback(new Error('HTTP ' + req.status), null);
      return;
    }
    try {
      callback(null, req.responseText ? JSON.parse(req.responseText) : {});
    } catch (e) {
      callback(e, null);
    }
  };
  req.onerror = function() {
    callback(new Error('Network error'), null);
  };
  req.ontimeout = function() {
    callback(new Error('Timeout'), null);
  };
  req.send(body ? JSON.stringify(body) : null);
}

function xhrBinary(method, url, callback) {
  var req = new XMLHttpRequest();
  req.open(method, url, true);
  req.timeout = REQUEST_TIMEOUT_MS;
  req.responseType = 'arraybuffer';
  // Allows users to host the bridge behind an ngrok free tunnel.
  req.setRequestHeader('ngrok-skip-browser-warning', 'true');
  if (bridgeToken()) {
    req.setRequestHeader('Authorization', 'Bearer ' + bridgeToken());
  }
  req.onreadystatechange = function() {
    if (req.readyState !== 4) {
      return;
    }
    if (req.status === 0) {
      callback(new Error('Network error'), null);
      return;
    }
    if (req.status < 200 || req.status >= 300) {
      callback(new Error('HTTP ' + req.status), null);
      return;
    }
    callback(null, req.response);
  };
  req.onerror = function() {
    callback(new Error('Network error'), null);
  };
  req.ontimeout = function() {
    callback(new Error('Timeout'), null);
  };
  req.send();
}

function mockChats() {
  return [
    {id: 'family', title: 'Family Group', preview: 'Jamie: My favorite painting.', unread: true},
    {id: 'house', title: 'House Chat', preview: 'Morgan: The plumber moved the appointment to 4:30.', unread: false},
    {id: 'workbench', title: 'Workbench Friends', preview: 'Sam: I pushed a cleaner build for the round screen.', unread: true},
    {id: 'bookclub', title: 'Book Club', preview: 'Nina: Chapter six finally made the whole thing click.', unread: false},
    {id: 'coffee', title: 'Coffee Tomorrow', preview: 'Priya: 8:15 still works if the train is on time.', unread: true}
  ];
}

function mockMessages(chatId) {
  if (chatId === 'house') {
    return [
      {id: 'h1', sender: 'Morgan', text: 'The plumber moved the appointment to 4:30, so I left the side gate unlocked.', outgoing: false},
      {id: 'h2', sender: 'You', text: 'Thanks. I will check the invoice when I get home.', outgoing: true},
      {id: 'h3', sender: 'Morgan', text: 'Also, the package is inside on the bench by the door.', outgoing: false}
    ];
  }
  return [
    {id: 'm1', sender: 'Alex', text: 'Museum day was a good call. The renovated wing is much easier to walk through now.', outgoing: false},
    {id: 'm2', sender: 'You', text: 'Agreed. I still want to go back when it is less crowded.', outgoing: true},
    {id: 'm3', sender: 'Jamie', text: 'My favorite painting.', outgoing: false, image_token: 'mock-photo'},
    {id: 'm4', sender: 'Alex', text: 'That one looked incredible in person. The colors are warmer than I expected.', outgoing: false}
  ];
}

function sendChatRows(chats) {
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
  messageCache[chatId] = messages.slice(Math.max(0, messages.length - MAX_MESSAGE_ROWS));
  writeJsonCache('messages:' + chatId, messageCache[chatId]);
}

function sendCachedMessages(chatId) {
  var cached = messageCache[chatId] || readJsonCache('messages:' + chatId);
  if (!cached || cached.length === 0) {
    return false;
  }
  messageCache[chatId] = cached;
  sendMessageRows(cached);
  done('messages_done', Math.min(cached.length, MAX_MESSAGE_ROWS));
  return true;
}

// Cached rows make the watch feel responsive; the bridge refresh that follows
// replaces them with fresh rows when the network catches up.
function getChats() {
  var cached = readJsonCache('chats');
  if (cached && cached.length) {
    sendChatRows(cached);
    done('chats_done', Math.min(cached.length, MAX_ROWS));
  } else {
    status('Loading chats...');
  }
  xhrJson('GET', bridgeUrl() + '/v1/chats?limit=' + MAX_ROWS, null, function(err, data) {
    if (err) {
      console.log('Bridge unavailable: ' + err.message);
      if (!cached || !cached.length) {
        error('Bridge unavailable');
      }
      return;
    }
    var chats = data.chats || [];
    writeJsonCache('chats', chats);
    sendChatRows(chats);
    done('chats_done', Math.min(chats.length, MAX_ROWS));
  });
}

function getMessages(chatId) {
  if (!sendCachedMessages(chatId)) {
    status('Loading messages...');
  }
  xhrJson('GET', bridgeUrl() + '/v1/chats/' + encodeURIComponent(chatId) + '/messages?limit=' + INITIAL_MESSAGE_ROWS, null,
    function(err, data) {
      if (err) {
        console.log('Bridge unavailable: ' + err.message);
        if (!messageCache[chatId] || !messageCache[chatId].length) {
          error('Messages failed: ' + err.message);
        }
        return;
      }
      var messages = data.messages || [];
      rememberMessages(chatId, messages);
      sendMessageRows(messages);
      done('messages_done', Math.min(messages.length, INITIAL_MESSAGE_ROWS));
    });
}

function getOlderMessages(chatId, beforeId) {
  if (!beforeId) {
    return;
  }
  status('Loading older...');
  xhrJson('GET', bridgeUrl() + '/v1/chats/' + encodeURIComponent(chatId) + '/messages?limit=' +
    OLDER_MESSAGE_ROWS + '&before_id=' + encodeURIComponent(beforeId), null,
    function(err, data) {
      if (err) {
        console.log('Older messages failed: ' + err.message);
        error('Older failed');
        return;
      }
      var older = data.messages || [];
      var current = messageCache[chatId] || [];
      var seen = {};
      var merged = [];
      older.concat(current).forEach(function(message) {
        if (!seen[message.id]) {
          seen[message.id] = true;
          merged.push(message);
        }
      });
      messageCache[chatId] = merged.slice(0, MAX_MESSAGE_ROWS);
      writeJsonCache('messages:' + chatId, messageCache[chatId]);
      sendMessageRows(messageCache[chatId]);
      done('messages_done', Math.min(messageCache[chatId].length, MAX_MESSAGE_ROWS));
    });
}

function sendMessage(chatId, text, replyTo) {
  xhrJson('POST', bridgeUrl() + '/v1/chats/' + encodeURIComponent(chatId) + '/send', {
    text: text,
    reply_to: replyTo || null
  }, function(err) {
    if (err) {
      error(err.message === 'HTTP 500' ? 'Send disabled' : 'Send failed');
      return;
    }
    var payload = {};
    payload[MessageKeys.Type] = 'sent';
    sendToWatch(payload);
  });
}

function deleteMessage(chatId, messageId) {
  xhrJson('POST', bridgeUrl() + '/v1/chats/' + encodeURIComponent(chatId) + '/delete', {
    message_id: messageId
  }, function(err) {
    if (err) {
      error('Delete failed');
      return;
    }
    var payload = {};
    payload[MessageKeys.Type] = 'deleted';
    sendToWatch(payload);
  });
}

function sendImage(chatId, messageId) {
  var url = bridgeUrl() + '/v1/chats/' + encodeURIComponent(chatId) + '/messages/' +
    encodeURIComponent(messageId) + '/image?size=' + IMAGE_SIZE + '&colors=' + IMAGE_COLORS;
  xhrBinary('GET', url, function(err, buffer) {
    if (err || !buffer) {
      var failed = {};
      failed[MessageKeys.Type] = 'image_error';
      failed[MessageKeys.MessageId] = String(messageId || '');
      sendToWatch(failed);
      return;
    }

    var bytes = new Uint8Array(buffer);
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
  });
}

Pebble.addEventListener('ready', function() {
  configureForPlatform();
  console.log('Pebblegram JS ready, bridge=' + bridgeUrl() + ', canned=' + cannedReplies());
  sendSettings();
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
    error('Bridge command failed');
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

  var nextBridgeUrl = normalizeBridgeUrl(data.bridgeUrl);
  if (nextBridgeUrl) {
    localStorage.setItem('bridgeUrl', nextBridgeUrl);
  }
  localStorage.setItem('bridgeToken', data.bridgeToken || '');
  if (data.cannedReplies) {
    localStorage.setItem('cannedReplies', data.cannedReplies);
  }
  sendSettings();
  status('Settings saved');
  getChats();
});
