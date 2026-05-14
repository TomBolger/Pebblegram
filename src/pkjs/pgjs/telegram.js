var auth = require('./auth');
var gram = require('./gramjs.bundle');

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
  return !!(message && message.photo);
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
    return client.getDialogs({limit: limit, folder: 0}).then(function(dialogs) {
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
          unread: !!dialog.unreadCount,
          unread_count: dialog.unreadCount || 0
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

function editMessage(chatId, messageId, text) {
  return auth.getClient().then(function(client) {
    return client.editMessage(chatId, {
      message: parseInt(messageId, 10) || messageId,
      text: text
    });
  });
}

function markRead(chatId) {
  return auth.getClient().then(function(client) {
    return client.markAsRead(chatId);
  });
}

function inputPeer(client, chatId) {
  return client.getInputEntity(parseInt(chatId, 10) || chatId);
}

function archiveChat(chatId) {
  return auth.getClient().then(function(client) {
    return inputPeer(client, chatId).then(function(peer) {
      return client.invoke(new gram.Api.folders.EditPeerFolders({
        folderPeers: [new gram.Api.InputFolderPeer({peer: peer, folderId: 1})]
      }));
    });
  });
}

function markUnread(chatId) {
  return auth.getClient().then(function(client) {
    return inputPeer(client, chatId).then(function(peer) {
      return client.invoke(new gram.Api.messages.MarkDialogUnread({
        peer: new gram.Api.InputDialogPeer({peer: peer}),
        unread: true
      }));
    });
  });
}

function muteChat(chatId) {
  return auth.getClient().then(function(client) {
    return inputPeer(client, chatId).then(function(peer) {
      return client.invoke(new gram.Api.account.UpdateNotifySettings({
        peer: new gram.Api.InputNotifyPeer({peer: peer}),
        settings: new gram.Api.InputPeerNotifySettings({muteUntil: 2147483647})
      }));
    });
  });
}

function deleteChat(chatId) {
  return auth.getClient().then(function(client) {
    return inputPeer(client, chatId).then(function(peer) {
      return client.invoke(new gram.Api.messages.DeleteHistory({
        peer: peer,
        maxId: 0,
        revoke: false
      }));
    });
  });
}

function downloadMedia(chatId, messageId) {
  return auth.getClient().then(function(client) {
    return client.getMessages(chatId, {ids: [parseInt(messageId, 10) || messageId]}).then(function(rows) {
      var message = rows && rows[0];
      if (!message || !hasPhoto(message)) {
        throw new Error('message has no photo');
      }
      return client.downloadMedia(message, {}).then(function(bytes) {
        if (bytes && bytes.length) {
          return bytes;
        }
        return client.downloadMedia(message.media, {});
      });
    });
  });
}

module.exports = {
  chats: chats,
  messages: messages,
  sendMessage: sendMessage,
  editMessage: editMessage,
  deleteMessage: deleteMessage,
  markRead: markRead,
  archiveChat: archiveChat,
  deleteChat: deleteChat,
  muteChat: muteChat,
  markUnread: markUnread,
  downloadMedia: downloadMedia
};
