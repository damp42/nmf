// QR rendering helper — wraps qrcode-generator (global `qrcode`).
// typeNumber 0 = auto-select the QR version to fit the data, so our ~300-byte JSON
// payload encodes reliably (the older qrcodejs wrapper mis-sized it and overflowed).
// Renders as inline SVG (crisp at any size, no canvas needed).
// Returns a resolved promise so callers can `await renderQR(...)`.

function renderQR(container, text) {
  container.innerHTML = '';
  // Use UTF-8 byte encoding when the build exposes it, so any non-ASCII survives.
  if (typeof qrcode.stringToBytesFuncs !== 'undefined' && qrcode.stringToBytesFuncs['UTF-8']) {
    qrcode.stringToBytes = qrcode.stringToBytesFuncs['UTF-8'];
  }
  const qr = qrcode(0, 'L'); // 0 = auto version; 'L' = max data capacity
  qr.addData(text);
  qr.make();
  container.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2 });
  return Promise.resolve();
}
