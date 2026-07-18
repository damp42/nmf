# NoMoreForms — MVP Product Specification
**Working Title:** NoMoreForms  
**Version:** 0.1 (Prototype Spec)  
**Status:** Draft for discussion  
**Last Updated:** March 2026

---

## 1. The Problem

Every year, millions of people fill out the same forms — name, address, date of birth, insurance info, emergency contacts — over and over, for the same institutions, sometimes on the same visit. The information doesn't change. The frustration does.

Healthcare intake. Mortgage applications. Legal retainers. Bank onboarding. The data is identical. The experience is identical. The waste is enormous — and entirely avoidable.

NoMoreForms is a user-controlled personal data vault that lets you share exactly what a recipient needs, nothing more, through a single approval gesture — with a full audit log of who got what and when.

---

## 2. Core Principles

These are non-negotiable and inform every architectural and UX decision:

1. **Zero-knowledge server** — The server never holds plaintext data or a key that can decrypt it. Ever.
2. **User sovereignty** — The user decides what to share, with whom, at what granularity, and for how long. They can revoke at any time.
3. **No recipient install required (for MVP)** — A doctor's office, law firm, or gym shouldn't need to adopt new software to receive data.
4. **Audit by default** — Every share event is logged: who requested it, what fields were included, when it was created, and when it expired or was revoked.
5. **Granularity over convenience** — It's better to make sharing explicit and scoped than fast and broad.

---

## 3. The Data Model — Namespace Schema

All personal data is organized into a hierarchical namespace. This schema is the foundational data contract for the entire system.

### 3.1 Format

```
me:{category}:{subcategory}:{field}
```

Fields can be requested individually or via wildcards and named bundles.

### 3.2 Core Namespace Examples

```
me:identity:name:first
me:identity:name:last
me:identity:name:full
me:identity:dob
me:identity:ssn:last4
me:identity:ssn:full          ← high-sensitivity, requires explicit grant

me:contact:email:primary
me:contact:phone:mobile
me:contact:phone:home
me:contact:address:street
me:contact:address:city
me:contact:address:state
me:contact:address:zip
me:contact:address:full        ← named aggregation

me:payment:card:primary:last4
me:payment:card:primary:full   ← high-sensitivity
me:payment:bank:routing
me:payment:bank:account

me:health:insurance:provider
me:health:insurance:member_id
me:health:insurance:group_id
me:health:insurance:full       ← named aggregation
me:health:emergency_contact:name
me:health:emergency_contact:phone

me:legal:signature             ← future
me:legal:id:drivers_license    ← future
```

### 3.3 Wildcards and Named Bundles

| Syntax | Meaning |
|--------|---------|
| `me:contact:address:*` | All fields under address |
| `me:health:insurance:full` | Predefined bundle: all insurance fields |
| `me:identity:basic` | Predefined bundle: name + dob + email |
| `bundle:patient_intake` | Named bundle defined by recipient or standard |

Named bundles serve two purposes: UX simplicity (user sees "Patient Intake" not 9 field names) and eventual standardization (healthcare providers agree on what `bundle:patient_intake` contains, similar to how schema.org works for the web).

### 3.4 Sensitivity Tiers

| Tier | Examples | Behavior |
|------|---------|---------|
| **Standard** | Name, address, email | Single approval |
| **Sensitive** | SSN last 4, insurance ID | Requires explicit check |
| **Restricted** | SSN full, payment card full | Requires explicit unlock + confirmation |

---

## 4. System Architecture

### 4.1 Components

```
┌─────────────────────────────────────────────────────────┐
│                      USER DEVICES                        │
│                                                          │
│  ┌──────────────┐          ┌──────────────────────────┐ │
│  │  Mobile App  │          │    Chrome Extension       │ │
│  │  (vault +    │          │    (autofill + approval   │ │
│  │   approval)  │          │     on desktop)           │ │
│  └──────┬───────┘          └────────────┬─────────────┘ │
│         │                               │               │
└─────────┼───────────────────────────────┼───────────────┘
          │   Encrypted payloads only     │
          ▼                               ▼
┌─────────────────────────────────────────────────────────┐
│                  NoMoreForms SERVER                      │
│                                                          │
│   • Stores AES-256 encrypted vault blobs only           │
│   • Manages session tokens and share links               │
│   • Runs WebSocket relay for real-time form fill         │
│   • Logs share events (metadata only, no plaintext)      │
│   • Never holds a decryption key                         │
└─────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│                   RECIPIENT                              │
│                                                          │
│   • Opens time-limited link in any browser               │
│   • Decryption happens client-side in their browser      │
│   • Sees only the approved fields, rendered cleanly      │
│   • No account required                                  │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Encryption Architecture

**Key Derivation (at registration):**
```
User passphrase
      │
      ▼  Argon2id (memory-hard, GPU-resistant)
Master Key (never leaves device, never sent to server)
      │
      ├──▶ Vault Encryption Key (AES-256-GCM) — encrypts vault blob
      └──▶ Share Key (ECDH keypair) — used for share sessions
```

**Vault Storage:**
- Vault is encrypted client-side before upload
- Server receives and stores only the encrypted blob
- Server cannot decrypt it — ever

**Recovery:**
- At setup, user generates a 24-word BIP-39 seed phrase (industry standard)
- Seed phrase is shown once, user must save it (printed card, password manager, etc.)
- Loss of passphrase + seed phrase = permanent, unrecoverable data loss
- This is made explicitly clear at onboarding — not buried in terms of service

**Share Session Crypto (time-limited links):**
```
1. User approves share → app generates ephemeral session key
2. Selected fields encrypted with session key
3. Session key wrapped and embedded in share link
4. Link sent to recipient
5. Recipient opens link → browser unwraps session key → decrypts fields client-side
6. Server only ever saw encrypted payload + expiry timestamp
7. After expiry, link is cryptographically dead
```

---

## 5. The Three Sharing Models

### Model 1: On-Demand Share (Snapshot)
*For the MVP prototype and most consumer use cases*

User initiates. A time-limited, scoped link (or QR code) is generated. Recipient opens it, sees approved fields. Data is frozen at time of share.

**Flow:**
1. User selects fields to share (or approves a recipient's field request)
2. App generates encrypted payload + expiring share link
3. Link delivered via QR code, text, email, or direct push
4. Recipient opens link in any browser — no install
5. Fields rendered cleanly for the expiry window (default: 15 min)
6. Event logged in user's audit trail

**Use cases:** Doctor intake, legal client form, gym signup, job application

### Model 2: Subscription (Live Access)
*Post-MVP — the high-value enterprise play*

Recipient gets a persistent, webhook-enabled subscription to specific fields. When those fields change in the user's vault, a notification (or push) is sent.

**Flow:**
1. User grants `live_access` to recipient for specific fields
2. Recipient registers a webhook URL
3. When user updates `me:contact:address:*`, all active subscribers with that grant receive a signed notification
4. User can revoke any live grant at any time — surgically, per recipient
5. Revocation is instant; next webhook call returns 401

**Use cases:** Insurance company notified of address change, bank updated on new phone number, employer updated on emergency contact

**The killer feature:** You can update your payment card and selectively revoke one provider's access before doing so. Everyone else gets notified. One provider gets nothing. The user has control that doesn't exist anywhere today.

### Model 3: Revocation
*Applies to both models above*

Every grant has:
- A `granted_at` timestamp
- An `expires_at` (optional)
- A `scope` (exact fields authorized)
- A `revoked_at` (null until revoked)

Revocation is always available. Always immediate. No "please allow 5-7 business days." The audit log records the revocation event permanently — even after revocation, the history of the grant exists.

---

## 6. The Audit Log

Every share event produces an immutable log entry. This is a first-class feature, not an afterthought.

### Log Entry Structure
```json
{
  "event_id": "evt_abc123",
  "type": "share_created",
  "timestamp": "2026-03-01T14:32:00Z",
  "recipient_label": "Dr. Smith's Office",
  "fields_shared": ["me:identity:name:full", "me:identity:dob", "me:health:insurance:full"],
  "share_model": "snapshot",
  "expires_at": "2026-03-01T14:47:00Z",
  "accessed_at": "2026-03-01T14:35:12Z",
  "access_count": 1,
  "revoked_at": null
}
```

### What the User Sees
A clean timeline: "On March 1, you shared your name, date of birth, and insurance info with Dr. Smith's Office. The link was opened once and expired after 15 minutes."

### Why This Matters
No tool today gives users a complete, legible history of who has received their personal data. This audit log is a meaningful privacy feature — and in a future regulatory environment, potentially a compliance feature for the *recipients* as well.

---

## 7. The Prototype — Demo Scenario

The demo is not a mockup. It uses real asymmetric cryptography end-to-end. This is intentional: the crypto *is* the argument. When a healthcare administrator, lawyer, or banker asks "what if someone intercepts it?", the answer is live on screen — not a promise in a slide deck.

### 7.1 Demo Components

**Three components, all real:**
1. **Demo web form** — mock patient intake form, runs in browser, generates a real ECDH keypair on load
2. **NoMoreForms mobile app** (or second browser tab for prototype) — the user's vault, also uses real crypto
3. **WebSocket relay server** — a dumb message forwarder; stores and forwards only ciphertext, has zero ability to decrypt anything it touches

### 7.2 Crypto Flow — Step by Step

```
FORM LOADS
──────────
  → Browser generates ephemeral ECDH keypair (P-256, via SubtleCrypto)
  → Keeps private key in memory only — never transmitted
  → QR code encodes:
      {
        session_id:       "sess_a3f9...",
        public_key:       "base64-encoded ECDH public key",
        requested_fields: ["me:identity:name:full", "me:identity:dob", ...],
        relay_url:        "wss://relay.nmf.dev/sess_a3f9..."
      }

USER SCANS QR
─────────────
  → App reads form's public key from QR
  → App generates its own ephemeral ECDH keypair for this session
  → App performs ECDH key agreement:
        shared_secret = ECDH(app_private_key, form_public_key)
  → Derives AES-256-GCM key from shared_secret via HKDF
  → Displays approval screen with requested fields

USER APPROVES
─────────────
  → App encrypts approved field data with derived AES key:
        ciphertext = AES-256-GCM.encrypt(payload, derived_key, iv)
  → Sends to relay:
        {
          session_id:     "sess_a3f9...",
          app_public_key: "base64-encoded app ECDH public key",
          iv:             "base64-encoded IV",
          ciphertext:     "base64-encoded encrypted payload"
        }
  → Relay forwards this blob to the waiting form session — untouched

FORM RECEIVES & DECRYPTS
─────────────────────────
  → Form receives relay message
  → Performs ECDH key agreement:
        shared_secret = ECDH(form_private_key, app_public_key)
  → Derives same AES key via HKDF (same inputs = same output)
  → Decrypts payload client-side:
        plaintext = AES-256-GCM.decrypt(ciphertext, derived_key, iv)
  → Populates form fields
  → Submits
```

**The relay sees only:** session ID, two public keys, an IV, and a ciphertext blob. It cannot decrypt any of it. Even if the relay server were compromised, logged everything, or was run by an adversary — zero plaintext is exposed.

### 7.3 The Demo UI — What's Visible on Screen

This is where the demo earns its credibility. Both the form page and the app show a live **crypto transparency panel** during the exchange. Nothing is hidden.

**Form page — left side: the actual form. Right side: live crypto log**
```
┌─────────────────────────────┬──────────────────────────────────────┐
│  Patient Intake Form        │  🔐 NoMoreForms Crypto Log           │
│                             │                                      │
│  First Name: __________     │  [✓] Session keypair generated       │
│  Last Name:  __________     │      Pub: 04a3f9...b2c1 (P-256)     │
│  DOB:        __________     │                                      │
│  Address:    __________     │  [✓] QR encoded with public key      │
│  Insurance:  __________     │      + requested fields              │
│                             │                                      │
│  [  QR CODE HERE  ]         │  [⏳] Waiting for user approval...   │
│                             │                                      │
│                             │  ← app scans QR →                   │
│                             │                                      │
│                             │  [✓] Encrypted payload received      │
│                             │      IV:         8f2a...c301         │
│                             │      Ciphertext: d4e9...aa02         │
│                             │      (relay saw exactly this)        │
│                             │                                      │
│                             │  [✓] Decrypted client-side           │
│                             │      Shared secret derived via ECDH  │
│                             │      AES-256-GCM key via HKDF        │
│                             │                                      │
│  First Name: Elie    ✓      │  [✓] Fields populated                │
│  Last Name:  [...]   ✓      │  [✓] Form submitted                  │
│                             │  [✓] Audit event logged              │
└─────────────────────────────┴──────────────────────────────────────┘
```

**The crypto log is the pitch.** A skeptic watching this sees:
- The ciphertext the relay received (meaningless bytes)
- That decryption happened in the browser, not on any server
- That the relay was provably blind — it forwarded the same blob it received

For a technical audience, you can open DevTools and show the WebSocket frames in real time — the network tab will show exactly the encrypted blob going over the wire.

### 7.4 What the Demo Proves

| Concept | How it's demonstrated |
|---------|----------------------|
| Real asymmetric crypto | ECDH keypair generated live, visible in the log |
| Zero-knowledge relay | Ciphertext shown — relay forwarded it unchanged |
| MITM resistance | Shared secret requires both private keys; neither is transmitted |
| Granular field requests | Form requests specific fields; user sees exactly what's asked |
| User approval gate | Nothing moves until user approves |
| Client-side decryption | Form populates after decryption in browser — server never had plaintext |
| Audit trail | Event logged immediately with field list and timestamp |

### 7.5 What the Demo Defers (Intentionally)
- Argon2id vault key derivation (demo vault is in-memory for prototype)
- Recovery seed phrase flow
- Subscription / live access model
- Chrome extension autofill
- Multi-device sync

---

## 8. Chrome Extension (Post-Prototype)

The extension is the path to mass consumer adoption. It requires no QR code, no phone — just a browser.

### 8.1 Autofill Model (Recommended Starting Point)

**User-initiated, icon-click model** (not auto-detect):
- Extension icon appears in the toolbar
- User clicks it on any form page
- Extension scans visible form fields, maps them to NoMoreForms namespace
- Shows user: "Found 6 fillable fields — Fill?"
- User confirms, extension populates fields

This is safer and less surprising than auto-detect (like LastPass), and more convenient than fully manual. It's the right starting point.

### 8.2 Field Mapping

The extension maintains a mapping table:

```javascript
{
  // HTML field name/id/autocomplete → NMF namespace
  "fname": "me:identity:name:first",
  "given-name": "me:identity:name:first",
  "family-name": "me:identity:name:last",
  "bday": "me:identity:dob",
  "street-address": "me:contact:address:street",
  "postal-code": "me:contact:address:zip",
  // ... and so on
}
```

This mapping table is open-sourced and community-improvable — a commons, not a moat.

### 8.3 Future: Explicit Integration

Websites that want a better experience can add a small `<meta>` tag or JS snippet:

```html
<meta name="nmf:request" content="bundle:patient_intake" />
```

This triggers a cleaner flow: extension detects the request, shows a structured approval screen rather than a field-scan, and the experience is indistinguishable from the QR code demo — just browser-native.

---

## 9. Sector Prioritization

| Sector | Pain Level | Adoption Path | MVP Fit |
|--------|-----------|---------------|---------|
| **Healthcare** | 🔴 Highest | Demo to independent clinics; FHIR compatibility later | ✅ Strong |
| **Law** | 🔴 High | Client intake at small/mid firms | ✅ Strong |
| **Banking / Mortgage** | 🟠 High | Mortgage brokers > banks | ✅ Strong |
| **Real Estate** | 🟠 High | Agents fill forms constantly | ✅ Strong |
| **Small Business (gym, etc.)** | 🟡 Medium | Extension autofill; fast yes | ✅ Low friction |
| **Government** | 🟡 Medium | Highest need, slowest procurement | ❌ Post-traction |
| **HR / Onboarding** | 🟡 Medium | Single employer = captive rollout | 🔄 Consider |

**First pilot target:** Independent healthcare practices + small law firms. High pain, fast decisions, no enterprise procurement cycle.

---

## 10. MVP Scope Definition

### In Scope (Prototype)
- [ ] Mobile app: encrypted local vault with basic field types
- [ ] QR code generation (encodes field request + session ID)
- [ ] Approval UI: shows requested fields, approve/deny/modify
- [ ] WebSocket relay: session-scoped, encrypted message passing
- [ ] Demo web form: displays QR, listens for fill event, auto-submits
- [ ] Basic audit log: per-share event stored locally

### In Scope (Real-World MVP, post-prototype)
- [ ] Argon2id key derivation
- [ ] BIP-39 recovery seed phrase
- [ ] Server-side encrypted vault backup
- [ ] Multi-device sync (encrypted blob sync, key never leaves device)
- [ ] Time-limited share links (no QR required)
- [ ] Chrome extension (user-initiated autofill)
- [ ] Recipient web page (no-install link view)
- [ ] Revocation

### Explicitly Out of Scope for MVP
- Subscription / webhook model (Post-MVP)
- Medical records (FHIR/HL7 compliance is a separate track)
- Payment card transmission (PCI-DSS compliance required first)
- Native Android/iOS system integrations (NFC, etc.)
- Any government sector targeting
- Social recovery / key sharding

---

## 11. Technical Stack Recommendations (Prototype)

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Mobile app | React Native | Single codebase, fast prototype |
| Crypto (prototype) | SubtleCrypto (Web API) | Built into browsers and RN |
| Crypto (production) | libsodium | Battle-tested, cross-platform |
| WebSocket relay | Node.js + ws library | Minimal, stateless, easy to host |
| Demo form | Vanilla HTML/JS | No framework needed |
| Extension | Chrome Manifest V3 | Current standard |
| Server (MVP) | Node.js + PostgreSQL | Stores encrypted blobs + audit metadata only |
| Hosting | Railway or Fly.io | Fast to deploy, cheap to start |

---

## 12. Open Questions (Parking Lot)

These are real decisions that don't need to be made now but need to be made before MVP launch:

1. **Namespace standardization** — Do we publish the `me:*` schema as an open standard from day one, or keep it proprietary initially and open it later?
2. **Bundle definitions** — Who defines `bundle:patient_intake`? NoMoreForms alone, or in collaboration with sector partners?
3. **Key versioning** — When a user changes their passphrase, how is the vault re-encrypted? Need a key rotation protocol.
4. **Subscription pricing model** — Subscription/webhook access is the enterprise feature. Is that where revenue lives?
5. **Regulatory posture** — HIPAA Business Associate Agreement (BAA) requirements if any PHI flows through the relay, even encrypted.

---

## 13. The One-Sentence Pitch

> NoMoreForms lets you fill any form — online or in person — with a single tap, while keeping you in complete control of exactly what you share, with whom, and for how long.

---

*This document is a living spec. Sections will evolve as the prototype is built and early feedback is gathered.*
