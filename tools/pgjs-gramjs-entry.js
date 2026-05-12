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

if (typeof root.WebSocket === 'function' && root.WebSocket.__pebblegramWrapped !== true) {
  (function() {
    var NativeWebSocket = root.WebSocket;

    function WebSocketWrapper(url, protocols) {
      var socket = protocols ? new NativeWebSocket(url, protocols) : new NativeWebSocket(url);
      var listeners = {open: [], message: [], error: [], close: []};
      var pending = [];
      var wrapper = {};

      function hasListeners(kind) {
        return typeof wrapper['on' + kind] === 'function' || listeners[kind].length > 0;
      }

      function emit(kind, event) {
        var handler = wrapper['on' + kind];
        var index;
        if (typeof handler === 'function') {
          handler.call(wrapper, event || {type: kind});
        }
        for (index = 0; index < listeners[kind].length; index += 1) {
          listeners[kind][index].call(wrapper, event || {type: kind});
        }
      }

      function flush(kind) {
        var next = [];
        var index;
        var entry;
        for (index = 0; index < pending.length; index += 1) {
          entry = pending[index];
          if ((!kind || entry.kind === kind) && hasListeners(entry.kind)) {
            emit(entry.kind, entry.event);
          } else {
            next.push(entry);
          }
        }
        pending = next;
      }

      function dispatch(kind, event) {
        if (!hasListeners(kind)) {
          pending.push({kind: kind, event: event});
          return;
        }
        emit(kind, event);
      }

      socket.onopen = function(event) { dispatch('open', event); };
      socket.onmessage = function(event) { dispatch('message', event); };
      socket.onerror = function(event) { dispatch('error', event); };
      socket.onclose = function(event) { dispatch('close', event); };

      wrapper.send = function(data) { return socket.send(data); };
      wrapper.close = function(code, reason) { return socket.close(code, reason); };
      wrapper.addEventListener = function(kind, listener) {
        if (listeners[kind] && typeof listener === 'function') {
          listeners[kind].push(listener);
          flush(kind);
        }
      };
      wrapper.removeEventListener = function(kind, listener) {
        var index;
        if (!listeners[kind] || typeof listener !== 'function') {
          return;
        }
        for (index = listeners[kind].length - 1; index >= 0; index -= 1) {
          if (listeners[kind][index] === listener) {
            listeners[kind].splice(index, 1);
          }
        }
      };
      Object.defineProperty(wrapper, 'readyState', {get: function() { return socket.readyState; }});
      Object.defineProperty(wrapper, 'bufferedAmount', {get: function() { return socket.bufferedAmount; }});
      Object.defineProperty(wrapper, 'binaryType', {
        get: function() { return socket.binaryType; },
        set: function(value) { socket.binaryType = value; }
      });
      ['open', 'message', 'error', 'close'].forEach(function(kind) {
        Object.defineProperty(wrapper, 'on' + kind, {
          get: function() { return wrapper['__on' + kind] || null; },
          set: function(listener) {
            wrapper['__on' + kind] = listener;
            flush(kind);
          }
        });
      });
      return wrapper;
    }

    ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function(name) {
      if (NativeWebSocket[name] !== undefined) {
        WebSocketWrapper[name] = NativeWebSocket[name];
      }
    });
    WebSocketWrapper.__pebblegramWrapped = true;
    root.WebSocket = WebSocketWrapper;
    root.window.WebSocket = WebSocketWrapper;
  })();
}

var client = require('telegram/client/TelegramClient');
var stringSession = require('telegram/sessions/StringSession');

module.exports = {
  TelegramClient: client.TelegramClient,
  StringSession: stringSession.StringSession,
  runtimeConfig: BUILTIN_CONFIG
};
