var qrcode = require('./vendor/qrcode');

// Row-major modules, LSB first in each byte. The watch draws this as a QR.
function matrix(text) {
  var qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  var modules = qr.getModuleCount();
  var bytes = [];
  var acc = 0;
  var bit = 0;
  var row;
  var col;
  for (row = 0; row < modules; row++) {
    for (col = 0; col < modules; col++) {
      if (qr.isDark(row, col)) {
        acc |= (1 << bit);
      }
      bit++;
      if (bit === 8) {
        bytes.push(acc);
        acc = 0;
        bit = 0;
      }
    }
  }
  if (bit) {
    bytes.push(acc);
  }
  return {modules: modules, bytes: bytes};
}

module.exports = {
  matrix: matrix
};
