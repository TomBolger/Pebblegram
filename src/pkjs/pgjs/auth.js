var cache = require('./cache');

var clientPromise = null;

function loadGramJs() {
  var root = typeof global !== 'undefined' ? global : this;
  if (root.PebblegramGramJS) {
    return root.PebblegramGramJS;
  }
  var bundled = require('./gramjs.bundle');
  if (bundled && bundled.TelegramClient && bundled.StringSession) {
    return bundled;
  }
  throw new Error('PGJS GramJS bundle pending: add a PebbleKit-compatible GramJS bundle.');
}

function runtimeConfig(gram, creds) {
  var embedded = gram.runtimeConfig || {};
  return {
    apiId: embedded.apiId || creds.apiId || 0,
    apiHash: embedded.apiHash || creds.apiHash || '',
    forceWSS: embedded.forceWSS === true,
    testServers: embedded.testServers === true
  };
}

function missingCredentials(config, creds) {
  if (!config.apiId || !config.apiHash) {
    return 'PGJS build missing Telegram API credentials.';
  }
  if (!creds.phone) {
    return 'Open settings: enter your phone number.';
  }
  return '';
}

function authState() {
  var creds = cache.credentials();
  return {
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
    var gram = loadGramJs();
    var config = runtimeConfig(gram, creds);
    var missing = missingCredentials(config, creds);
    if (missing) {
      reject(new Error(missing));
      return;
    }

    var session = new gram.StringSession(creds.session || '');
    var client = new gram.TelegramClient(session, config.apiId, config.apiHash, {
      connectionRetries: 3,
      requestRetries: 3,
      reconnectRetries: 0,
      useWSS: config.forceWSS === true,
      testServers: config.testServers === true,
      deviceModel: 'Pebblegram',
      systemVersion: 'Pebble PKJS',
      appVersion: 'PGJS',
      langCode: 'en',
      systemLangCode: 'en'
    });

    var requestedCode = false;
    var requestedPassword = false;

    client.start({
      phoneNumber: function() {
        return Promise.resolve(creds.phone);
      },
      phoneCode: function() {
        if (!creds.code) {
          requestedCode = true;
          cache.set('authStage', 'code');
          throw new Error('Open settings: enter the Telegram login code.');
        }
        return Promise.resolve(creds.code);
      },
      password: function() {
        if (!creds.password) {
          requestedPassword = true;
          cache.set('authStage', 'password');
          throw new Error('Open settings: enter your Telegram cloud password.');
        }
        return Promise.resolve(creds.password);
      },
      onError: function(err) {
        console.log('PGJS login error: ' + (err && err.message ? err.message : err));
        return true;
      }
    }).then(function() {
      cache.setSession(client.session.save());
      resolve(client);
    }).catch(function(err) {
      clientPromise = null;
      if (err && err.message === 'AUTH_USER_CANCEL' && requestedCode) {
        reject(new Error('Open settings: enter the Telegram login code.'));
        return;
      }
      if (err && err.message === 'AUTH_USER_CANCEL' && requestedPassword) {
        reject(new Error('Open settings: enter your Telegram cloud password.'));
        return;
      }
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
