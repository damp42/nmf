// scanner.js — camera QR scanning via jsQR (global `jsQR`).
// Drives a <video> preview, samples frames into a hidden <canvas>, and calls
// onDecode(text) with the first decoded QR. Handles camera-permission failure.

let _scanStream = null;
let _scanRAF = null;

async function startScanner(videoEl, canvasEl, onDecode, onError) {
  // Secure-context guard — getUserMedia needs https:// or localhost.
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    onError('insecure', new Error('Camera unavailable — needs HTTPS or localhost'));
    return;
  }
  try {
    _scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
  } catch (e) {
    onError('permission', e);
    return;
  }

  videoEl.setAttribute('playsinline', 'true'); // iOS Safari: don't go fullscreen
  videoEl.srcObject = _scanStream;
  await videoEl.play();

  const ctx = canvasEl.getContext('2d', { willReadFrequently: true });

  const tick = () => {
    if (!_scanStream) return; // stopped
    if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA) {
      canvasEl.width = videoEl.videoWidth;
      canvasEl.height = videoEl.videoHeight;
      ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
      const img = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
      const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
      if (code && code.data) {
        stopScanner(videoEl);
        onDecode(code.data);
        return;
      }
    }
    _scanRAF = requestAnimationFrame(tick);
  };
  _scanRAF = requestAnimationFrame(tick);
}

function stopScanner(videoEl) {
  if (_scanRAF) { cancelAnimationFrame(_scanRAF); _scanRAF = null; }
  if (_scanStream) { _scanStream.getTracks().forEach(t => t.stop()); _scanStream = null; }
  if (videoEl) videoEl.srcObject = null;
}

// Parse + validate a scanned QR string. Returns { ok, data } or { ok:false, reason, msg }.
function validateQRPayload(text) {
  let data;
  try { data = JSON.parse(text); }
  catch { return { ok: false, reason: 'invalid', msg: 'Unrecognized QR code — not a NoMoreForms request.' }; }

  const required = ['session_id', 'public_key', 'requested_fields', 'relay_url', 'expires_at'];
  for (const k of required) {
    if (!(k in data)) return { ok: false, reason: 'invalid', msg: 'This QR code is missing required data.' };
  }
  if (!Array.isArray(data.requested_fields) || data.requested_fields.length === 0) {
    return { ok: false, reason: 'invalid', msg: 'This QR code requests no fields.' };
  }
  if (typeof data.expires_at !== 'number' || Date.now() > data.expires_at) {
    return { ok: false, reason: 'expired', msg: 'This QR code has expired — please refresh the form page.' };
  }
  return { ok: true, data };
}
