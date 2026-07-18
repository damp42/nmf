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
server.js               # Node service: static file server + ws relay
public/
  index.html            # Landing page
  form/                 # Recipient form page (Phase 4)
  app/                  # Mobile vault app (Phases 5–6)
  shared/fields.js      # Shared NMF namespace definitions (Phase 1)
package.json
docs/                   # Specs + phased implementation plan
```

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
