var cache = require('./cache');

var clientPromise = null;
var AUTH_TIMEOUT_MS = 30000;
var CODE_TIMEOUT_MS = 90000;
var AUTH_DC = {
  id: 1,
  host: 'pluto.web.telegram.org'
};
var statusHandler = function() {};

function setStatusHandler(handler) {
  statusHandler = typeof handler === 'function' ? handler : function() {};
}

function reportStatus(message) {
  statusHandler(message);
}

function loadGramJs() {
  var root = typeof global !== 'undefined' ? global : this;
  if (root.PebblegramGramJS) {
    return root.PebblegramGramJS;
  }
  var bundled = require('./gramjs.bundle');
  if (bundled && bundled.TelegramClient && bundled.StringSession) {
    return bundled;
  }
  throw new Error('Telegram engine is not available.');
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
    return 'Build missing Telegram API credentials.';
  }
  if (!creds.phone) {
    return 'Enter phone in settings.';
  }
  return '';
}

function telegramErrorCode(err) {
  var text = err && (err.errorMessage || err.message) ? (err.errorMessage || err.message) : String(err || '');
  var match = text.match(/[A-Z][A-Z0-9_]+/g);
  return match && match.length ? match[match.length - 1] : text;
}

function authErrorMessage(err) {
  var code = telegramErrorCode(err);
  if (code === 'PHONE_CODE_INVALID') {
    return 'Bad code. Save phone again.';
  }
  if (code === 'PHONE_CODE_EXPIRED') {
    return 'Code expired. Save phone.';
  }
  if (code === 'PHONE_CODE_EMPTY') {
    return 'Enter Telegram code.';
  }
  if (code === 'PHONE_CODE_HASH_EMPTY' || code === 'PHONE_CODE_HASH_INVALID') {
    return 'Code stale. Save phone.';
  }
  if (code === 'PHONE_NUMBER_INVALID') {
    return 'Bad phone number.';
  }
  if (code.indexOf('FLOOD_WAIT') === 0) {
    return 'Rate limited. Wait.';
  }
  return err && err.message ? err.message : String(err || 'Telegram auth failed.');
}

function shouldClearCodeRequest(err) {
  var code = telegramErrorCode(err);
  return code === 'PHONE_CODE_INVALID' ||
         code === 'PHONE_CODE_EXPIRED' ||
         code === 'PHONE_CODE_HASH_EMPTY' ||
         code === 'PHONE_CODE_HASH_INVALID';
}

function timeout(promise, message, timeoutMs) {
  var timer = null;
  var duration = timeoutMs || AUTH_TIMEOUT_MS;
  var timeoutPromise = new Promise(function(resolve, reject) {
    timer = setTimeout(function() {
      reject(new Error(message));
    }, duration);
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
    appVersion: 'Pebblegram',
    langCode: 'en',
    systemLangCode: 'en'
  });
}

function pinAuthDc(client, config) {
  if (client && client.session && typeof client.session.setDC === 'function') {
    client.session.setDC(AUTH_DC.id, AUTH_DC.host, config.forceWSS === true ? 443 : 80);
  }
}

function requestCode(gram, config, creds) {
  var client = createClient(gram, config, '');
  pinAuthDc(client, config);
  return timeout(
    Promise.resolve().then(function() {
      reportStatus('Connecting...');
      return client.connect();
    }).then(function() {
      reportStatus('Sending code...');
      return client.invoke(new gram.Api.auth.SendCode({
        phoneNumber: creds.phone,
        apiId: config.apiId,
        apiHash: config.apiHash,
        settings: new gram.Api.CodeSettings({})
      }));
    }).then(function(result) {
      if (!result || typeof result.phoneCodeHash !== 'string') {
        if (result && result.className === 'auth.SentCodeSuccess') {
          throw new Error('Telegram reports this session is already authorized.');
        }
        throw new Error('Telegram did not return a login code hash.');
      }
      reportStatus('Code requested.');
      cache.setPhoneCodeRequest(result.phoneCodeHash, client.session.save());
      cache.clearCode();
      return closeClient(client);
    }).then(function(value) {
      throw new Error('Enter Telegram code.');
    }, function(err) {
      return closeClient(client).then(function() {
        throw err;
      });
    }),
    'Telegram code request timed out.',
    CODE_TIMEOUT_MS
  );
}

function signInWithCode(gram, config, creds) {
  var client = createClient(gram, config, creds.pendingSession || '');
  pinAuthDc(client, config);
  return timeout(
    Promise.resolve().then(function() {
      reportStatus('Connecting...');
      return client.connect();
    }).then(function() {
      if (!creds.phoneCodeHash) {
        throw new Error('Save phone for new code.');
      }
      if (!creds.pendingSession) {
        cache.clearCodeRequest();
        throw new Error('Code stale. Save phone.');
      }
      reportStatus('Signing in...');
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
        cache.clearCodeRequest();
        throw new Error('Two-step verification is not supported yet.');
      }
      if (shouldClearCodeRequest(err)) {
        cache.clearCodeRequest();
      }
      throw new Error(authErrorMessage(err));
    }),
    'Telegram sign-in timed out.'
  );
}

function authState() {
  var creds = cache.credentials();
  return {
    apiId: creds.apiId || '',
    hasApiHash: !!creds.apiHash,
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
    timeout(Promise.resolve().then(function() {
      reportStatus('Connecting...');
      return client.connect();
    }).then(function() {
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
  setStatusHandler: setStatusHandler,
  saveSettings: cache.saveSettings
};
