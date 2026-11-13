var cache = require('./cache');

var clientPromise = null;
var currentClient = null;
var qrGeneration = 0;
var AUTH_TIMEOUT_MS = 30000;
var CODE_TIMEOUT_MS = 90000;
var CODE_REQUEST_MIN_INTERVAL_MS = 5 * 60 * 1000;
var AUTH_DC = {
  id: 1,
  host: 'pluto.web.telegram.org'
};
var statusHandler = function() {};
var qrHandler = function() {};

function setStatusHandler(handler) {
  statusHandler = typeof handler === 'function' ? handler : function() {};
}

function setQrHandler(handler) {
  qrHandler = typeof handler === 'function' ? handler : function() {};
}

function reportStatus(message) {
  statusHandler(message);
}

function reportQr(url) {
  qrHandler(url || null);
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
  if (creds.loginMethod !== 'qr' && !creds.phone) {
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

function supersededLogin() {
  return new Error('Login superseded.');
}

function loginStillCurrent(generation) {
  return generation === qrGeneration;
}

function requestCode(gram, config, creds) {
  var generation = qrGeneration;
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
      if (!loginStillCurrent(generation)) {
        return closeClient(client).then(function() {
          throw supersededLogin();
        });
      }
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
      if (!loginStillCurrent(generation)) {
        cache.clearCodeRequest();
        return closeClient(client).then(function() {
          throw supersededLogin();
        });
      }
      return closeClient(client).then(function() {
        return result;
      });
    }).then(function(result) {
      if (result && result.type && result.type.className === 'auth.SentCodeTypeApp') {
        throw new Error('Code was sent to another Telegram app. Press Select for QR login.');
      }
      throw new Error('Telegram sent a login code ' + codeDestination(result) +
                      '. Open Pebblegram settings on your phone, enter the code, then tap Save.');
    }, function(err) {
      return closeClient(client).then(function() {
        throw err;
      });
    }),
    'Telegram code request timed out.',
    CODE_TIMEOUT_MS
  ).then(function(value) {
    return value;
  }, function(err) {
    if (!loginStillCurrent(generation)) {
      throw supersededLogin();
    }
    throw err;
  });
}

function signInWithCode(gram, config, creds) {
  var generation = qrGeneration;
  var client = createClient(gram, config, creds.pendingSession || '');

  function failSignIn(err) {
    if (!loginStillCurrent(generation)) {
      return closeClient(client).then(function() {
        throw supersededLogin();
      });
    }
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
      if (!loginStillCurrent(generation)) {
        throw supersededLogin();
      }
      cache.setSession(client.session.save());
      return client;
    }).catch(function(err) {
      if (!loginStillCurrent(generation)) {
        throw supersededLogin();
      }
      if (telegramErrorCode(err) === 'PASSWORD_HASH_INVALID') {
        cache.set('password', '');
        cache.set('authStage', 'password');
      }
      return failSignIn(err);
    });
  }

  function needPassword() {
    if (!loginStillCurrent(generation)) {
      return closeClient(client).then(function() {
        throw supersededLogin();
      });
    }
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
        if (!loginStillCurrent(generation)) {
          throw supersededLogin();
        }
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
      if (!loginStillCurrent(generation)) {
        throw supersededLogin();
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
  ).then(function(value) {
    return value;
  }, function(err) {
    if (!loginStillCurrent(generation)) {
      throw supersededLogin();
    }
    throw err;
  });
}

function base64Url(bytes) {
  var alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  var out = '';
  var i;
  for (i = 0; i < bytes.length; i += 3) {
    var b0 = bytes[i];
    var b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    var b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    var triple = (b0 << 16) | (b1 << 8) | b2;
    out += alphabet[(triple >> 18) & 63];
    out += alphabet[(triple >> 12) & 63];
    out += i + 1 < bytes.length ? alphabet[(triple >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? alphabet[triple & 63] : '=';
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function tokenBytes(token) {
  var bytes = [];
  var length = token && typeof token.length === 'number' ? token.length : 0;
  var i;
  for (i = 0; i < length; i++) {
    bytes.push(token[i] & 255);
  }
  return bytes;
}

function loginUrlFromToken(token) {
  var bytes = tokenBytes(token);
  if (!bytes.length) {
    throw new Error('Telegram did not return a QR login token.');
  }
  return 'tg://login?token=' + base64Url(bytes);
}

function sameType(gram, result, name) {
  var ctor = gram.Api && gram.Api.auth && gram.Api.auth[name];
  if (ctor && result instanceof ctor) {
    return true;
  }
  var className = result && result.className;
  return className === name || className === 'auth.' + name;
}

function exportLoginToken(client, gram, config) {
  return client.invoke(new gram.Api.auth.ExportLoginToken({
    apiId: config.apiId,
    apiHash: config.apiHash,
    exceptIds: []
  }));
}

function delay(ms) {
  return new Promise(function(resolve) {
    setTimeout(resolve, ms);
  });
}

function waitForQrScan(client, gram, expires) {
  return new Promise(function(resolve) {
    var finished = false;
    var timer = null;
    function finish(scanned) {
      if (finished) {
        return;
      }
      finished = true;
      if (timer) {
        clearTimeout(timer);
      }
      if (client && typeof client.removeEventHandler === 'function') {
        try {
          client.removeEventHandler(onUpdate);
        } catch (err) {
          // The handler goes quiet on its own if it cannot be removed.
        }
      }
      resolve(scanned);
    }
    function onUpdate(update) {
      var updateCtor = gram.Api && gram.Api.UpdateLoginToken;
      var className = update && update.className;
      if ((updateCtor && update instanceof updateCtor) || className === 'UpdateLoginToken') {
        finish(true);
      }
    }
    var waitMs = 30000;
    if (expires) {
      waitMs = Math.max(5000, Math.min(30000, (expires * 1000) - Date.now() - 1500));
    }
    if (client && typeof client.addEventHandler === 'function') {
      client.addEventHandler(onUpdate);
    }
    timer = setTimeout(function() {
      finish(false);
    }, waitMs);
  });
}

function signInWithQr(gram, config, creds) {
  var generation = ++qrGeneration;
  var client = createClient(gram, config, creds.pendingSession || '');
  if (!creds.pendingSession) {
    pinAuthDc(client, config);
  }

  function cancelled() {
    return generation !== qrGeneration;
  }

  function fail(err) {
    reportQr(null);
    if (isFatalSessionError(err)) {
      cache.clearSession();
    }
    return closeClient(client).then(function() {
      throw new Error(authErrorMessage(err));
    });
  }

  function succeed() {
    if (cancelled()) {
      throw new Error('QR login cancelled.');
    }
    reportQr(null);
    cache.setSession(client.session.save());
    currentClient = client;
    return client;
  }

  function passwordNeeded() {
    if (cancelled()) {
      throw new Error('QR login cancelled.');
    }
    cache.set('pendingSession', client.session.save());
    cache.set('authStage', 'password');
    cache.set('loginMethod', 'qr');
    reportQr(null);
    if (!creds.password) {
      return closeClient(client).then(function() {
        throw new Error('Open Pebblegram settings on your phone, enter your Telegram two-step password, then tap Save.');
      });
    }
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
    }).then(succeed, function(err) {
      if (cancelled()) {
        throw new Error('QR login cancelled.');
      }
      if (telegramErrorCode(err) === 'PASSWORD_HASH_INVALID') {
        cache.set('password', '');
        cache.set('authStage', 'password');
      }
      return fail(err);
    });
  }

  function accept(result) {
    if (cancelled()) {
      throw new Error('QR login cancelled.');
    }
    if (sameType(gram, result, 'LoginTokenSuccess')) {
      return succeed();
    }
    if (sameType(gram, result, 'LoginTokenMigrateTo')) {
      reportStatus('Confirming login...');
      return Promise.resolve(client._switchDC(result.dcId || result.dc_id)).then(function() {
        return client.invoke(new gram.Api.auth.ImportLoginToken({
          token: result.token
        }));
      }).then(function(migrated) {
        if (sameType(gram, migrated, 'LoginTokenSuccess')) {
          return succeed();
        }
        throw new Error('Telegram did not confirm the QR login.');
      });
    }
    if (!sameType(gram, result, 'LoginToken')) {
      throw new Error('Telegram did not return a QR login token.');
    }
    reportQr(loginUrlFromToken(result.token));
    reportStatus('Scan the QR code');
    return waitForQrScan(client, gram, result.expires).then(function(scanned) {
      if (cancelled()) {
        throw new Error('QR login cancelled.');
      }
      if (scanned) {
        return confirmScan(5);
      }
      return exportLoginToken(client, gram, config).then(accept);
    });
  }

  function confirmScan(left) {
    return exportLoginToken(client, gram, config).then(function(result) {
      if (sameType(gram, result, 'LoginToken') && left > 0) {
        return delay(800).then(function() {
          return confirmScan(left - 1);
        });
      }
      return accept(result);
    });
  }

  return Promise.resolve().then(function() {
    reportStatus('Connecting...');
    return client.connect();
  }).then(function() {
    if (cancelled()) {
      throw new Error('QR login cancelled.');
    }
    reportStatus('Preparing QR...');
    return exportLoginToken(client, gram, config);
  }).then(accept).catch(function(err) {
    if (cancelled()) {
      return closeClient(client).then(function() {
        throw new Error('QR login cancelled.');
      });
    }
    if (telegramErrorCode(err) === 'SESSION_PASSWORD_NEEDED') {
      return passwordNeeded();
    }
    return fail(err);
  });
}

function authState() {
  var creds = cache.credentials();
  return {
    apiId: creds.apiId || '',
    hasApiHash: !!creds.apiHash,
    phone: creds.phone || '',
    hasSession: !!creds.session,
    authStage: creds.authStage || '',
    loginMethod: creds.loginMethod || ''
  };
}

function reset() {
  qrGeneration++;
  reportQr(null);
  var client = currentClient;
  currentClient = null;
  clientPromise = null;
  cache.clearSession();
  return closeClient(client);
}

function beginQrLogin() {
  if (authState().hasSession) {
    return getClient();
  }
  cache.set('loginMethod', 'qr');
  cache.clearCodeRequest();
  return reset().then(function() {
    cache.set('loginMethod', 'qr');
    return getClient();
  });
}

function getClient() {
  if (clientPromise) {
    var existing = clientPromise;
    return existing.then(ensureConnected).catch(function(err) {
      if (clientPromise === existing) {
        clientPromise = null;
      }
      throw err;
    });
  }

  var promise;
  promise = new Promise(function(resolve, reject) {
    function fail(err) {
      if (clientPromise === promise) {
        clientPromise = null;
      }
      reject(err);
    }

    var creds = cache.credentials();
    var gram = loadGramJs();
    var config = runtimeConfig(gram, creds);
    var missing = missingCredentials(config, creds);
    if (missing) {
      fail(new Error(missing));
      return;
    }

    if (!creds.session && creds.authStage === 'password') {
      signInWithCode(gram, config, creds).then(function(client) {
        currentClient = client;
        resolve(client);
      }).catch(fail);
      return;
    }

    if (!creds.session && creds.loginMethod === 'qr') {
      signInWithQr(gram, config, creds).then(function(client) {
        currentClient = client;
        resolve(client);
      }).catch(fail);
      return;
    }

    if (!creds.session && !creds.code) {
      requestCode(gram, config, creds).then(resolve).catch(fail);
      return;
    }

    if (!creds.session && creds.code) {
      signInWithCode(gram, config, creds).then(function(client) {
        currentClient = client;
        resolve(client);
      }).catch(fail);
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
        fail(new Error(authErrorMessage(err)));
      });
    });
  });
  clientPromise = promise;

  return clientPromise;
}

module.exports = {
  authState: authState,
  beginQrLogin: beginQrLogin,
  getClient: getClient,
  reset: reset,
  setQrHandler: setQrHandler,
  setStatusHandler: setStatusHandler,
  saveSettings: cache.saveSettings
};
