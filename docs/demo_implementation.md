# NoMoreForms — Demo Implementation Plan

**Purpose:** Break the demo build (per `NoMoreForms_Demo_Implementation_Spec.md`) into small, independently-verifiable phases so it can be built incrementally across multiple sessions — never one-shotting the whole thing.

> **Architecture decision (updated during Phase 3):** The spec assumed a Vercel deployment with the relay as a Vercel Edge Function. That doesn't work — **Vercel Functions cannot host a WebSocket server** (request/response only, no upgrade support, Edge has a 25s cap). We swapped the whole demo to a **single Node service (`server.js`) deployed on Render**, which serves the static pages *and* hosts the `ws` relay from one process. Wherever this doc says "Vercel", read "Render single Node service". `public/`, `fields.js`, and `crypto.js` are unaffected by the swap.

**How to use this doc:**
- Work one phase at a time, top to bottom. Each phase has a **Goal**, the **Files** it touches, **Steps**, and a **Done when** checklist.
- Each phase leaves the app in a working (if incomplete) state — commit at the end of every phase.
- Later phases assume earlier ones are complete. The **Depends on** line makes the graph explicit.
- The authoritative source for *what* to build is `NoMoreForms_Demo_Implementation_Spec.md`. This doc is the *order and chunking*. When a phase says "implement X per spec §N", copy the exact code/values from the spec rather than reinventing.

---

## Global constraints (read once, applies everywhere)

1. **SubtleCrypto needs a secure context.** `crypto.subtle` only exists on `https://` or `http://localhost`. It is `undefined` on `file://`. **Never** open the HTML files directly — always use `vercel dev` (localhost is a secure context) or the deployed Vercel URL. This is the single most common failure mode.
2. **Relay transport — RESOLVED.** Vercel Functions cannot host a WebSocket server, so the relay runs in a persistent Node `ws` server. We fold it into the same `server.js` that serves the static pages, deployed on Render. The crypto layer is identical regardless of transport, so this choice never touches Phases 2/4/5/6/7.
3. **Cross-device testing needs HTTPS.** Camera access (`getUserMedia`) requires a secure context on the phone. For local cross-device testing use `npx ngrok http 3000`; otherwise test on the deployed URL.
4. **Vanilla stack.** No frameworks, no bundler. Plain HTML/CSS/JS + two CDN libs (`qrcodejs` for the form, `jsQR` for the app). `crypto.js` and `fields.js` are shared verbatim.
5. **Relay is blind by contract.** It routes by session ID and never parses or logs message content. Any code that makes the relay inspect payloads is a bug against the core pitch.

---

## Dependency graph

```
Phase 0  Scaffold + deploy pipeline
   │
   ├─► Phase 1  Shared fields (fields.js)         [independent, pure data]
   │
   ├─► Phase 2  Crypto helpers + round-trip test  [independent, foundational]
   │
   └─► Phase 3  Relay server + connectivity test  [independent; DE-RISK EARLY]
              │
   ┌──────────┴───────────────┐
   ▼                          ▼
Phase 4  Form page       Phase 5  App page
 (needs 1,2,3)            static vault (needs 1)
   │                          │
   │                          ▼
   │                     Phase 6  App scanner + approval (needs 1,2)
   │                          │
   └──────────┬───────────────┘
              ▼
        Phase 7  End-to-end encrypted exchange  (integration; needs 3,4,6)
              │
              ▼
        Phase 8  Audit log + confirmation + polish/animations
              │
              ▼
        Phase 9  Optional enhancements
              │
              ▼
        Phase 10 Deploy + cross-device dress rehearsal
```

Phases 1, 2, 3 can be done in any order (or parallel). Phases 4 and 5–6 can proceed in parallel once their deps are met. Phase 7 is the join point.

---

## Phase 0 — Scaffolding & deploy pipeline

**Goal:** An empty-but-deployable skeleton. `vercel dev` serves placeholder `/form/` and `/app/` pages over a secure context. First deploy to Vercel succeeds.

**Depends on:** nothing.

**Files:**
```
package.json
vercel.json
README.md
public/form/index.html      (placeholder: "Form — coming soon")
public/app/index.html        (placeholder: "App — coming soon")
public/shared/               (empty dir, .gitkeep)
api/                         (empty dir, .gitkeep)
.gitignore                   (node_modules, .vercel, .env)
```

**Steps:**
1. Create the repo structure from spec §Repository Structure.
2. `package.json` and `vercel.json` verbatim from spec §Component 1 (rewrites route `/api/relay`, `/form/(.*)`, `/app/(.*)`).
3. Placeholder `index.html` in `form/` and `app/` — just enough to confirm routing works.
4. `README.md` stub whose **first instruction** is the `vercel dev` / secure-context warning (spec §Running the Demo).
5. Run `vercel dev`, confirm both routes load. Do a first `vercel` deploy to establish the project + URL.

**Done when:**
- [ ] `vercel dev` serves `http://localhost:3000/form/` and `/app/`.
- [ ] `crypto.subtle` is defined in the browser console on both (proves secure context).
- [ ] `vercel` deploy succeeds and the public URL loads both routes.
- [ ] README leads with the secure-context / `vercel dev` warning.

---

## Phase 1 — Shared field definitions (`fields.js`)

**Goal:** The single source of truth for the NMF namespace, bundles, and `resolveFields()` — loadable by both pages.

**Depends on:** Phase 0.

**Files:** `public/shared/fields.js`

**Steps:**
1. Copy `NMF_FIELDS`, `NMF_BUNDLES`, and `resolveFields()` **verbatim** from spec §Component 2.
2. Expose as globals (plain `<script src>` include, no modules).

**Done when:**
- [ ] Load `fields.js` via a scratch `<script>` tag; in console `resolveFields(['bundle:patient_intake'])` returns the 13 expanded, de-duplicated field keys.
- [ ] `NMF_FIELDS['me:health:insurance:member_id'].sensitivity === 'sensitive'`.

---

## Phase 2 — Crypto helpers + round-trip test harness

**Goal:** A correct, self-contained `crypto.js` proven to do a full ECDH→HKDF→AES-GCM round trip. This is the foundation everything else trusts — get it right in isolation before wiring any UI.

**Depends on:** Phase 0 (secure context).

**Files:**
- `public/form/crypto.js`
- `public/app/crypto.js` (identical copy)
- (temporary) `public/form/crypto-test.html` — throwaway harness, delete after this phase.

**Steps:**
1. Copy `crypto.js` **verbatim** from spec §Component 3 (`generateKeypair`, `exportPublicKey`, `importPublicKey`, `deriveSharedKey`, `encrypt`, `decrypt`, `truncate`).
2. Write a tiny test harness that simulates both parties in one page:
   - Generate keypair A and keypair B.
   - Export/import both public keys through base64 (exercises the transport encoding).
   - `deriveSharedKey(A.priv, B.pub)` and `deriveSharedKey(B.priv, A.pub)` → encrypt with one, decrypt with the other.
   - Assert the decrypted object deep-equals the original `{ fields: {...} }`.
3. Keep `crypto.js` byte-identical in both `form/` and `app/`. Add a note/checklist item to re-sync both copies whenever one changes (or symlink during dev).

**Done when:**
- [ ] Round-trip test: `deriveSharedKey` from both directions yields keys that encrypt/decrypt each other's payloads.
- [ ] `truncate()` shortens long base64 and leaves short strings alone.
- [ ] Tampering with one byte of the ciphertext makes `decrypt` throw (AES-GCM auth) — confirms integrity.
- [ ] `form/crypto.js` and `app/crypto.js` are identical (`diff` is empty).
- [ ] Test harness deleted (or clearly marked temporary and git-ignored).

---

## Phase 3 — Relay server + connectivity test  ⚠️ DE-RISK EARLY

**Goal:** A blind, session-scoped WebSocket relay running both under `vercel dev` **and on a real Vercel deploy**. This phase exists early specifically to surface Vercel Edge WS problems before they can block the integration.

**Depends on:** Phase 0.

**Files:** `api/relay.js`

**Steps:**
1. Implement per spec §Component 1 "Relay Behavior":
   - `export const config = { runtime: 'edge' }`.
   - Accept `?session=<id>`; maintain `session_id → Set<socket>`.
   - On message: broadcast to **other** peers in the same session only. Never parse/log content.
   - On disconnect: clean up the session map.
   - Console-log **only** session ID, connect/disconnect, and message byte size — never content.
2. Write a throwaway two-tab test (or a small `wscat`/script): two clients on the same `?session=abc` see each other's messages; a client on `?session=xyz` does not.
3. **Deploy to Vercel and repeat the same test on the public URL.** If Edge WS is unreliable, invoke the fallback now (Ably/Pusher free tier, or Node `ws` on Railway/Render) and document the chosen transport + URL in the README. Record the final `relay_url` — Phase 4 hardcodes it into the QR payload.

**Done when:**
- [ ] Two clients with the same session ID exchange messages locally.
- [ ] Two clients with **different** session IDs are isolated (no cross-talk).
- [ ] Disconnecting one peer doesn't disturb the other.
- [ ] Vercel function logs show **only** session IDs / events / byte sizes — zero payload content.
- [ ] The **deployed** relay passes the same tests (or the fallback transport is chosen, working, and documented).
- [ ] Final `relay_url` recorded for Phase 4.

---

## Phase 4 — Form page: static UI, QR, and setup-half crypto log

**Goal:** The form page renders its two-column layout, generates a session + ECDH keypair, renders the QR, connects to the relay, and shows the crypto log up through "Awaiting approval…". It does **not** yet receive or decrypt data (that's Phase 7).

**Depends on:** Phases 1, 2, 3.

**Files:**
- `public/form/index.html`
- `public/form/qr.js`
- `public/form/style.css`
- (uses `form/crypto.js`, `/shared/fields.js`)

**Steps:**
1. Build the desktop two-column layout from spec §Component 4: form (left ~55%), crypto log (right ~45%). Include the `⚠️ Demo mode` banner and the log subtitle *"Everything the relay server saw is shown here."*
2. Add all form inputs with correct `id`, NMF key mapping, and `autocomplete` from spec §"Form Fields and NMF Namespace Mapping". All fields `readonly` / styled "locked/waiting".
3. Implement `qr.js` using CDN `qrcodejs` (spec §"QR Code Content"). Build the QR payload JSON exactly per spec (session_id = 4 random bytes hex, public_key base64, `requested_fields: ["bundle:patient_intake"]`, hardcoded `relay_url` from Phase 3, `recipient_label`, `expires_at` = now + 5 min).
4. Implement a `logEntry({icon, time, label, detail})` helper that renders entries into the scrollable log panel (✅/⏳/❌, `HH:MM:SS`, monospace detail blocks, fade-in).
5. Wire the `DOMContentLoaded` flow steps 1a–1h from spec §"Form Page JavaScript Flow": session → keypair → export pubkey → expires_at → QR → **connect WebSocket** → "Awaiting approval…". Emit log entries 1–5 from spec §"Crypto Log Panel".
6. Implement QR expiry/refresh (flow step 3): after 5 min regenerate session + keypair + QR, reconnect WS, log "Session refreshed".

**Done when:**
- [ ] Page renders the two-column layout with a scannable QR containing valid JSON (decode it manually to confirm all six keys).
- [ ] Crypto log shows entries 1–5 in order, with a truncated public key and the field count.
- [ ] The WebSocket connects to the relay (visible in DevTools → Network → WS) and the log reads "Awaiting approval…".
- [ ] After 5 minutes the QR + session refresh and reconnect (can temporarily shorten the timeout to verify).
- [ ] No decryption logic yet — receiving is Phase 7.

---

## Phase 5 — App page: static vault + screen navigation

**Goal:** The mobile vault renders Screen 1 with editable, bound fields and can navigate between all three screens manually (no scanning/crypto yet).

**Depends on:** Phase 1.

**Files:**
- `public/app/index.html`
- `public/app/style.css`
- (uses `/shared/fields.js`; `app/crypto.js` present but unused this phase)

**Steps:**
1. Build the mobile-first shell from spec §Component 5 "Critical Design Constraints": max-width 420px, ≥48px touch targets, no hover states, white/light form-facing screens.
2. Implement the three screens as a single page with show/hide transitions (slide in/out per spec §Component 6): Screen 1 Vault/Home, Screen 2 Approval, Screen 3 Confirmation.
3. Screen 1: render every field grouped (Identity / Contact / Insurance / Emergency) as editable `<input data-nmf="…">`. Initialize `vaultState` from spec defaults and wire the single `input[data-nmf]` binding handler, including the `me:identity:name:full` first+last sync (spec §"Vault State").
4. Add the large "Scan QR Code" CTA (wire to a stub for now), the `⚠️ Demo mode — vault data is fictional` footer.
5. Screen 2 / Screen 3: build the static layouts (grouped field list w/ toggles, Approve/Deny buttons; confirmation with ✅, recipient, field list, timestamp, "Back to Vault"). Wire temporary buttons to move between screens so the full UI is walkable without a scan.

**Done when:**
- [ ] Screen 1 shows all fields with correct defaults; editing an input mutates `vaultState` (verify in console), and editing first/last updates `full`.
- [ ] All three screens are reachable via temporary nav and look correct at 390px width (iPhone) and on Android Chrome.
- [ ] Sensitive fields show the 🔒 indicator; toggles use `role="switch"`.
- [ ] No camera/crypto yet.

---

## Phase 6 — App: QR scanner + approval screen population

**Goal:** Tapping "Scan QR Code" opens the camera, decodes a real QR from the Phase 4 form, validates it, and drives a correctly-populated approval screen (Screen 2). Still no encryption/relay send (Phase 7).

**Depends on:** Phases 1, 2, 5. (Best tested against a live Phase 4 form.)

**Files:** `public/app/scanner.js`, edits to `public/app/index.html`

**Steps:**
1. Add CDN `jsQR`. Implement the scanner flow from spec §"QR Scanner Implementation": `getUserMedia({ video: { facingMode: 'environment' }})`, live 1:1 preview, per-frame draw to hidden canvas → `jsQR(...)`.
2. Handle permission denial gracefully with clear instructions (spec step 3).
3. On decode: stop camera, `JSON.parse`, validate required keys present and `expires_at` in the future. Show "QR code has expired…" if stale (spec steps 6–7).
4. On valid QR: `resolveFields(payload.requested_fields)` to expand bundles, then transition to Screen 2 and render per spec §"App JavaScript Flow" steps 7–9: show `recipient_label`, group fields by `NMF_FIELDS[key].group`, each with a default-on toggle and 🔒 for sensitive tier.

**Done when:**
- [ ] Scanning the live Phase 4 form QR decodes and lands on Screen 2 with all 13 fields grouped correctly.
- [ ] Expired QR (temporarily set `expires_at` in the past) shows the expiry error.
- [ ] Denying camera permission shows a helpful message, not a silent failure.
- [ ] Toggles default on; sensitive fields flagged. No relay traffic yet.

---

## Phase 7 — End-to-end encrypted exchange (integration)

**Goal:** The full loop works: Approve on the phone → encrypt → relay → form decrypts → fields fill. Deny works too. This is the payoff phase.

**Depends on:** Phases 3, 4, 6.

**Files:** edits to `public/app/index.html` (approve/deny handlers) and `public/form/index.html` (WS message handler).

> **Name-field model (decided in Phase 5):** `first`/`last` are atomic; `me:identity:name:full` is **computed** and acts as a permission bundle that shares `first` + `last` + computed `full`. Use `buildSharePayload(grantedKeys, vaultState)` (in `fields.js`) to assemble the payload — it expands composites and computes `full`. The form then fills its first/last inputs **directly** from the shared atomic values. **Do NOT split `full` on spaces** — that lossy workaround is obsolete. See memory `name-field-composite-model`.

**Steps — App side** (spec §"App JavaScript Flow" steps 10–11):
1. **Deny:** connect WS to the relay for `payload.session_id`, send `{ type: "denied" }`, disconnect, go to Screen 3 denial state.
2. **Approve:** generate vault ephemeral keypair → export pubkey → import form's pubkey → `deriveSharedKey` → `const fields = buildSharePayload(selectedFields(), vaultState)` (toggled-on grants only) → `encrypt({ fields })` → build envelope `{ type:"approved", app_public_key, iv, ciphertext }` → connect WS → send → disconnect → Screen 3 success.

**Steps — Form side** (spec §"Form Page JavaScript Flow" step 2):
3. On WS message: parse envelope. If `type==="denied"` → show denial state + log entry, stop.
4. Otherwise: log receipt with truncated IV + ciphertext and the note *"this is all the relay ever saw"* (log entry 7) → import `app_public_key` → `deriveSharedKey` (entry 8) → note AES key derived (entry 9) → `decrypt` (entry 10, *"server never held plaintext"*) → for each `key → value` in `fields`, populate the input with matching `data-nmf` (first/last fill directly; `full`/emergency have no form input and are simply ignored) (entry 11) → wait ~1500ms → inline success state (entry 12).

**Done when:**
- [ ] Approve on phone fills the laptop form in real time with exactly the vault values.
- [ ] Editing a vault value (e.g. the name) before approving changes what fills — the source-of-truth demo talking point works.
- [ ] Unchecking a field before approve omits it from the fill (partial approval basic path).
- [ ] Deny shows a "Request denied by user" state on the form with a log entry.
- [ ] DevTools → Network → WS on the laptop shows only the ciphertext envelope — no plaintext anywhere.
- [ ] Crypto log entries 7–11 render with truncated IV/CT and the two "relay was blind" / "server never held plaintext" notes.

---

## Phase 8 — Audit log, confirmation detail & visual polish

**Goal:** Bring it to "credible demo for healthcare/legal stakeholders" quality (spec §Component 6). Finish the log tail and confirmation, add animations.

**Depends on:** Phase 7.

**Steps:**
1. **Form:** log entry 12 "Form submitted" and entry 13 "Audit event logged — [timestamp] [field list]". Field-population animation: brief `--accent` box-shadow pulse then settle (spec §Component 6 "Form page").
2. **Form:** QR container breathing/pulsing border while waiting; terminal-styled `<pre>` blocks for IV/CT; entries fade in (150ms).
3. **App:** Screen 3 confirmation fully populated — ✅/❌, recipient, "N fields shared", formatted timestamp, bulleted field list, "Back to Vault" clears session state and returns to Screen 1 (spec flow steps 12–15). Approve/Deny button sizing (≥56px), iOS-style toggles, slide transitions.
4. Apply the shared design tokens (`:root` vars from spec §Component 6) consistently across both pages.
5. Cross-check both pages against the spec ASCII mockups for layout parity.

**Done when:**
- [ ] Fields visibly pulse as they populate; QR breathes while waiting.
- [ ] Crypto log ends with "Form submitted" and "Audit event logged" including the field list.
- [ ] Confirmation screen shows recipient, count, timestamp, and the exact fields shared; "Back to Vault" fully resets state.
- [ ] Both pages use the design tokens; dark terminal aesthetic on the form log, polished light UI on the app.

---

## Phase 9 — Optional enhancements (pick by demo value)

**Depends on:** Phase 8. Do only what raises demo impact; each is self-contained.

From spec §"Suggested Enhancements", rough priority:
1. **DevTools callout** tooltip on the crypto log ("Open DevTools → Network → WS…").
2. **Partial approval polish** — log which fields were excluded when toggled off.
3. **QR expiry countdown** timer under the QR.
4. **Deny flow polish** — richer denied state + timestamped log entry.
5. **Exportable audit JSON** — "Download audit log" (session ID, timestamp, field list, ciphertext blob).
6. **Persistent relay on Railway** — only if Vercel Edge WS proved flaky in Phase 3/10.

**Done when:** each chosen enhancement works without regressing Phase 7/8.

---

## Phase 10 — Deploy & cross-device dress rehearsal

**Goal:** Prove the demo on two real devices on different networks, exactly as it'll be presented.

**Depends on:** Phase 8 (Phase 9 optional).

**Steps:**
1. `vercel --prod`. Confirm `/form/`, `/app/`, and the relay all work on the public URL.
2. Run the full spec §"Running the Demo (Live)" script: laptop opens `/form/`, phone opens `/app/`, scan → approve → fill.
3. Verify the four relay guarantees from spec §Component 1 "What to verify": cross-network exchange works; content never logged (check Vercel logs); disconnect isolation; session scoping.
4. Confirm the security-notes talking points (spec §"Security Notes") are all demonstrable/answerable live.
5. Finalize README: secure-context warning first, run/deploy instructions, chosen relay transport, and the demo script.

**Done when:**
- [ ] Laptop + phone on different networks complete the full flow on the production URL.
- [ ] Vercel function logs contain zero payload content across a full run.
- [ ] The DevTools WS-frames reveal works for a technical audience.
- [ ] README is complete and leads with the secure-context warning.

---

## Out of scope (do not build — spec §"What NOT to Build")

Accounts/auth, Argon2id vault KDF, server-side vault storage, recovery seed phrase, Chrome extension, native apps, any database, multi-session management, subscription/webhook model. The demo vault is in-memory and plaintext **by design** — it isolates the *session crypto* (the real claim) from *vault crypto* (a separate production concern).
