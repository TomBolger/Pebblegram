var PREFIX = 'pgjs.';

function get(name, fallback) {
  var value = localStorage.getItem(PREFIX + name);
  return value === null || value === '' ? fallback : value;
}

function set(name, value) {
  if (value === undefined || value === null || value === '') {
    localStorage.removeItem(PREFIX + name);
    return;
  }
  localStorage.setItem(PREFIX + name, String(value));
}

function getNumber(name, fallback) {
  var value = parseInt(get(name, ''), 10);
  return isNaN(value) ? fallback : value;
}

function clearSession() {
  localStorage.removeItem(PREFIX + 'session');
  localStorage.removeItem(PREFIX + 'sessionBackup');
  localStorage.removeItem(PREFIX + 'authStage');
  localStorage.removeItem(PREFIX + 'code');
  localStorage.removeItem(PREFIX + 'password');
  localStorage.removeItem(PREFIX + 'phoneCodeHash');
  localStorage.removeItem(PREFIX + 'pendingSession');
}

function credentials() {
  return {
    apiId: getNumber('apiId', 0),
    apiHash: get('apiHash', ''),
    phone: get('phone', ''),
    code: get('code', ''),
    password: get('password', ''),
    phoneCodeHash: get('phoneCodeHash', ''),
    pendingSession: get('pendingSession', ''),
    session: get('session', '') || get('sessionBackup', ''),
    authStage: get('authStage', ''),
    loginMethod: get('loginMethod', '')
  };
}

function saveSettings(data) {
  var nextApiId;
  var nextApiHash;
  if (data.apiId !== undefined) {
    nextApiId = String(data.apiId).trim();
    if (get('apiId', '') && get('apiId', '') !== nextApiId) {
      clearSession();
    }
    set('apiId', nextApiId);
  }
  if (data.apiHash !== undefined) {
    nextApiHash = String(data.apiHash).trim();
    if (get('apiHash', '') && nextApiHash && get('apiHash', '') !== nextApiHash) {
      clearSession();
    }
    set('apiHash', nextApiHash);
  }
  if (data.phone !== undefined) {
    if (get('phone', '') !== String(data.phone).trim()) {
      clearSession();
    }
    set('phone', String(data.phone).trim());
  }
  if (data.code !== undefined) {
    set('code', String(data.code).trim());
  }
  if (data.password !== undefined) {
    set('password', String(data.password));
  }
  if (data.resetSession) {
    clearSession();
  }
  if (data.loginMethod === 'qr') {
    set('loginMethod', 'qr');
    clearCodeRequest();
  } else if (data.phone !== undefined && String(data.phone).trim()) {
    set('loginMethod', '');
  }
}

function clearCode() {
  localStorage.removeItem(PREFIX + 'code');
}

function clearCodeRequest() {
  localStorage.removeItem(PREFIX + 'code');
  localStorage.removeItem(PREFIX + 'phoneCodeHash');
  localStorage.removeItem(PREFIX + 'pendingSession');
  localStorage.removeItem(PREFIX + 'authStage');
}

function noteCodeRequest(phone) {
  set('lastCodeRequestAt', String(Date.now()));
  set('lastCodeRequestPhone', phone || '');
}

function codeRequestAgeMs(phone) {
  var requestedAt = getNumber('lastCodeRequestAt', 0);
  var requestPhone = get('lastCodeRequestPhone', '');
  if (!requestedAt || requestPhone !== (phone || '')) {
    return null;
  }
  return Date.now() - requestedAt;
}

function setPhoneCodeRequest(hash, pendingSession) {
  set('phoneCodeHash', hash);
  set('pendingSession', pendingSession);
  set('authStage', 'code');
}

function setSession(session) {
  set('session', session);
  set('sessionBackup', session);
  set('authStage', 'complete');
  localStorage.removeItem(PREFIX + 'loginMethod');
  localStorage.removeItem(PREFIX + 'code');
  localStorage.removeItem(PREFIX + 'password');
  localStorage.removeItem(PREFIX + 'phoneCodeHash');
  localStorage.removeItem(PREFIX + 'pendingSession');
}

module.exports = {
  get: get,
  set: set,
  credentials: credentials,
  saveSettings: saveSettings,
  setSession: setSession,
  clearCode: clearCode,
  clearCodeRequest: clearCodeRequest,
  noteCodeRequest: noteCodeRequest,
  codeRequestAgeMs: codeRequestAgeMs,
  setPhoneCodeRequest: setPhoneCodeRequest,
  clearSession: clearSession
};
