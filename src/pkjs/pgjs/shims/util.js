function inherits(child, parent) {
  child.prototype = Object.create(parent.prototype);
  child.prototype.constructor = child;
}

function inspect(value) {
  try {
    return JSON.stringify(value);
  } catch (e) {
    return String(value);
  }
}

module.exports = {
  _extend: Object.assign,
  inherits: inherits,
  inspect: inspect
};
