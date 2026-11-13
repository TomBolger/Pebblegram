var auth = require('./auth');
var telegram = null;
var image = null;

function telegramApi() {
  if (!telegram) {
    telegram = require('./telegram');
  }
  return telegram;
}

function imageApi() {
  if (!image) {
    image = require('./image');
  }
  return image;
}

function create(options) {
  auth.setStatusHandler(options.status);
  auth.setQrHandler(options.qr);

  return {
    settingsPageUrl: function(baseUrl) {
      var state = auth.authState();
      return baseUrl +
        '?mode=pgjs' +
        '&apiId=' + encodeURIComponent(state.apiId || '') +
        '&hasApiHash=' + encodeURIComponent(state.hasApiHash ? '1' : '0') +
        '&phone=' + encodeURIComponent(state.phone) +
        '&hasSession=' + encodeURIComponent(state.hasSession ? '1' : '0') +
        '&authStage=' + encodeURIComponent(state.authStage || '') +
        '&loginMethod=' + encodeURIComponent(state.loginMethod || '') +
        '&cannedReplies=' + encodeURIComponent(options.cannedReplies());
    },
    hasSession: function() {
      return auth.authState().hasSession;
    },
    loginMethod: function() {
      return auth.authState().loginMethod;
    },
    applySettings: function(data) {
      if (data && data.mode === 'pgjs') {
        var state = auth.authState();
        var submittingCode = !!(data.code && String(data.code).trim());
        var submittingPassword = data.password !== undefined && String(data.password) !== '';
        var abandonQr = state.loginMethod === 'qr' && !state.hasSession &&
          data.loginMethod !== 'qr' && !submittingCode && !submittingPassword &&
          !!(data.phone && String(data.phone).trim());
        auth.saveSettings(data);
        if (data.resetSession || data.loginMethod === 'qr' || abandonQr) {
          auth.reset();
        }
      }
    },
    startQrLogin: function() {
      return auth.beginQrLogin();
    },
    ready: function() {
      return auth.getClient();
    },
    chats: function(limit, options) {
      return telegramApi().chats(limit, options);
    },
    messages: function(chatId, limit, beforeId) {
      return telegramApi().messages(chatId, limit, beforeId);
    },
    olderMessages: function(chatId, limit, beforeId) {
      return telegramApi().messages(chatId, limit, beforeId);
    },
    newerMessages: function(chatId, limit, afterId) {
      return telegramApi().newerMessages(chatId, limit, afterId);
    },
    keepalive: function() {
      return telegramApi().keepalive();
    },
    sendMessage: function(chatId, text, replyTo) {
      return telegramApi().sendMessage(chatId, text, replyTo);
    },
    getDraft: function(chatId) {
      return telegramApi().getDraft(chatId);
    },
    saveDraft: function(chatId, text, replyTo) {
      return telegramApi().saveDraft(chatId, text, replyTo);
    },
    editMessage: function(chatId, messageId, text) {
      return telegramApi().editMessage(chatId, messageId, text);
    },
    sendReaction: function(chatId, messageId, token) {
      return telegramApi().sendReaction(chatId, messageId, token);
    },
    message: function(chatId, messageId) {
      return telegramApi().message(chatId, messageId);
    },
    deleteMessage: function(chatId, messageId) {
      return telegramApi().deleteMessage(chatId, messageId);
    },
    markRead: function(chatId) {
      return telegramApi().markRead(chatId);
    },
    archiveChat: function(chatId) {
      return telegramApi().archiveChat(chatId);
    },
    deleteChat: function(chatId) {
      return telegramApi().deleteChat(chatId);
    },
    muteChat: function(chatId) {
      return telegramApi().muteChat(chatId);
    },
    markUnread: function(chatId) {
      return telegramApi().markUnread(chatId);
    },
    imageBytes: function(chatId, messageId, request, status) {
      return imageApi().imageBytes(chatId, messageId, request, status);
    },
    packBits: function(bytes) {
      return imageApi().packBits(bytes);
    },
    avatarBytes: function(chatId, size, blackAndWhite) {
      return imageApi().avatarBytes(chatId, size, blackAndWhite);
    },
    cancelImageRequests: function() {
      if (image) {
        image.cancelImageRequests();
      }
    }
  };
}

module.exports = {
  create: create
};
