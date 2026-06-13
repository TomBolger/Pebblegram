var root = typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : this;
var buffer = require('buffer');
var BUILTIN_CONFIG = __PGJS_BUILTIN_CONFIG__;

if (!root.self) {
  root.self = root;
}
if (!root.window) {
  root.window = root;
}
if (!root.window.location) {
  root.window.location = {protocol: 'http:'};
}
if (!root.window.addEventListener) {
  root.window.addEventListener = function() {};
}
if (!root.window.removeEventListener) {
  root.window.removeEventListener = function() {};
}
if (!root.navigator) {
  root.navigator = {
    onLine: true,
    userAgent: 'Pebblegram PKJS'
  };
}
if (!root.window.navigator) {
  root.window.navigator = root.navigator;
}
if (!root.Buffer) {
  root.Buffer = buffer.Buffer;
}
if (!root.window.Buffer) {
  root.window.Buffer = root.Buffer;
}
if (!root.crypto) {
  root.crypto = {};
}
if (!root.crypto.getRandomValues) {
  root.crypto.getRandomValues = function(values) {
    var index;
    for (index = 0; index < values.length; index += 1) {
      values[index] = Math.floor(Math.random() * 256);
    }
    return values;
  };
}
if (!root.window.crypto) {
  root.window.crypto = root.crypto;
}
if (!root.Response) {
  root.Response = function(body) {
    this._body = body;
  };
  root.Response.prototype.arrayBuffer = function() {
    var body = this._body;
    var view;
    var bytes;
    var index;

    if (body === undefined || body === null) {
      return Promise.resolve(new ArrayBuffer(0));
    }
    if (body instanceof ArrayBuffer || String(body) === '[object ArrayBuffer]') {
      return Promise.resolve(body);
    }
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(body)) {
      view = new Uint8Array(body.buffer, body.byteOffset || 0, body.byteLength || body.length || 0);
      return Promise.resolve(view.slice().buffer);
    }
    if (typeof body.length === 'number') {
      bytes = new Uint8Array(body.length);
      for (index = 0; index < body.length; index += 1) {
        bytes[index] = body[index] & 255;
      }
      return Promise.resolve(bytes.buffer);
    }
    return Promise.resolve(new ArrayBuffer(0));
  };
}
if (!root.window.Response) {
  root.window.Response = root.Response;
}

// Preserve a handle to the unwrapped native WebSocket.
// The WebSocket shim (src/pkjs/pgjs/shims/websocket.js) connects through this
// handle directly when present, bypassing any accidental wrapper on the global
// WebSocket symbol. Use Native WebSocket whenever possible.
// This is critical for PKJS on iPhone, old WebSocketWrapper hangs any WebSocket connection attempt.
if (typeof root.WebSocket === 'function' && !root.__pebblegramNativeWebSocket) {
  root.__pebblegramNativeWebSocket = root.WebSocket;
}

var client = require('telegram/client/TelegramClient');
var stringSession = require('telegram/sessions/StringSession');
var telegram = require('telegram');

module.exports = {
  Api: telegram.Api,
  TelegramClient: client.TelegramClient,
  StringSession: stringSession.StringSession,
  runtimeConfig: BUILTIN_CONFIG
};
