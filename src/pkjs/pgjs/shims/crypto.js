var sha1 = require('js-sha1');
var sha256 = require('js-sha256');

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
  this.algorithm = algorithm;
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

module.exports = {
  createHash: createHash,
  randomBytes: randomBytes
};
