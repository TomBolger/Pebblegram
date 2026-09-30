// GramJS reaches WebSockets only through this shim (esbuild aliases the
// "websocket" package here), so any PebbleKit JS compatibility handling lives
// here instead of replacing the global WebSocket.
//
// Replacing the global broke the iOS Core Devices app, which delivers socket
// events through the native constructor's static bookkeeping
// (WebSocket._instances). See issue #7 / PR #8.

function rootObject() {
  if (typeof globalThis !== 'undefined') {
    return globalThis;
  }
  if (typeof window !== 'undefined') {
    return window;
  }
  return global;
}

function nativeConstructor() {
  var root = rootObject();
  return root.__pebblegramNativeWebSocket || root.WebSocket || root.MozWebSocket;
}

// Wraps a native socket so events that fire before GramJS attaches its
// handlers are queued and replayed instead of lost.
function wrap(socket) {
  var listeners = {open: [], message: [], error: [], close: []};
  var handlers = {open: null, message: null, error: null, close: null};
  var pending = [];
  var wrapper = {};

  function hasListeners(kind) {
    return typeof handlers[kind] === 'function' || listeners[kind].length > 0;
  }

  function emit(kind, event) {
    var payload = event || {type: kind};
    var index;
    if (typeof handlers[kind] === 'function') {
      handlers[kind].call(wrapper, payload);
    }
    for (index = 0; index < listeners[kind].length; index += 1) {
      listeners[kind][index].call(wrapper, payload);
    }
  }

  function flush(kind) {
    var next = [];
    var index;
    var entry;
    for (index = 0; index < pending.length; index += 1) {
      entry = pending[index];
      if (entry.kind === kind && hasListeners(kind)) {
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
  wrapper.close = function(code, reason) {
    if (code === undefined) {
      return socket.close();
    }
    return socket.close(code, reason);
  };
  wrapper.addEventListener = function(kind, listener) {
    if (listeners[kind] && typeof listener === 'function') {
      listeners[kind].push(listener);
      flush(kind);
    }
  };
  wrapper.removeEventListener = function(kind, listener) {
    var index;
    if (!listeners[kind]) {
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
  Object.defineProperty(wrapper, 'url', {get: function() { return socket.url; }});
  Object.defineProperty(wrapper, 'binaryType', {
    get: function() { return socket.binaryType; },
    set: function(value) { socket.binaryType = value; }
  });
  ['open', 'message', 'error', 'close'].forEach(function(kind) {
    Object.defineProperty(wrapper, 'on' + kind, {
      get: function() { return handlers[kind]; },
      set: function(listener) {
        handlers[kind] = listener;
        flush(kind);
      }
    });
  });
  return wrapper;
}

function W3CWebSocket(uri, protocols) {
  var NativeWebSocket = nativeConstructor();
  var socket;
  if (!NativeWebSocket) {
    throw new Error('WebSocket is not available in PebbleKit JS.');
  }
  socket = protocols ? new NativeWebSocket(uri, protocols) : new NativeWebSocket(uri);
  return wrap(socket);
}

['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function(name, value) {
  W3CWebSocket[name] = value;
});

module.exports = {
  w3cwebsocket: W3CWebSocket,
  version: 'pebblekit'
};
