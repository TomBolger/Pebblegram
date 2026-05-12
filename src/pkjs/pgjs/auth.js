var cache = require('./cache');

var clientPromise = null;

function installResponseShim(root) {
  if (root.Response) {
    return;
  }
  root.Response = function(data) {
    this._data = data;
  };
  root.Response.prototype.arrayBuffer = function() {
    var data = this._data;
    if (data instanceof ArrayBuffer) {
      return Promise.resolve(data);
    }
    if (data && data.buffer instanceof ArrayBuffer) {
      return Promise.resolve(data.buffer.slice(data.byteOffset || 0, (data.byteOffset || 0) + data.byteLength));
    }
    if (typeof data === 'string') {
      var bytes = new Uint8Array(data.length);
      for (var i = 0; i < data.length; i += 1) {
        bytes[i] = data.charCodeAt(i) & 0xff;
      }
      return Promise.resolve(bytes.buffer);
    }
    return Promise.reject(new Error('Unsupported WebSocket payload type.'));
  };
}

function loadGramJs() {
  var root = typeof global !== 'undefined' ? global : this;
  installResponseShim(root);
  if (root.PebblegramGramJS) {
    return root.PebblegramGramJS;
  }
  var bundled = require('./gramjs.bundle');
  if (bundled && bundled.TelegramClient && bundled.StringSession) {
    return bundled;
  }
  throw new Error('PGJS GramJS bundle pending: add a PebbleKit-compatible GramJS bundle.');
}

function missingCredentials(creds) {
  if (!creds.apiId || !creds.apiHash || !creds.phone) {
    return 'Open settings: enter Telegram API ID, API hash, and phone.';
  }
  return '';
}

function authState() {
  var creds = cache.credentials();
  return {
    apiId: creds.apiId ? String(creds.apiId) : '',
    apiHash: creds.apiHash || '',
    phone: creds.phone || '',
    hasSession: !!creds.session,
    authStage: creds.authStage || ''
  };
}

function reset() {
  clientPromise = null;
  cache.clearSession();
}

function getClient() {
  if (clientPromise) {
    return clientPromise;
  }

  clientPromise = new Promise(function(resolve, reject) {
    var creds = cache.credentials();
    var missing = missingCredentials(creds);
    if (missing) {
      reject(new Error(missing));
      return;
    }

    var gram = loadGramJs();
    var session = new gram.StringSession(creds.session || '');
    var client = new gram.TelegramClient(session, creds.apiId, creds.apiHash, {
      connectionRetries: 3
    });

    client.start({
      phoneNumber: function() {
        return Promise.resolve(creds.phone);
      },
      phoneCode: function() {
        if (!creds.code) {
          cache.set('authStage', 'code');
          throw new Error('Open settings: enter the Telegram login code.');
        }
        return Promise.resolve(creds.code);
      },
      password: function() {
        if (!creds.password) {
          cache.set('authStage', 'password');
          throw new Error('Open settings: enter your Telegram cloud password.');
        }
        return Promise.resolve(creds.password);
      },
      onError: function(err) {
        console.log('PGJS login error: ' + (err && err.message ? err.message : err));
      }
    }).then(function() {
      cache.setSession(client.session.save());
      resolve(client);
    }).catch(function(err) {
      clientPromise = null;
      reject(err);
    });
  });

  return clientPromise;
}

module.exports = {
  authState: authState,
  getClient: getClient,
  reset: reset,
  saveSettings: cache.saveSettings
};
