# NoMoreForms — Demo Implementation Spec
**For use with:** Claude Code  
**Version:** 0.2  
**Status:** Ready for implementation  
**Depends on:** NoMoreForms_MVP_Spec.md (read that first for context)  
**Replaces:** v0.1 (local-only, two-tab browser demo)

---

## Overview

Build a two-device demo that proves the NoMoreForms concept using **real asymmetric cryptography**, deployed publicly on Vercel. The form runs in any browser on any machine. The vault runs as a mobile web app on the user's phone. The two devices communicate only through an encrypted WebSocket relay that is provably blind to all content.

**The demo's core proof:** A form on a public computer contains zero personal data. A phone holds all personal data, locally. The user scans a QR code, reviews what's being requested, approves it — and the form fills itself. No personal data ever existed on the form's machine until the moment of approval, and it arrived encrypted over a relay that couldn't read it.

The demo has three components:

| Component | What it is | Deployed to | Tech |
|-----------|-----------|-------------|------|
| `relay/` | WebSocket relay server | Vercel (Node.js serverless / Edge) | Node.js |
| `form/` | Recipient form page + crypto log | Vercel (static) | Vanilla HTML/CSS/JS |
| `app/` | Mobile vault app (the user's "phone app") | Vercel (static, mobile-optimized) | Vanilla HTML/CSS/JS |

All three live in one repository and deploy together to Vercel. One `vercel.json` routes everything. No separate services, no local servers required to run the demo.

---

## Repository Structure

```
nomoref orms-demo/
├── api/
│   └── relay.js           # Vercel serverless WebSocket handler (the relay)
├── public/
│   ├── form/
│   │   ├── index.html     # Recipient form page with crypto log
│   │   ├── crypto.js      # ECDH + AES helpers
│   │   ├── qr.js          # QR code generation
│   │   └── style.css
│   ├── app/
│   │   ├── index.html     # Mobile vault app (opened on phone)
│   │   ├── crypto.js      # ECDH + AES helpers (identical to form/crypto.js)
│   │   ├── scanner.js     # QR camera scanning via jsQR
│   │   └── style.css
│   └── shared/
│       └── fields.js      # NMF namespace definitions, bundles, display labels
├── vercel.json            # Routing + deployment config
├── package.json
└── README.md
```

---

## Deployment Architecture

```
                        VERCEL (single deployment)
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│  https://nomoref orms-demo.vercel.app/form/      ← form page    │
│  https://nomoref orms-demo.vercel.app/app/       ← mobile vault │
│  wss://nomoref orms-demo.vercel.app/api/relay    ← WS relay     │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
          ▲                                    ▲
          │  WebSocket (ciphertext only)       │  WebSocket (ciphertext only)
          │                                    │
   ┌──────┴──────┐                    ┌────────┴────────┐
   │   LAPTOP    │                    │     PHONE       │
   │  (or any    │                    │  (user's own    │
   │   computer) │                    │   device)       │
   │             │                    │                 │
   │  form/      │  ←── fills ────    │  app/           │
   │  index.html │      via relay     │  index.html     │
   └─────────────┘                    └─────────────────┘
```

The relay sits between them and sees only encrypted blobs. Neither device ever sends plaintext to the relay or to each other.

---

## Component 1: Relay Server (`api/relay.js`)

### Purpose
Forward encrypted messages between the form session and the vault app. Provably blind — routes by session ID only, never inspects content.

### Vercel WebSocket Considerations

Vercel supports WebSockets via their Edge runtime. The relay must be implemented as a Vercel Edge Function. Key constraints:
- Use `export const config = { runtime: 'edge' }` 
- Vercel's Edge runtime does not support Node.js `ws` library — use the native `WebSocket` API available in the Edge runtime
- Sessions are in-memory per instance. This is fine for a demo — in production, a dedicated WebSocket server (Fly.io, Railway, Render) would be used for persistence across instances
- Add a `vercel.json` route to map `/api/relay` to this handler

### Alternative if Vercel Edge WebSockets prove unreliable
If Vercel's Edge WebSocket support causes issues during implementation, fall back to **Ably** or **Pusher** free tier as the relay transport. Both offer free WebSocket hosting with no message content inspection. The crypto layer above them is identical — the relay is just a dumb pipe regardless of which service runs it. Document the fallback clearly in the README.

### Relay Behavior (identical regardless of transport)
- Accepts connections with `?session=<session_id>` query parameter
- Maintains a map of `session_id → Set of connected sockets`
- On message received: broadcast to all *other* peers in the same session — never parse or log content
- On disconnect: clean up session map
- Console logs only: session ID, connection/disconnection events, message byte sizes
- **Never logs message content**

### vercel.json
```json
{
  "rewrites": [
    { "source": "/api/relay", "destination": "/api/relay.js" },
    { "source": "/form/(.*)", "destination": "/public/form/$1" },
    { "source": "/app/(.*)",  "destination": "/public/app/$1" }
  ]
}
```

### package.json
```json
{
  "name": "nomoref orms-demo",
  "version": "0.2.0",
  "scripts": {
    "dev": "vercel dev"
  },
  "devDependencies": {
    "vercel": "latest"
  }
}
```

### What to verify
- Two devices on different networks can exchange messages via the relay
- Message content is never logged (verify in Vercel function logs after a run)
- Disconnecting one device doesn't affect the other session peers
- Sessions are scoped — device A and device B with different session IDs cannot receive each other's messages

---

## Component 2: Shared Field Definitions (`public/shared/fields.js`)

Single source of truth for the NMF namespace. Loaded by both form and app pages via a `<script src="/shared/fields.js">` tag.

```javascript
// NMF namespace → display metadata
const NMF_FIELDS = {
  'me:identity:name:first':            { label: 'First Name',             group: 'Identity',  sensitivity: 'standard' },
  'me:identity:name:last':             { label: 'Last Name',              group: 'Identity',  sensitivity: 'standard' },
  'me:identity:name:full':             { label: 'Full Name',              group: 'Identity',  sensitivity: 'standard' },
  'me:identity:dob':                   { label: 'Date of Birth',          group: 'Identity',  sensitivity: 'standard' },
  'me:identity:ssn:last4':             { label: 'SSN (last 4)',           group: 'Identity',  sensitivity: 'sensitive' },
  'me:contact:email:primary':          { label: 'Email Address',          group: 'Contact',   sensitivity: 'standard' },
  'me:contact:phone:mobile':           { label: 'Mobile Phone',           group: 'Contact',   sensitivity: 'standard' },
  'me:contact:address:street':         { label: 'Street Address',         group: 'Contact',   sensitivity: 'standard' },
  'me:contact:address:city':           { label: 'City',                   group: 'Contact',   sensitivity: 'standard' },
  'me:contact:address:state':          { label: 'State',                  group: 'Contact',   sensitivity: 'standard' },
  'me:contact:address:zip':            { label: 'ZIP Code',               group: 'Contact',   sensitivity: 'standard' },
  'me:health:insurance:provider':      { label: 'Insurance Provider',     group: 'Insurance', sensitivity: 'sensitive' },
  'me:health:insurance:member_id':     { label: 'Member ID',              group: 'Insurance', sensitivity: 'sensitive' },
  'me:health:insurance:group_id':      { label: 'Group ID',               group: 'Insurance', sensitivity: 'sensitive' },
  'me:health:emergency_contact:name':  { label: 'Emergency Contact Name', group: 'Emergency', sensitivity: 'standard' },
  'me:health:emergency_contact:phone': { label: 'Emergency Contact Phone',group: 'Emergency', sensitivity: 'standard' },
};

// Named bundles — predefined field groupings
const NMF_BUNDLES = {
  'bundle:patient_intake': [
    'me:identity:name:full',
    'me:identity:dob',
    'me:contact:address:street',
    'me:contact:address:city',
    'me:contact:address:state',
    'me:contact:address:zip',
    'me:contact:phone:mobile',
    'me:contact:email:primary',
    'me:health:insurance:provider',
    'me:health:insurance:member_id',
    'me:health:insurance:group_id',
    'me:health:emergency_contact:name',
    'me:health:emergency_contact:phone',
  ],
};

function resolveFields(requested) {
  const resolved = [];
  for (const f of requested) {
    if (NMF_BUNDLES[f]) resolved.push(...NMF_BUNDLES[f]);
    else resolved.push(f);
  }
  return [...new Set(resolved)];
}
```

---

## Component 3: Crypto Helpers (`public/form/crypto.js` and `public/app/crypto.js`)

Identical file in both locations. Uses only the browser's built-in **Web Crypto API (SubtleCrypto)** — zero external crypto libraries required.

### ⚠️ SubtleCrypto Secure Context Requirement

`crypto.subtle` is only available in **secure contexts**: `https://` or `http://localhost`. It is completely unavailable on `file://` URLs and will throw `TypeError: Cannot read properties of undefined`. Since this demo is deployed to Vercel (HTTPS), this is a non-issue in production. For local development, always use `vercel dev` — never open HTML files directly from the filesystem.

**The README must state this prominently.** `vercel dev` is the only supported local development mode.

### Algorithms Used

| Purpose | Algorithm |
|---------|-----------|
| Key agreement | ECDH, P-256 curve |
| Key derivation | HKDF-SHA-256 |
| Symmetric encryption | AES-256-GCM |
| Encoding | Base64 (for transport over WebSocket) |

### crypto.js — Full Implementation

```javascript
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
```

---

## Component 4: Form Page (`public/form/index.html`)

### Role in the Demo
This page runs on any computer — a laptop, an office kiosk, a shared machine. It knows nothing about the user. It generates a QR code and waits. Personal data arrives only after the user approves on their own device.

### Layout — Desktop Two-Column

```
┌──────────────────────────┬────────────────────────────────┐
│   FORM  (left ~55%)      │  🔐 CRYPTO LOG  (right ~45%)  │
│                          │                                │
│  Dr. Smith's Office      │  ┌──────────────────────────┐ │
│  Patient Intake Form     │  │ Everything the relay saw  │ │
│                          │  │ is shown here             │ │
│  First Name  [_______]   │  └──────────────────────────┘ │
│  Last Name   [_______]   │                                │
│  DOB         [_______]   │  ✅ 14:32:01 Session created  │
│  Address     [_______]   │     sess_3a9f...              │
│  City        [_______]   │                                │
│  State  ZIP  [__] [____] │  ✅ 14:32:01 ECDH keypair     │
│  Phone       [_______]   │     generated (P-256)         │
│  Email       [_______]   │     Pub: 04a3f9...b2c1        │
│  Insurance   [_______]   │                                │
│  Member ID   [_______]   │  ✅ 14:32:01 QR rendered      │
│  Group ID    [_______]   │     13 fields requested       │
│                          │                                │
│  ┌──────────────────┐    │  ✅ 14:32:02 Relay connected  │
│  │                  │    │     wss://...vercel.app       │
│  │    [QR CODE]     │    │                                │
│  │                  │    │  ⏳ 14:32:02 Awaiting phone   │
│  └──────────────────┘    │     approval...               │
│                          │                                │
│  Scan with NoMoreForms   │  ← user scans on phone →      │
│                          │                                │
│  ⏳ Waiting for          │  ✅ 14:32:47 Payload received  │
│     approval...          │     IV:  8f2a...c301           │
│                          │     CT:  d4e9...aa02           │
│                          │     (relay saw exactly this)   │
│                          │                                │
│  First Name  [Alex    ]  │  ✅ 14:32:47 ECDH key agree.  │
│  Last Name   [Rivera  ]  │  ✅ 14:32:47 AES-256-GCM key  │
│  ...fields fill...       │  ✅ 14:32:47 Decrypted (local) │
│                          │  ✅ 14:32:47 13 fields filled  │
│  ✅ Submitted via NMF    │  ✅ 14:32:49 Audit logged      │
└──────────────────────────┴────────────────────────────────┘
```

### QR Code Content

The QR encodes a JSON string with everything the app needs to respond:

```json
{
  "session_id":       "sess_3a9fbc12",
  "public_key":       "<base64 ECDH P-256 public key>",
  "requested_fields": ["bundle:patient_intake"],
  "relay_url":        "wss://nomoref orms-demo.vercel.app/api/relay",
  "recipient_label":  "Dr. Smith's Office — Patient Intake",
  "expires_at":       1234567890
}
```

- `session_id`: 4 random bytes as hex, generated fresh on each page load
- `public_key`: form's ephemeral ECDH public key (base64, P-256 raw format)
- `requested_fields`: array of NMF field keys or bundle names
- `relay_url`: hardcoded to the deployed Vercel WSS URL
- `recipient_label`: human-readable string shown to the user on their phone during approval
- `expires_at`: Unix timestamp 5 minutes from page load; app rejects stale QRs

Use the `qrcode` library from CDN:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
```

### Form Fields and NMF Namespace Mapping

| HTML element | NMF key | autocomplete |
|---|---|---|
| `input#first-name` | `me:identity:name:first` | `given-name` |
| `input#last-name` | `me:identity:name:last` | `family-name` |
| `input#dob` | `me:identity:dob` | `bday` |
| `input#street` | `me:contact:address:street` | `street-address` |
| `input#city` | `me:contact:address:city` | `address-level2` |
| `input#state` | `me:contact:address:state` | `address-level1` |
| `input#zip` | `me:contact:address:zip` | `postal-code` |
| `input#phone` | `me:contact:phone:mobile` | `tel` |
| `input#email` | `me:contact:email:primary` | `email` |
| `input#insurance-provider` | `me:health:insurance:provider` | — |
| `input#member-id` | `me:health:insurance:member_id` | — |
| `input#group-id` | `me:health:insurance:group_id` | — |

All fields are `readonly` and styled as "locked/waiting" until data arrives. They animate (brief accent-color pulse) when populated.

### Crypto Log Panel

A fixed-height scrollable `<div>` on the right column. Each entry has:
- Status icon: ✅ done, ⏳ pending, ❌ error
- Timestamp: `HH:MM:SS`
- Short label
- Optional monospace detail block (truncated base64 values)

**Log entries emitted in order:**
1. `✅ Session created — ID: sess_3a9f...`
2. `✅ ECDH keypair generated (P-256)` + truncated public key
3. `✅ QR code rendered — awaiting scan` + field count
4. `✅ WebSocket connected → relay`
5. `⏳ Awaiting approval on user's device...`
6. *(phone sends encrypted payload)*
7. `✅ Encrypted payload received from relay` + truncated IV + truncated ciphertext + note: *"this is all the relay ever saw"*
8. `✅ ECDH key agreement performed` + explanation line
9. `✅ AES-256-GCM key derived via HKDF`
10. `✅ Payload decrypted — client-side only` + field count + note: *"server never held plaintext"*
11. `✅ Form fields populated`
12. `✅ Form submitted`
13. `✅ Audit event logged — [timestamp] [field list]`

**Styling:** dark terminal aesthetic. Monospace font for all key/IV/ciphertext values. Green for ✅, amber for ⏳, red for ❌. New entries fade in. A subtitle under the panel title reads: *"Everything the relay server saw is shown here."*

### Form Page JavaScript Flow

```
1. On DOMContentLoaded:
   a. Generate session_id (4 random bytes → hex string)
   b. Generate ECDH keypair (P-256) → log entry
   c. Export public key as base64 → log entry
   d. Compute expires_at = now + 5 minutes
   e. Build QR payload JSON string
   f. Render QR code into #qr-container → log entry
   g. Connect WebSocket: wss://.../api/relay?session=<session_id> → log entry
   h. Set status: "Awaiting approval..." → log entry

2. On WebSocket message received:
   a. Parse envelope JSON: { type, app_public_key, iv, ciphertext }
   b. If type === "denied": show denial state, stop
   c. Log receipt with truncated IV + ciphertext → log entry
   d. Import app_public_key from base64 → CryptoKey
   e. Derive shared AES key via deriveSharedKey(form_private_key, app_public_key) → log entry
   f. Decrypt payload → log entry
   g. Parse: { fields: { "me:identity:name:first": "Alex", ... } }
   h. For each field in NMF_FIELD_MAP: populate input.value with animation
   i. Log: "Form fields populated" → log entry
   j. Wait 1500ms (let audience see the filled fields)
   k. Submit form (prevent actual navigation — show inline success state)
   l. Log audit event → final log entry

3. QR expiry:
   a. After 5 minutes, regenerate keypair + session_id + QR
   b. Reconnect WebSocket with new session_id
   c. Log: "Session refreshed — new QR generated"
```

---

## Component 5: Mobile Vault App (`public/app/index.html`)

### Role in the Demo
This is the user's device. It holds all personal data locally (in-memory for the demo). The user opens this URL on their phone before the demo. When they scan the QR on the form page, they see exactly what's being requested, approve or deny, and data flows.

### Critical Design Constraints
- **Mobile-first layout** — max-width 420px, large touch targets (min 48px height), no hover states
- **No desktop assumptions** — must work correctly on iOS Safari and Android Chrome
- **Camera access** — QR scanning uses `getUserMedia` + `jsQR`; must handle permission denial gracefully
- **HTTPS required** — camera access requires a secure context; Vercel deployment handles this

### Layout — Three Screens (single-page, screen transitions)

**Screen 1: Vault / Home**

All fields are editable `<input>` elements. Changing a value updates the in-memory vault state immediately (`oninput`). Whatever is in the fields at the moment of approval is what gets shared — this is the demo's "source of truth" moment.

```
┌─────────────────────────┐
│  🔐 NoMoreForms         │
│  ─────────────────────  │
│                         │
│  Your Vault             │
│  ─────────────────────  │
│                         │
│  IDENTITY               │
│  Full Name              │
│  [Alex Rivera         ] │
│  Date of Birth          │
│  [1985-04-12          ] │
│                         │
│  CONTACT                │
│  Email                  │
│  [alex@example.com    ] │
│  Mobile Phone           │
│  [555-867-5309        ] │
│  Street Address         │
│  [742 Evergreen Terrace]│
│  City                   │
│  [Springfield         ] │
│  State          ZIP     │
│  [IL    ]    [62704   ] │
│                         │
│  INSURANCE              │
│  Provider               │
│  [BlueCross BlueShield] │
│  Member ID              │
│  [BCBS-9948821        ] │
│  Group ID               │
│  [GRP-40012           ] │
│                         │
│  EMERGENCY CONTACT      │
│  Name                   │
│  [Jordan Rivera       ] │
│  Phone                  │
│  [555-234-5678        ] │
│                         │
│  [  Scan QR Code  ]     │  ← primary CTA, large button
│                         │
│  ─────────────────────  │
│  ⚠️ Demo mode           │
│  Vault data is fictional│
└─────────────────────────┘
```

**Screen 2: Approval Request** (shown after QR scan)
```
┌─────────────────────────┐
│  ← Back                 │
│                         │
│  📋 Data Request        │
│                         │
│  Dr. Smith's Office     │
│  Patient Intake Form    │
│                         │
│  Requesting access to:  │
│  ─────────────────────  │
│  Identity               │
│  ✓ Full Name            │
│  ✓ Date of Birth        │
│                         │
│  Contact                │
│  ✓ Street Address       │
│  ✓ City / State / ZIP   │
│  ✓ Mobile Phone         │
│  ✓ Email Address        │
│                         │
│  Insurance              │
│  ✓ Insurance Provider   │
│  ✓ Member ID            │
│  ✓ Group ID             │
│                         │
│  Emergency              │
│  ✓ Emergency Contact    │
│                         │
│  (each field has a      │
│   toggle to exclude it) │
│                         │
│  [    Approve    ]      │  ← green, full width
│  [     Deny      ]      │  ← outlined/destructive
└─────────────────────────┘
```

**Screen 3: Confirmation** (shown after approve/deny)
```
┌─────────────────────────┐
│                         │
│        ✅               │
│                         │
│  Shared successfully    │
│                         │
│  Sent to:               │
│  Dr. Smith's Office     │
│                         │
│  13 fields shared       │
│  July 18, 2026 14:32    │
│                         │
│  Fields sent:           │
│  • Full Name            │
│  • Date of Birth        │
│  • ...                  │
│                         │
│  [  Back to Vault  ]    │
│                         │
└─────────────────────────┘
```

### Vault State — Editable Input Fields

The vault is an in-memory JS object initialised with demo defaults. Every `<input>` on Screen 1 is bound to it via `oninput` — no submit button, no form action. The object is the live source of truth; whatever the fields contain at the moment the user taps Approve is what gets encrypted and sent.

**Initial state (hardcoded defaults):**

```javascript
// Initialised once on page load. Mutated directly by input handlers.
const vaultState = {
  'me:identity:name:first':            'Alex',
  'me:identity:name:last':             'Rivera',
  'me:identity:name:full':             'Alex Rivera',  // keep in sync with first+last
  'me:identity:dob':                   '1985-04-12',
  'me:contact:email:primary':          'alex.rivera@example.com',
  'me:contact:phone:mobile':           '555-867-5309',
  'me:contact:address:street':         '742 Evergreen Terrace',
  'me:contact:address:city':           'Springfield',
  'me:contact:address:state':          'IL',
  'me:contact:address:zip':            '62704',
  'me:health:insurance:provider':      'BlueCross BlueShield',
  'me:health:insurance:member_id':     'BCBS-9948821',
  'me:health:insurance:group_id':      'GRP-40012',
  'me:health:emergency_contact:name':  'Jordan Rivera',
  'me:health:emergency_contact:phone': '555-234-5678',
};
```

**Input binding pattern:**

```javascript
// Each input element has a data-nmf attribute matching a vaultState key.
// A single handler covers all fields.
document.querySelectorAll('input[data-nmf]').forEach(input => {
  input.value = vaultState[input.dataset.nmf] ?? '';
  input.addEventListener('input', () => {
    vaultState[input.dataset.nmf] = input.value;
    // Special case: keep me:identity:name:full in sync if first or last changes
    if (input.dataset.nmf === 'me:identity:name:first' ||
        input.dataset.nmf === 'me:identity:name:last') {
      vaultState['me:identity:name:full'] =
        `${vaultState['me:identity:name:first']} ${vaultState['me:identity:name:last']}`.trim();
    }
  });
});
```

**HTML pattern for each input:**

```html
<label class="vault-field">
  <span class="vault-field__label">Full Name</span>
  <input type="text" data-nmf="me:identity:name:full" autocomplete="name" />
</label>
```

Note: `me:identity:name:full` is the only field with a separate input (rather than being derived). The binding above keeps it in sync with first+last automatically, but also lets the demoer type a full name directly if they prefer.

**Demo talking point:** Before tapping Approve, the demoer changes "Alex Rivera" to their own name (or any name). The form on the laptop fills with exactly that value. This makes the source-of-truth argument tangible — the data came from the phone, typed seconds ago, and arrived on a machine that never knew it existed.

### QR Scanner Implementation

Use `jsQR` from CDN:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.min.js"></script>
```

Scanner flow:
1. User taps "Scan QR Code" button
2. App requests camera permission via `getUserMedia({ video: { facingMode: 'environment' } })`
3. If permission denied: show clear error with instructions to allow camera in browser settings
4. Show live video preview (full-width, 1:1 aspect ratio)
5. On each animation frame, draw video to hidden canvas, call `jsQR(imageData, width, height)`
6. On successful decode: stop camera, parse JSON, validate structure and `expires_at`
7. If QR is expired (current time > `expires_at`): show error "QR code has expired — please refresh the form page"
8. If valid: transition to Screen 2 (approval)

### App JavaScript Flow

```
SCREEN 1 (Vault Home):
1. On load: render DEMO_VAULT fields in summary card
2. On "Scan QR" tap: start camera scanner

QR SCAN:
3. Decode QR → parse JSON payload
4. Validate: required fields present, expires_at in future
5. resolveFields(payload.requested_fields) → expand bundles
6. Transition to Screen 2

SCREEN 2 (Approval):
7. Display payload.recipient_label as requester identity
8. Render fields grouped by NMF_FIELDS[key].group
9. Each field: toggle (on by default) + label + sensitivity indicator for 'sensitive' tier
10. [Deny] tap:
    a. Connect WebSocket to payload.relay_url?session=payload.session_id
    b. Send JSON: { type: "denied" }
    c. Disconnect
    d. Transition to Screen 3 (denial state)
11. [Approve] tap:
    a. Generate vault's ephemeral ECDH keypair
    b. Export vault public key as base64
    c. Import form's public key from payload.public_key
    d. deriveSharedKey(vault_private_key, form_public_key) → sharedKey
    e. Build data payload from toggled-on fields:
       { fields: { "me:identity:name:full": "Alex Rivera", ... } }
    f. encrypt(sharedKey, dataPayload) → { iv, ciphertext }
    g. Build relay envelope:
       {
         type:           "approved",
         app_public_key: "<vault base64 ECDH public key>",
         iv:             "<base64>",
         ciphertext:     "<base64>"
       }
    h. Connect WebSocket to payload.relay_url?session=payload.session_id
    i. Send relay envelope (JSON string)
    j. Disconnect immediately after send
    k. Transition to Screen 3 (success state)

SCREEN 3 (Confirmation):
12. Show ✅ or ❌ state
13. List fields that were shared (or show "Request denied")
14. Show timestamp
15. [Back to Vault] → return to Screen 1, clear all session state
```

---

## Component 6: Styling

Both pages must look polished and credible. This is a demo for healthcare and legal sector stakeholders — not a hackathon project.

### Design Tokens

```css
:root {
  --bg-primary:     #0f1117;
  --bg-secondary:   #1a1d27;
  --bg-card:        #21253a;
  --bg-form:        #ffffff;
  --accent:         #6c63ff;
  --accent-hover:   #5750e3;
  --success:        #22c55e;
  --warning:        #f59e0b;
  --error:          #ef4444;
  --text-primary:   #f1f5f9;
  --text-muted:     #94a3b8;
  --text-on-light:  #1e293b;
  --border:         #2d3147;
  --mono:           'JetBrains Mono', 'Fira Code', 'Courier New', monospace;
  --sans:           'Inter', system-ui, sans-serif;
  --radius:         8px;
}
```

### Key UI Details

**Form page:**
- Fields animate on population: brief `box-shadow` pulse in `--accent` color, then settle to normal
- QR code container has a slow pulsing border while waiting (CSS `@keyframes` breathing animation)
- Crypto log: dark panel (`--bg-secondary`), monospace font for all hex/base64 values, entries fade in with a 150ms CSS transition
- Ciphertext/IV values displayed in a styled `<pre>` block resembling a terminal or network inspector
- Banner at top: `⚠️ Demo mode — crypto is real, vault data is fictional`
- The crypto log subtitle: `"Everything the relay server saw is shown here."`

**App page:**
- White/light background for the form-facing screens (feels like a real mobile app, not a dev tool)
- [Approve] button: full width, `--success` background, large font, min 56px height
- [Deny] button: full width, outlined, `--error` border/text, min 56px height
- Field toggles: iOS-style toggle switches, accessible with `role="switch"`
- Sensitive fields (sensitivity: 'sensitive') get a small 🔒 icon next to their label
- Screen transitions: slide in from right on forward, slide out to right on back

---

## Running the Demo

### Prerequisites
- Node.js 18+
- Vercel CLI: `npm install -g vercel`
- A Vercel account (free tier is sufficient)

### ⚠️ Critical: SubtleCrypto requires a secure context

`crypto.subtle` is only available on `https://` or `http://localhost`. It is completely unavailable on `file://` URLs. Since this project deploys to Vercel (HTTPS), production is fine. For local development, use `vercel dev` exclusively — never open HTML files directly from the filesystem.

**The README must state this as the first instruction.**

### Local Development

```bash
# Install dependencies
npm install

# Start local dev server (handles HTTPS context correctly)
vercel dev
# → form available at: http://localhost:3000/form/
# → app available at:  http://localhost:3000/app/
# → relay at:          ws://localhost:3000/api/relay

# For cross-device testing during development:
# Use ngrok to expose localhost over HTTPS (required for camera on phone)
npx ngrok http 3000
# → use the https://xxxxx.ngrok.io URL on both devices
```

### Deploy to Vercel

```bash
# First deploy
vercel

# Subsequent deploys
vercel --prod
```

Vercel will provide a permanent public URL (e.g. `https://nomoref orms-demo.vercel.app`). Share the `/form/` URL for the form and `/app/` URL for the vault.

### Running the Demo (Live)

```
PREPARATION (before the audience arrives):
1. Open https://<your-vercel-url>/form/ on the demo laptop
2. QR code appears, crypto log starts — page is ready
3. On your phone: open https://<your-vercel-url>/app/
4. The vault home screen shows Alex Rivera's demo data

DEMO FLOW (in front of audience):
1. Show the form page — "This could be any computer in any office.
   It has no idea who you are."
2. Show the phone — "All the data lives here. On the user's device."
3. Tap "Scan QR Code" on phone, point at laptop screen
4. Phone shows approval screen — "The form asked for these 13 fields.
   The user decides what to share."
5. Tap Approve
6. Watch the form fill on the laptop in real time
7. Point to the crypto log — "This is everything the relay server saw.
   It couldn't read any of it."
8. Open DevTools → Network → WS on the laptop to show the raw frames
   (optional but powerful for technical audiences)
```

---

## What NOT to Build (Demo Scope Boundary)

| Out of scope | Why |
|---|---|
| User accounts / authentication | Demo vault is in-memory only |
| Argon2id vault key derivation | No persistent encrypted storage |
| Server-side vault storage | No user data on server of any kind |
| Recovery seed phrase | No persistent keys to recover |
| Chrome extension | Separate implementation track |
| Native iOS/Android app | Mobile web app proves the concept |
| Any backend database | Relay is purely in-memory, stateless |
| Multi-session management | One active session per form page load |
| Subscription / webhook model | Post-MVP feature |

---

## Security Notes for Demo Reviewers

Disclose these proactively to a technical audience — naming limitations builds credibility.

1. **No recipient authentication** — The phone encrypts to whatever public key is in the QR. A malicious QR could redirect data to an attacker's key. In production, recipients would have registered identities and the app would display a verified badge. For the demo, `recipient_label` provides human-readable context.

2. **Relay is unauthenticated** — Any client knowing a session ID can connect. Session IDs are 4 random bytes (4 billion possibilities) and expire with the QR (5 min). Sufficient for a demo; production uses short-lived signed tokens.

3. **Demo vault is plaintext in JS memory** — `DEMO_VAULT` is unencrypted. In production, vault data is encrypted at rest with Argon2id-derived keys and never exists in plaintext outside the device. This demo isolates session crypto (the real claim) from vault crypto (a separate concern).

4. **SubtleCrypto requires HTTPS** — `crypto.subtle` is unavailable on `file://`. Always use `vercel dev` locally or the deployed Vercel URL. This is the most common setup mistake — document it prominently.

5. **P-256 vs Curve25519** — P-256 is used because it has universal SubtleCrypto browser support with no libraries. Some cryptographers prefer Curve25519 (Signal, WireGuard). Production can upgrade to libsodium (X25519 + ChaCha20-Poly1305) without changing the protocol design.

6. **In-memory relay state** — Vercel serverless functions may run as multiple instances. Session state is in-memory per instance, so two clients might land on different instances and miss each other's messages. For a demo with one pair of devices this is unlikely to cause issues; if it does, use a single persistent WebSocket server (Railway, Render free tier) as the relay instead.

---

## Suggested Enhancements After Initial Build

In rough priority order:

1. **DevTools callout** — Add a tooltip on the crypto log: "Open DevTools → Network → WS to see the raw frames the relay forwarded." Most powerful proof for technical audiences.
2. **Partial approval** — User unchecks a field before approving; form receives only the approved subset; log shows which fields were excluded. Directly demonstrates granular control.
3. **QR expiry countdown** — Show a timer below the QR counting down to refresh. Reinforces that sessions are ephemeral.
4. **Deny flow polish** — Form page shows a clear "Request denied by user" state with timestamp in the crypto log.
5. **Exportable audit JSON** — After submission, form offers "Download audit log as JSON" — a file containing the session ID, timestamp, field list, and the ciphertext blob (proof of what was transmitted).
6. **Persistent relay on Railway** — If Vercel Edge WebSocket reliability is an issue in practice, deploy the relay to Railway free tier (persistent Node.js process, no cold starts, reliable WebSocket support) and keep form + app on Vercel static.
