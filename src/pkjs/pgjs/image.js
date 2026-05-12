var telegram = require('./telegram');

function toUint8Array(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value.buffer) {
    return new Uint8Array(value.buffer);
  }
  if (typeof ArrayBuffer !== 'undefined' && value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return null;
}

function isPng(bytes) {
  return bytes && bytes.length > 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
}

function imageBytes(chatId, messageId) {
  return telegram.downloadMedia(chatId, messageId).then(function(raw) {
    var bytes = toUint8Array(raw);
    if (!bytes || !bytes.length) {
      throw new Error('empty image');
    }
    if (!isPng(bytes)) {
      throw new Error('PGJS image conversion pending: Telegram returned non-PNG media.');
    }
    return bytes;
  });
}

module.exports = {
  imageBytes: imageBytes
};
