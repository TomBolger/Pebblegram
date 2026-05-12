function EventEmitter() {}

EventEmitter.prototype.on = function() {
  return this;
};

EventEmitter.prototype.once = function() {
  return this;
};

EventEmitter.prototype.removeListener = function() {
  return this;
};

EventEmitter.prototype.emit = function() {
  return false;
};

module.exports = {
  EventEmitter: EventEmitter
};
