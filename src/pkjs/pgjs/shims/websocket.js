function W3CWebSocket(uri, protocols) {
  var root = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : global;
  var NativeWebSocket = root.WebSocket || root.MozWebSocket;
  if (!NativeWebSocket) {
    throw new Error('WebSocket is not available in PebbleKit JS.');
  }
  return protocols ? new NativeWebSocket(uri, protocols) : new NativeWebSocket(uri);
}

module.exports = {
  w3cwebsocket: W3CWebSocket,
  version: 'pebblekit'
};
