// NoMoreForms — crypto helpers
// Uses ONLY the browser's built-in Web Crypto API (SubtleCrypto). No external libraries.
//
// ⚠️ crypto.subtle only exists in secure contexts (https:// or http://localhost).
//    It is undefined on file:// URLs. Always serve via the local server (`npm start`)
//    or the deployed HTTPS URL.
//
// This file is IDENTICAL in public/form/ and public/app/. Keep both copies in sync.

const ECDH_PARAMS = { name: 'ECDH', namedCurve: 'P-256' };
const HKDF_INFO   = new TextEncoder().encode('NoMoreForms v1');
const HKDF_SALT   = new Uint8Array(32); // fixed zero salt — the session uniqueness comes from ephemeral keys

// Generate an ephemeral ECDH keypair — called once per session on each side
async function generateKeypair() {
  return crypto.subtle.generateKey(ECDH_PARAMS, true, ['deriveKey']);
}

// Export public key as base64 string for QR code / relay transport
async function exportPublicKey(keypair) {
  const raw = await crypto.subtle.exportKey('raw', keypair.publicKey);
  return btoa(String.fromCharCode(...new Uint8Array(raw)));
}

// Import a base64 public key received from the other party
async function importPublicKey(base64) {
  const raw = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, ECDH_PARAMS, true, []);
}

// Derive shared AES-256-GCM key via ECDH + HKDF
// Both sides call this with their own private key + the other side's public key
// Result is identical on both sides — this is the magic of ECDH
async function deriveSharedKey(myPrivateKey, theirPublicKey) {
  const ecdhKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: theirPublicKey },
    myPrivateKey,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: HKDF_SALT, info: HKDF_INFO },
    ecdhKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

// Encrypt a JSON-serializable payload
// Returns { iv: base64, ciphertext: base64 }
async function encrypt(sharedKey, payload) {
  const iv       = crypto.getRandomValues(new Uint8Array(12));
  const encoded  = new TextEncoder().encode(JSON.stringify(payload));
  const ctBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, sharedKey, encoded);
  return {
    iv:         btoa(String.fromCharCode(...iv)),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ctBuffer)))
  };
}

// Decrypt a { iv: base64, ciphertext: base64 } envelope
// Returns the original JS object
async function decrypt(sharedKey, { iv, ciphertext }) {
  const ivBytes  = Uint8Array.from(atob(iv),         c => c.charCodeAt(0));
  const ctBytes  = Uint8Array.from(atob(ciphertext), c => c.charCodeAt(0));
  const plain    = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBytes }, sharedKey, ctBytes);
  return JSON.parse(new TextDecoder().decode(plain));
}

// Truncate a base64 string for display in the crypto log
function truncate(b64, n = 8) {
  return b64.length <= n * 2 + 3 ? b64 : `${b64.slice(0, n)}...${b64.slice(-n)}`;
}
