var sha1 = require('js-sha1');
var sha256 = require('js-sha256');
var sha512 = require('../vendor/js-sha512');

function randomBytes(count) {
  var bytes = new Uint8Array(count);
  var cryptoObject = (typeof self !== 'undefined' && self.crypto) ||
                     (typeof window !== 'undefined' && window.crypto) ||
                     (typeof global !== 'undefined' && global.crypto);
  if (!cryptoObject || !cryptoObject.getRandomValues) {
    throw new Error('Secure random source unavailable');
  }
  cryptoObject.getRandomValues(bytes);
  return bytes;
}

function Hash(algorithm) {
  this.algorithm = normalizeAlgorithm(algorithm);
  this.parts = [];
}

Hash.prototype.update = function(data) {
  this.parts.push(data);
  return this;
};

Hash.prototype.digest = function(encoding) {
  var Buffer = require('buffer').Buffer;
  var input = Buffer.concat(this.parts.map(function(part) {
    return Buffer.from(part);
  }));
  var bytes;

  if (this.algorithm === 'sha1') {
    bytes = sha1.array(input);
  } else if (this.algorithm === 'sha256') {
    bytes = sha256.array(input);
  } else if (this.algorithm === 'sha512') {
    bytes = sha512.array(input);
  } else {
    throw new Error('Unsupported hash algorithm: ' + this.algorithm);
  }

  if (encoding === 'hex') {
    return bytes.map(function(byte) {
      return ('0' + byte.toString(16)).slice(-2);
    }).join('');
  }
  return Buffer.from(bytes);
};

function createHash(algorithm) {
  return new Hash(algorithm);
}

function normalizeAlgorithm(algorithm) {
  return String(algorithm || '').toLowerCase().replace(/-/g, '');
}

function toBuffer(value) {
  var Buffer = require('buffer').Buffer;
  if (Buffer.isBuffer(value)) {
    return value;
  }
  return Buffer.from(value);
}

function int32Buffer(value) {
  var Buffer = require('buffer').Buffer;
  var bytes = Buffer.alloc(4);
  bytes[0] = (value >>> 24) & 255;
  bytes[1] = (value >>> 16) & 255;
  bytes[2] = (value >>> 8) & 255;
  bytes[3] = value & 255;
  return bytes;
}

function hmac(algorithm, key, data) {
  if (algorithm === 'sha512') {
    return sha512.sha512.hmac.array(key, data);
  }
  if (algorithm === 'sha256') {
    return sha256.sha256.hmac.array(key, data);
  }
  if (algorithm === 'sha1') {
    return sha1.sha1.hmac.array(key, data);
  }
  throw new Error('Unsupported PBKDF2 digest: ' + algorithm);
}

function pbkdf2Sync(password, salt, iterations, keyLength, digest) {
  var Buffer = require('buffer').Buffer;
  var algorithm = normalizeAlgorithm(digest || 'sha1');
  var blockLength = algorithm === 'sha512' ? 64 : algorithm === 'sha256' ? 32 : 20;
  var blocks = Math.ceil(keyLength / blockLength);
  var output = Buffer.alloc(blocks * blockLength);
  var passwordBytes = toBuffer(password);
  var saltBytes = toBuffer(salt);
  var block;
  var u;
  var blockIndex;
  var round;
  var offset;
  var i;

  if (!iterations || iterations < 1) {
    throw new Error('PBKDF2 iterations must be positive.');
  }

  for (blockIndex = 1; blockIndex <= blocks; blockIndex += 1) {
    u = hmac(algorithm, passwordBytes, Buffer.concat([saltBytes, int32Buffer(blockIndex)]));
    block = Buffer.from(u);
    for (round = 1; round < iterations; round += 1) {
      u = hmac(algorithm, passwordBytes, Buffer.from(u));
      for (i = 0; i < blockLength; i += 1) {
        block[i] ^= u[i];
      }
    }
    offset = (blockIndex - 1) * blockLength;
    block.copy(output, offset);
  }

  return output.slice(0, keyLength);
}

module.exports = {
  createHash: createHash,
  pbkdf2Sync: pbkdf2Sync,
  randomBytes: randomBytes
};
