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

module.exports = {
  randomBytes: randomBytes
};
