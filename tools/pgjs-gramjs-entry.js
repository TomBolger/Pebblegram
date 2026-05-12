var client = require('telegram/client/TelegramClient');
var stringSession = require('telegram/sessions/StringSession');

module.exports = {
  TelegramClient: client.TelegramClient,
  StringSession: stringSession.StringSession
};
