function value(text) {
  return function() {
    return text;
  };
}

module.exports = {
  arch: value('pebblekit'),
  cpus: function() {
    return [];
  },
  endianness: value('LE'),
  freemem: function() {
    return 0;
  },
  hostname: value('pebblekit'),
  platform: value('browser'),
  release: value('1.0'),
  tmpdir: value('/tmp'),
  totalmem: function() {
    return 0;
  },
  type: value('PebbleKitJS')
};
