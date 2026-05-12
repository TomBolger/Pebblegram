var cache = require('./cache');

var clientPromise = null;
var AUTH_TIMEOUT_MS = 30000;

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

function timeout(promise, message) {
  var timer = null;
  var timeoutPromise = new Promise(function(resolve, reject) {
    timer = setTimeout(function() {
      reject(new Error(message));
    }, AUTH_TIMEOUT_MS);
  });
  return Promise.race([promise, timeoutPromise]).then(function(value) {
    clearTimeout(timer);
    return value;
  }, function(err) {
    clearTimeout(timer);
    throw err;
  });
}

function closeClient(client) {
  if (client && typeof client.disconnect === 'function') {
    return client.disconnect().catch(function() {});
  }
  return Promise.resolve();
}

function createClient(gram, config, sessionString) {
  return new gram.TelegramClient(new gram.StringSession(sessionString || ''), config.apiId, config.apiHash, {
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
}

function requestCode(gram, config, creds) {
  var client = createClient(gram, config, '');
  return timeout(
    client.connect().then(function() {
      return client.sendCode({
        apiId: config.apiId,
        apiHash: config.apiHash
      }, creds.phone, false);
    }).then(function(result) {
      if (!result || typeof result.phoneCodeHash !== 'string') {
        throw new Error('Telegram did not return a login code hash.');
      }
      cache.setPhoneCodeHash(result.phoneCodeHash);
      cache.clearCode();
      return closeClient(client);
    }).then(function(value) {
      throw new Error('Open settings: enter the Telegram login code.');
    }, function(err) {
      return closeClient(client).then(function() {
        throw err;
      });
    }),
    'Telegram code request timed out.'
  );
}

function signInWithCode(gram, config, creds) {
  var client = createClient(gram, config, '');
  return timeout(
    client.connect().then(function() {
      if (!creds.phoneCodeHash) {
        throw new Error('Open settings: save your phone number again to request a new code.');
      }
      return client.invoke(new gram.Api.auth.SignIn({
        phoneNumber: creds.phone,
        phoneCodeHash: creds.phoneCodeHash,
        phoneCode: creds.code
      }));
    }).then(function() {
      cache.setSession(client.session.save());
      return client;
    }).catch(function(err) {
      if (err && err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        if (creds.password) {
          return client.signInWithPassword({
            apiId: config.apiId,
            apiHash: config.apiHash
          }, {
            password: function() {
              return Promise.resolve(creds.password);
            },
            onError: function(passwordErr) {
              throw passwordErr;
            }
          }).then(function() {
            cache.setSession(client.session.save());
            return client;
          });
        }
        cache.set('authStage', 'password');
        throw new Error('Open settings: enter your Telegram cloud password.');
      }
      throw err;
    }),
    'Telegram sign-in timed out.'
  );
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

    if (!creds.session && !creds.code) {
      requestCode(gram, config, creds).then(resolve).catch(function(err) {
        clientPromise = null;
        reject(err);
      });
      return;
    }

    if (!creds.session && creds.code) {
      signInWithCode(gram, config, creds).then(resolve).catch(function(err) {
        clientPromise = null;
        reject(err);
      });
      return;
    }

    var client = createClient(gram, config, creds.session);
    timeout(client.connect().then(function() {
      resolve(client);
    }), 'Telegram connect timed out.').catch(function(err) {
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
