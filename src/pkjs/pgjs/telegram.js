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
  return !!messagePhoto(message);
}

function objectName(value) {
  return value && (value.className || value.classType || value.constructorName || (value.constructor && value.constructor.name) || '');
}

function messagePhoto(message) {
  var media = message && message.media;
  var webpage = media && (media.webpage || media.webPage);
  return (message && message.photo) || (media && media.photo) || (webpage && webpage.photo) || null;
}

function photoDimensions(message) {
  var photo = messagePhoto(message);
  var sizes = (photo && photo.sizes) || [];
  var best = null;
  var width = photo && (photo.w || photo.width);
  var height = photo && (photo.h || photo.height);
  for (var i = 0; i < sizes.length; i += 1) {
    var size = sizes[i];
    var sizeWidth = size && (size.w || size.width);
    var sizeHeight = size && (size.h || size.height);
    if (!sizeWidth || !sizeHeight) {
      continue;
    }
    if (!best || (sizeWidth * sizeHeight) > (best.width * best.height)) {
      best = {width: sizeWidth, height: sizeHeight};
    }
  }
  if (best) {
    return best;
  }
  if (width && height) {
    return {width: width, height: height};
  }
  return null;
}

function messageDocument(message) {
  var media = message && message.media;
  return (message && message.document) || (media && media.document) || null;
}

function attributeName(attribute) {
  return objectName(attribute);
}

function documentAttributes(document) {
  return (document && document.attributes) || [];
}

function documentFileName(document) {
  var attrs = documentAttributes(document);
  for (var i = 0; i < attrs.length; i += 1) {
    if ((attributeName(attrs[i]).indexOf('Filename') !== -1 || attrs[i].fileName) && attrs[i].fileName) {
      return attrs[i].fileName;
    }
  }
  return document && (document.fileName || document.name) || '';
}

function hasDocumentAttribute(document, name) {
  var attrs = documentAttributes(document);
  var propName = name.charAt(0).toLowerCase() + name.slice(1);
  for (var i = 0; i < attrs.length; i += 1) {
    if (attributeName(attrs[i]).indexOf(name) !== -1 || attrs[i][propName]) {
      return attrs[i];
    }
  }
  return null;
}

function documentDimensions(message) {
  var document = messageDocument(message);
  var attrs = documentAttributes(document);
  for (var i = 0; i < attrs.length; i += 1) {
    var attr = attrs[i];
    var width = attr && (attr.w || attr.width);
    var height = attr && (attr.h || attr.height);
    if (width && height) {
      return {width: width, height: height};
    }
  }
  return null;
}

function isPngBytes(bytes) {
  return bytes && bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

function isJpegBytes(bytes) {
  return bytes && bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function isPreviewImageBytes(bytes) {
  return isPngBytes(bytes) || isJpegBytes(bytes);
}

function isGif(message) {
  var document = messageDocument(message);
  var file = message && message.file;
  if (document) {
    return !!(hasDocumentAttribute(document, 'Animated') || document.mimeType === 'image/gif');
  }
  return !!(file && file.mimeType === 'image/gif');
}

function compactMediaLabel(label, detail) {
  return detail ? '[' + label + '] ' + detail : '[' + label + ']';
}

function mediaLabel(message) {
  var media = message && message.media;
  var mediaName = objectName(media);
  var document = messageDocument(message);
  var file = message && message.file;
  var fileName;
  var mimeType;
  var audioAttr;

  if (!message) {
    return '';
  }
  if (hasPhoto(message)) {
    return compactMediaLabel('photo');
  }
  if (media) {
    if (media.phoneNumber || media.firstName || media.lastName || mediaName.indexOf('Contact') !== -1) {
      return compactMediaLabel('Contact', [media.firstName, media.lastName].filter(Boolean).join(' ') || media.phoneNumber);
    }
    if (media.geo || media.venue || mediaName.indexOf('Geo') !== -1 || mediaName.indexOf('Venue') !== -1) {
      return compactMediaLabel('Location');
    }
    if (media.poll || mediaName.indexOf('Poll') !== -1) {
      return compactMediaLabel('Poll');
    }
    if (media.invoice || mediaName.indexOf('Invoice') !== -1) {
      return compactMediaLabel('Invoice');
    }
    if (media.game || mediaName.indexOf('Game') !== -1) {
      return compactMediaLabel('Game', media.game && media.game.title);
    }
    if (media.webpage || media.webPage || mediaName.indexOf('WebPage') !== -1) {
      var webpage = media.webpage || media.webPage || {};
      return compactMediaLabel('Link', webpage.title || webpage.url);
    }
  }
  if (!document) {
    if (file) {
      fileName = file.name || '';
      mimeType = file.mimeType || '';
      if (mimeType === 'image/gif') {
        return compactMediaLabel('GIF', fileName);
      }
      if (mimeType.indexOf('image/') === 0) {
        return compactMediaLabel('photo', fileName);
      }
      if (mimeType.indexOf('video/') === 0) {
        return compactMediaLabel('Video', fileName);
      }
      if (mimeType.indexOf('audio/') === 0) {
        return compactMediaLabel('Audio', fileName || file.title);
      }
      return compactMediaLabel('File', fileName);
    }
    return media ? compactMediaLabel('Media') : '';
  }

  fileName = documentFileName(document);
  mimeType = document.mimeType || '';
  audioAttr = hasDocumentAttribute(document, 'Audio');

  if (hasDocumentAttribute(document, 'Sticker')) {
    return compactMediaLabel('Sticker');
  }
  if (hasDocumentAttribute(document, 'Animated') || mimeType === 'image/gif') {
    return compactMediaLabel('GIF', fileName);
  }
  if (hasDocumentAttribute(document, 'Video') || mimeType.indexOf('video/') === 0) {
    return compactMediaLabel('Video', fileName);
  }
  if (audioAttr || mimeType.indexOf('audio/') === 0) {
    return compactMediaLabel(audioAttr && audioAttr.voice ? 'Voice' : 'Audio', fileName || (audioAttr && audioAttr.title));
  }
  return compactMediaLabel('File', fileName);
}

function displayMessageText(message) {
  var text = messageText(message);
  var label = mediaLabel(message);
  if (label && text) {
    return label + ' ' + text;
  }
  return text || label;
}

function displayChatMessageText(message) {
  if (hasPhoto(message)) {
    return messageText(message);
  }
  return displayMessageText(message);
}

function pushMediaPreviewCandidate(candidates, candidate) {
  if (!candidate) {
    return;
  }
  if (Array.isArray(candidate)) {
    for (var i = 0; i < candidate.length; i += 1) {
      pushMediaPreviewCandidate(candidates, candidate[i]);
    }
    return;
  }
  candidates.push(candidate);
}

function mediaPreviewArea(candidate) {
  var width = candidate && (candidate.w || candidate.width);
  var height = candidate && (candidate.h || candidate.height);
  return (width || 0) * (height || 0);
}

function mediaPreviewCandidates(message) {
  var media = message && message.media;
  var document = messageDocument(message);
  var extendedMedia = media && (media.extendedMedia || media.extended_media);
  var candidates = [];

  pushMediaPreviewCandidate(candidates, media && (media.videoCover || media.video_cover));
  pushMediaPreviewCandidate(candidates, extendedMedia && extendedMedia.thumb);
  pushMediaPreviewCandidate(candidates, document && document.thumbs);
  pushMediaPreviewCandidate(candidates, document && (document.videoThumbs || document.video_thumbs));

  candidates.sort(function(a, b) {
    return mediaPreviewArea(b) - mediaPreviewArea(a);
  });
  return candidates;
}

function previewThumbOption(candidate) {
  if (!candidate) {
    return null;
  }
  return candidate.type || candidate.size || candidate;
}

function looksLikePhoto(candidate) {
  var name = objectName(candidate);
  return !!(candidate && !candidate.type && (name.indexOf('Photo') !== -1 || candidate.sizes));
}

function downloadImageBytes(client, target, options) {
  return client.downloadMedia(target, options || {}).then(function(bytes) {
    if (isPreviewImageBytes(bytes)) {
      return bytes;
    }
    throw new Error('media preview was not an image');
  });
}

function downloadMediaPreviewCandidate(client, message, candidate) {
  var media = message && message.media;
  var option = previewThumbOption(candidate);
  var attempts = [];
  var target = 0;

  if (looksLikePhoto(candidate)) {
    attempts.push(function() {
      return downloadImageBytes(client, candidate, {});
    });
  }
  if (option) {
    attempts.push(function() {
      return downloadImageBytes(client, message, {thumb: option});
    });
    if (media) {
      attempts.push(function() {
        return downloadImageBytes(client, media, {thumb: option});
      });
    }
  }
  attempts.push(function() {
    return downloadImageBytes(client, message, {thumb: candidate});
  });
  if (media) {
    attempts.push(function() {
      return downloadImageBytes(client, media, {thumb: candidate});
    });
  }

  function tryNext() {
    if (target >= attempts.length) {
      throw new Error('no usable media preview candidate');
    }
    return attempts[target++]().catch(tryNext);
  }
  return tryNext();
}

function downloadGifPreview(client, message) {
  var candidates = mediaPreviewCandidates(message);
  var index = 0;

  function tryNext() {
    if (index >= candidates.length) {
      throw new Error('gif has no usable still preview');
    }
    return downloadMediaPreviewCandidate(client, message, candidates[index++]).catch(tryNext);
  }
  return tryNext();
}

function dialogUnreadMarked(dialog) {
  return !!(
    dialog.unreadMark ||
    dialog.unread_mark ||
    (dialog.dialog && (dialog.dialog.unreadMark || dialog.dialog.unread_mark))
  );
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
  var gif = isGif(message);
  var imageDimensions = photoDimensions(message) || (gif ? documentDimensions(message) : null);
  return {
    id: String(message.id),
    sender: senderName(message),
    text: displayChatMessageText(message),
    outgoing: !!message.out,
    image_token: (hasPhoto(message) || gif) ? String(message.id) : null,
    image_width: imageDimensions ? imageDimensions.width : 0,
    image_height: imageDimensions ? imageDimensions.height : 0
  };
}

function chats(limit) {
  return auth.getClient().then(function(client) {
    return client.getDialogs({limit: limit, folder: 0}).then(function(dialogs) {
      return dialogs.map(function(dialog) {
        var entity = dialog.entity || {};
        var id = entityId(entity);
        var preview = dialog.message ? displayMessageText(dialog.message) : '';
        return {
          id: id,
          title: displayName(entity),
          preview: preview,
          unread: !!(dialog.unreadCount || dialogUnreadMarked(dialog)),
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
        maxId: 2147483647,
        justClear: false,
        revoke: false
      }));
    });
  });
}

function downloadProfilePhoto(chatId) {
  return auth.getClient().then(function(client) {
    return client.getEntity(parseInt(chatId, 10) || chatId).then(function(entity) {
      return client.downloadProfilePhoto(entity, {isBig: false});
    });
  });
}

function downloadMedia(chatId, messageId) {
  return auth.getClient().then(function(client) {
    return client.getMessages(chatId, {ids: [parseInt(messageId, 10) || messageId]}).then(function(rows) {
      var message = rows && rows[0];
      var photo = messagePhoto(message);
      if (!message || (!hasPhoto(message) && !isGif(message))) {
        throw new Error('message has no previewable media');
      }
      if (isGif(message) && !photo) {
        return downloadGifPreview(client, message);
      }
      return downloadImageBytes(client, message, {}).catch(function() {
        return downloadImageBytes(client, photo || message.media, {});
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
  downloadProfilePhoto: downloadProfilePhoto,
  downloadMedia: downloadMedia
};
