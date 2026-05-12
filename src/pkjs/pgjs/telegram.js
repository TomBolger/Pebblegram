var auth = require('./auth');

function entityId(entity) {
  if (!entity) {
    return '';
  }
  if (entity.id !== undefined && entity.id !== null) {
    return String(entity.id);
  }
  return String(entity.peerId || '');
}

function displayName(entity) {
  if (!entity) {
    return 'Untitled';
  }
  if (entity.title) {
    return entity.title;
  }
  var parts = [];
  if (entity.firstName) {
    parts.push(entity.firstName);
  }
  if (entity.lastName) {
    parts.push(entity.lastName);
  }
  return parts.join(' ') || entity.username || 'Untitled';
}

function messageText(message) {
  if (!message) {
    return '';
  }
  return message.message || message.text || '';
}

function hasPhoto(message) {
  return !!(message && (message.photo || message.media));
}

function senderName(message) {
  if (message.out) {
    return 'You';
  }
  if (message.sender && message.sender.firstName) {
    return message.sender.firstName;
  }
  if (message.sender && message.sender.title) {
    return message.sender.title;
  }
  return '';
}

function normalizeMessage(message) {
  return {
    id: String(message.id),
    sender: senderName(message),
    text: messageText(message),
    outgoing: !!message.out,
    image_token: hasPhoto(message) ? String(message.id) : null
  };
}

function chats(limit) {
  return auth.getClient().then(function(client) {
    return client.getDialogs({limit: limit}).then(function(dialogs) {
      return dialogs.map(function(dialog) {
        var entity = dialog.entity || {};
        var preview = dialog.message ? messageText(dialog.message) : '';
        if (!preview && dialog.message && hasPhoto(dialog.message)) {
          preview = '[photo]';
        }
        return {
          id: entityId(entity),
          title: displayName(entity),
          preview: preview,
          unread: !!dialog.unreadCount
        };
      });
    });
  });
}

function messages(chatId, limit, beforeId) {
  return auth.getClient().then(function(client) {
    var options = {limit: limit};
    if (beforeId) {
      options.offsetId = parseInt(beforeId, 10) || 0;
    }
    return client.getMessages(chatId, options).then(function(rows) {
      return rows.slice().reverse().map(normalizeMessage);
    });
  });
}

function sendMessage(chatId, text, replyTo) {
  return auth.getClient().then(function(client) {
    var options = {message: text};
    if (replyTo) {
      options.replyTo = parseInt(replyTo, 10) || replyTo;
    }
    return client.sendMessage(chatId, options);
  });
}

function deleteMessage(chatId, messageId) {
  return auth.getClient().then(function(client) {
    return client.deleteMessages(chatId, [parseInt(messageId, 10) || messageId], {revoke: true});
  });
}

function downloadMedia(chatId, messageId) {
  return auth.getClient().then(function(client) {
    return client.getMessages(chatId, {ids: [parseInt(messageId, 10) || messageId]}).then(function(rows) {
      var message = rows && rows[0];
      if (!message || !hasPhoto(message)) {
        throw new Error('message has no photo');
      }
      return client.downloadMedia(message, {workers: 1});
    });
  });
}

module.exports = {
  chats: chats,
  messages: messages,
  sendMessage: sendMessage,
  deleteMessage: deleteMessage,
  downloadMedia: downloadMedia
};
