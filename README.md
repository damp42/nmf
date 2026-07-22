# NoMoreForms — Demo

A two-device demo proving the NoMoreForms concept with **real asymmetric cryptography**: a public form holds zero personal data, a phone holds all of it, and they exchange it over an encrypted WebSocket relay that is provably blind to the content.

> ## ⚠️ Read this first: SubtleCrypto requires a secure context
>
> The demo relies on the browser's Web Crypto API (`crypto.subtle`), which **only exists on `https://` or `http://localhost`**. It is `undefined` on `file://` URLs and the demo will not work.
>
> **Never open the HTML files directly from disk.** Run the local server (`npm start`, which serves `http://localhost` — a secure context) or use the deployed HTTPS URL. This is the single most common setup mistake.

---

## Architecture

One Node service does everything — it serves the static pages **and** hosts the blind WebSocket relay, from a single process on a single host (Render). No separate relay service, no framework, no bundler.

```
          ┌──────────── one Node service (server.js) ────────────┐
 laptop   │  GET /          → landing page                        │
 (form)   │  GET /form/     → recipient form page                 │   phone
          │  GET /app/      → mobile vault app                     │   (vault)
          │  WS  /api/relay → blind ciphertext relay (session-scoped)
          └───────────────────────────────────────────────────────┘
```

The relay routes by session ID only and **never parses or logs message content** — only session IDs, connect/disconnect events, and byte sizes. Same-origin, so `wss://` needs no CORS.

> **Why not Vercel?** Vercel Functions (Edge or Serverless) are request/response only and cannot host a WebSocket server. A single persistent Node process on Render serves the static pages and the relay together — simpler, and it makes the relay genuinely *our* blind pipe.

## Structure

```
server.js                 # Node service: static file server + blind ws relay
public/
  index.html              # Landing page (links to form + app)
  shared/fields.js        # NMF namespace, bundles, name-composite model
  form/
    index.html            # Recipient form + live crypto log
    crypto.js             # ECDH P-256 + HKDF + AES-256-GCM helpers
    qr.js                 # QR rendering (qrcode-generator)
    style.css
  app/
    index.html            # Mobile vault: vault / scanner / approval / confirm
    crypto.js             # identical copy of form/crypto.js
    scanner.js            # camera QR scanning (jsQR) + payload validation
    style.css
package.json              # one dependency: ws
docs/                     # specs + phased implementation plan
```

The two `crypto.js` copies are intentionally identical (kept in sync by hand); QR
libraries load from CDN, so `ws` is the only npm dependency.

## Local development

Requires Node.js 18+.

```bash
npm install
npm start
# → landing: http://localhost:3000/
# → form:    http://localhost:3000/form/
# → app:     http://localhost:3000/app/
# → relay:   ws://localhost:3000/api/relay?session=<id>
```

`localhost` is a secure context even over plain HTTP, so `crypto.subtle` works locally with no certificate. WebSocket scheme follows the page automatically: `ws://` on localhost, `wss://` on Render.

For cross-device testing on your LAN, the phone's camera + crypto need HTTPS — your machine's `http://192.168.x.x` is **not** a secure context. Use ngrok, or just test on the deployed Render URL:

```bash
npx ngrok http 3000   # use the https://xxxx.ngrok.io URL on both devices
```

## Deploy (Render)

Render is connected to this GitHub repo and auto-deploys on push to `main`:

- **Build command:** `npm install`
- **Start command:** `npm start`
- **Instance type:** Free (note: free web services sleep after ~15 min idle; the first request wakes them with a cold start — pre-warm before a live demo).

Render provides HTTPS + WSS automatically, satisfying the secure-context requirement in production.

## Running the demo (live)

**Before the audience arrives** (free tier sleeps when idle — this also pre-warms it):

1. Laptop: open `https://<your-service>.onrender.com/form/` — the QR appears and the crypto log fills to "⏳ Awaiting approval…".
2. Phone: open `https://<your-service>.onrender.com/app/` — the vault shows the fictional demo data.

**In front of the audience:**

1. Show the form — *"This could be any computer in any office. It has no idea who you are."*
2. Show the phone — *"All the data lives here, on the user's device."*
3. *(optional)* Edit the **First/Last name** on the phone — makes the source-of-truth point tangible.
4. Tap **Scan QR Code**, point at the laptop → the approval screen lists exactly what's requested.
5. *(optional)* Toggle a field off to show granular control, or tap **Deny** to show refusal.
6. Tap **Approve** → the laptop form fills in real time; the crypto log completes through decrypt → submitted → audit.
7. Point at the crypto log — *"This is everything the relay server saw. It couldn't read any of it."*
8. *(technical audiences)* Laptop DevTools → Network → WS → click the frame to show the raw ciphertext that crossed the wire.

## What the demo proves

| Claim | How it's shown |
|---|---|
| Real asymmetric crypto | ECDH P-256 keypair generated live, logged |
| Zero-knowledge relay | Relay log + WS frames show only ciphertext; it forwards the same blob it received |
| MITM resistance | Shared key needs both private keys; neither is transmitted |
| User approval gate | Nothing moves until the user approves on their device |
| Granular control | Per-field toggles; withheld fields never leave the phone (and the relay can't even tell which were withheld) |
| Client-side decryption | Form fills only after in-browser decrypt; server never held plaintext |

## Security notes (disclose these to a technical audience — naming limits builds credibility)

1. **No recipient authentication.** The phone encrypts to whatever public key is in the QR; a malicious QR could redirect data. Production would use registered recipient identities + a verified badge. For the demo, `recipient_label` provides human context.
2. **Relay is unauthenticated.** Any client with the session ID can connect. Session IDs are 4 random bytes and expire with the QR (5 min). Production would use short-lived signed tokens.
3. **Demo vault is plaintext in JS memory — by design.** This isolates *session crypto* (the real claim) from *vault-at-rest crypto* (a separate production concern: Argon2id-derived keys, encrypted storage).
4. **P-256, not Curve25519.** Chosen for universal SubtleCrypto support with zero libraries. Production could upgrade to libsodium (X25519 + ChaCha20-Poly1305) without changing the protocol shape.
5. **Secure context required.** `crypto.subtle` and the camera need HTTPS or `localhost` — never `file://`.

## Status

Functionally complete and verified end-to-end on two devices. Built incrementally per [`docs/demo_implementation.md`](docs/demo_implementation.md).
