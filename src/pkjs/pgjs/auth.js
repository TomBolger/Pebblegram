var cache = require('./cache');

var clientPromise = null;
var currentClient = null;
var AUTH_TIMEOUT_MS = 30000;
var CODE_TIMEOUT_MS = 90000;
var CODE_REQUEST_MIN_INTERVAL_MS = 5 * 60 * 1000;
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
    forceWSS: embedded.forceWSS !== false,
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
  var waitMatch;
  if (isAuthKeyDuplicated(err)) {
    return 'Telegram invalidated this login because another Pebblegram copy was already using it. Open Pebblegram settings and sign in again.';
  }
  if (code === 'AUTH_KEY_UNREGISTERED' || code === 'SESSION_REVOKED') {
    return 'Telegram session expired. Open Pebblegram settings and sign in again.';
  }
  if (code === 'PHONE_CODE_INVALID') {
    return 'Bad login code. Open Pebblegram settings on your phone, enter the new Telegram code, then tap Save.';
  }
  if (code === 'PHONE_CODE_EXPIRED') {
    return 'Code expired. Open Pebblegram settings, save your phone number again, then enter the new Telegram code.';
  }
  if (code === 'PHONE_CODE_EMPTY') {
    return 'Open Pebblegram settings on your phone, enter the Telegram login code, then tap Save.';
  }
  if (code === 'PHONE_CODE_HASH_EMPTY' || code === 'PHONE_CODE_HASH_INVALID') {
    return 'Code stale. Open settings, save your phone number again, then enter the new Telegram code.';
  }
  if (code === 'PHONE_NUMBER_INVALID') {
    return 'Telegram rejected that phone number. Use international format with a plus sign, such as +15551234567.';
  }
  if (code === 'PHONE_NUMBER_BANNED') {
    return 'Telegram reports this phone number is banned.';
  }
  if (code === 'API_ID_INVALID' || code === 'API_ID_PUBLISHED_FLOOD') {
    return 'Telegram rejected the API ID/hash. Re-check them at my.telegram.org/apps, then use Reset in settings.';
  }
  if (code === 'PASSWORD_HASH_INVALID') {
    return 'Wrong two-step password. Open Pebblegram settings, enter your Telegram cloud password, then tap Save.';
  }
  if (/Maximum reconnection retries/i.test(String(err && err.message || ''))) {
    return 'Could not reach Telegram. Check your phone\'s internet connection, then open Pebblegram again.';
  }
  if (code.indexOf('FLOOD_WAIT') === 0) {
    waitMatch = code.match(/FLOOD_WAIT_?(\d+)/);
    return waitMatch ? 'Telegram rate limited login. Wait ' + waitMatch[1] + ' seconds.' : 'Telegram rate limited login. Wait before retrying.';
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

function isAuthKeyDuplicated(err) {
  var text = err && (err.errorMessage || err.message) ? (err.errorMessage || err.message) : String(err || '');
  return telegramErrorCode(err) === 'AUTH_KEY_DUPLICATED' || text.indexOf('AUTH_KEY_DUPLICATED') !== -1;
}

function isFatalSessionError(err) {
  var code = telegramErrorCode(err);
  return isAuthKeyDuplicated(err) ||
         code === 'AUTH_KEY_UNREGISTERED' ||
         code === 'SESSION_REVOKED' ||
         code === 'USER_DEACTIVATED' ||
         code === 'USER_DEACTIVATED_BAN';
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
  if (client && client === currentClient) {
    currentClient = null;
  }
  if (client && typeof client.disconnect === 'function') {
    try {
      return Promise.resolve(client.disconnect()).catch(function() {});
    } catch (err) {
      return Promise.resolve();
    }
  }
  return Promise.resolve();
}

function discardClient(client, clearSession) {
  clientPromise = null;
  if (clearSession) {
    cache.clearSession();
  }
  return closeClient(client);
}

function ensureConnected(client) {
  if (!client || typeof client.connect !== 'function') {
    return Promise.resolve(client);
  }
  if (client.connected === false) {
    reportStatus('Reconnecting...');
    return timeout(Promise.resolve(client.connect()).then(function() {
      return client;
    }), 'Telegram reconnect timed out.', 15000).catch(function(err) {
      return discardClient(client, isFatalSessionError(err)).then(function() {
        throw new Error(authErrorMessage(err));
      });
    });
  }
  return Promise.resolve(client);
}

function createClient(gram, config, sessionString) {
  return new gram.TelegramClient(new gram.StringSession(sessionString || ''), config.apiId, config.apiHash, {
    connectionRetries: 5,
    requestRetries: 2,
    reconnectRetries: 8,
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

function codeDestination(result) {
  var type = result && result.type ? result.type.className : '';
  if (type === 'auth.SentCodeTypeApp') {
    return 'to your other Telegram app (check the "Telegram" chat)';
  }
  if (type === 'auth.SentCodeTypeSms' || type === 'auth.SentCodeTypeSmsWord' ||
      type === 'auth.SentCodeTypeSmsPhrase') {
    return 'by SMS';
  }
  if (type === 'auth.SentCodeTypeCall' || type === 'auth.SentCodeTypeFlashCall' ||
      type === 'auth.SentCodeTypeMissedCall') {
    return 'by phone call';
  }
  if (type === 'auth.SentCodeTypeEmailCode') {
    return 'to your login email';
  }
  if (type === 'auth.SentCodeTypeFragmentSms') {
    return 'via Fragment';
  }
  return 'to your Telegram account';
}

function requestCode(gram, config, creds) {
  var client = createClient(gram, config, '');
  var codeRequestAge = cache.codeRequestAgeMs(creds.phone);
  pinAuthDc(client, config);
  if (codeRequestAge !== null && codeRequestAge < CODE_REQUEST_MIN_INTERVAL_MS) {
    var waitSeconds = Math.ceil((CODE_REQUEST_MIN_INTERVAL_MS - codeRequestAge) / 1000);
    if (creds.phoneCodeHash && creds.pendingSession) {
      return Promise.reject(new Error('A Telegram login code was already requested. Enter that code, or wait ' + waitSeconds + ' seconds before requesting another.'));
    }
    return Promise.reject(new Error('Telegram login code recently requested. Wait ' + waitSeconds + ' seconds before requesting another.'));
  }
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
      // Start the resend cooldown only once Telegram actually sent a code, so a
      // failed request doesn't lock the user out for five minutes.
      cache.noteCodeRequest(creds.phone);
      reportStatus('Code requested.');
      cache.setPhoneCodeRequest(result.phoneCodeHash, client.session.save());
      cache.clearCode();
      return closeClient(client).then(function() {
        return result;
      });
    }).then(function(result) {
      throw new Error('Telegram sent a login code ' + codeDestination(result) +
                      '. Open Pebblegram settings on your phone, enter the code, then tap Save.');
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

  function failSignIn(err) {
    if (shouldClearCodeRequest(err)) {
      cache.clearCodeRequest();
    }
    if (isFatalSessionError(err)) {
      cache.clearSession();
    }
    return closeClient(client).then(function() {
      throw new Error(authErrorMessage(err));
    });
  }

  function signInWithPassword() {
    reportStatus('Checking password...');
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
    }).catch(function(err) {
      if (telegramErrorCode(err) === 'PASSWORD_HASH_INVALID') {
        cache.set('password', '');
        cache.set('authStage', 'password');
      }
      return failSignIn(err);
    });
  }

  function needPassword() {
    cache.set('authStage', 'password');
    return closeClient(client).then(function() {
      throw new Error('Open Pebblegram settings on your phone, enter your Telegram two-step password, then tap Save.');
    });
  }

  // No auth-DC pin here: pendingSession already carries the data center (and
  // matching auth key) Telegram migrated us to while sending the code.
  // Re-pinning pointed sign-in at the wrong DC and caused the
  // "Maximum reconnection retries" loop (issue #4, PR #9).
  if (creds.authStage === 'password' && !creds.password) {
    return needPassword();
  }
  return timeout(
    Promise.resolve().then(function() {
      reportStatus('Connecting...');
      return client.connect();
    }).then(function() {
      if (creds.authStage === 'password' && creds.pendingSession) {
        // The code was already accepted; Telegram only needs the password now.
        return 'password';
      }
      if (!creds.phoneCodeHash) {
        throw new Error('Open settings, save your phone number again, then enter the new Telegram code.');
      }
      if (!creds.pendingSession) {
        cache.clearCodeRequest();
        throw new Error('Code stale. Open settings, save your phone number again, then enter the new Telegram code.');
      }
      reportStatus('Signing in...');
      return client.invoke(new gram.Api.auth.SignIn({
        phoneNumber: creds.phone,
        phoneCodeHash: creds.phoneCodeHash,
        phoneCode: creds.code
      }));
    }).then(function(result) {
      if (result === 'password') {
        return signInWithPassword();
      }
      if (result && result.className === 'auth.AuthorizationSignUpRequired') {
        cache.clearCodeRequest();
        return failSignIn(new Error('No Telegram account uses this phone number. Sign up in the Telegram app first.'));
      }
      cache.setSession(client.session.save());
      return client;
    }, function(err) {
      if (err && err.errorMessage === 'SESSION_PASSWORD_NEEDED') {
        return creds.password ? signInWithPassword() : needPassword();
      }
      return failSignIn(err);
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
  var client = currentClient;
  currentClient = null;
  clientPromise = null;
  cache.clearSession();
  return closeClient(client);
}

function getClient() {
  if (clientPromise) {
    return clientPromise.then(ensureConnected).catch(function(err) {
      clientPromise = null;
      throw err;
    });
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

    if (!creds.session && !creds.code && creds.authStage !== 'password') {
      requestCode(gram, config, creds).then(resolve).catch(function(err) {
        clientPromise = null;
        reject(err);
      });
      return;
    }

    if (!creds.session && (creds.code || creds.authStage === 'password')) {
      signInWithCode(gram, config, creds).then(function(client) {
        currentClient = client;
        resolve(client);
      }).catch(function(err) {
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
      return ensureConnected(client);
    }).then(function(connectedClient) {
      currentClient = connectedClient;
      if (connectedClient.session && typeof connectedClient.session.save === 'function') {
        cache.setSession(connectedClient.session.save());
      }
      resolve(connectedClient);
    }), 'Telegram connect timed out.').catch(function(err) {
      discardClient(client, isFatalSessionError(err)).then(function() {
        reject(new Error(authErrorMessage(err)));
      });
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
