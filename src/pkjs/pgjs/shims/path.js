module.exports = {
  join: function() {
    return Array.prototype.slice.call(arguments).join('/');
  },
  resolve: function() {
    return Array.prototype.slice.call(arguments).join('/');
  },
  dirname: function(path) {
    var index = String(path || '').lastIndexOf('/');
    return index < 0 ? '.' : path.slice(0, index);
  }
};
