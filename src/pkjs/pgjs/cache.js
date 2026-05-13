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
    session: get('session', ''),
    authStage: get('authStage', '')
  };
}

function saveSettings(data) {
  if (data.apiId !== undefined) {
    set('apiId', String(data.apiId).trim());
  }
  if (data.apiHash !== undefined) {
    set('apiHash', String(data.apiHash).trim());
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

function setPhoneCodeRequest(hash, pendingSession) {
  set('phoneCodeHash', hash);
  set('pendingSession', pendingSession);
  set('authStage', 'code');
}

function setSession(session) {
  set('session', session);
  set('authStage', 'complete');
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
  setPhoneCodeRequest: setPhoneCodeRequest,
  clearSession: clearSession
};
