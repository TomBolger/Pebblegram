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
}

function credentials() {
  return {
    apiId: getNumber('apiId', 0),
    apiHash: get('apiHash', ''),
    phone: get('phone', ''),
    code: get('code', ''),
    password: get('password', ''),
    session: get('session', ''),
    authStage: get('authStage', '')
  };
}

function saveSettings(data) {
  if (data.phone !== undefined) {
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

function setSession(session) {
  set('session', session);
  set('authStage', 'complete');
  localStorage.removeItem(PREFIX + 'code');
  localStorage.removeItem(PREFIX + 'password');
}

module.exports = {
  get: get,
  set: set,
  credentials: credentials,
  saveSettings: saveSettings,
  setSession: setSession,
  clearCode: clearCode,
  clearSession: clearSession
};
