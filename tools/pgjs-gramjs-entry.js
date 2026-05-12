var root = typeof globalThis !== 'undefined' ? globalThis : typeof global !== 'undefined' ? global : this;

if (!root.window) {
  root.window = root;
}
if (!root.window.location) {
  root.window.location = {protocol: 'https:'};
}
if (!root.window.addEventListener) {
  root.window.addEventListener = function() {};
}

var client = require('telegram/client/TelegramClient');
var stringSession = require('telegram/sessions/StringSession');

module.exports = {
  TelegramClient: client.TelegramClient,
  StringSession: stringSession.StringSession
};
