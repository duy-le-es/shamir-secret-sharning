# Tracelium — Recovery Demo Prototype

A React prototype that lets customers **walk through** zero-knowledge recovery end to end: Shamir Secret Sharing, break-glass quorum, key reset, and audit logging.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
```

No backend is required — everything runs in the browser. All key material is generated with the **Web Crypto API** (not placeholder strings):

- **User key pair:** RSA-OAEP 2048
- **Vault Key:** AES-256-GCM, wrapped per user (key envelopes)
- **Recovery Secret:** 32 random bytes, split with `shamir-secret-sharing` (GF(256))
- **Recovery envelope:** AES-GCM(Vault Key, key = Recovery Secret)
- **On quorum:** shares are combined for real, the envelope is decrypted for real, the Vault Key is re-wrapped for real onto the new identity material — then the secret is wiped from memory

Live secrets exist only in `src/services/vault.ts` (in-memory). UI state (Zustand) holds fingerprints and version labels only — never raw keys, shares, or secrets.

## Deploy to Render

This app is a **static SPA** (no backend). Use a [Render Static Site](https://render.com/docs/static-sites).

### Option A — Blueprint (recommended)

1. Push this repo to GitHub, GitLab, or Bitbucket.
2. In Render: **New → Blueprint** → connect the repo.
3. Render reads `render.yaml` at the repo root and provisions the site.

### Option B — Manual setup

1. **New → Static Site** → connect the repo.
2. Set **Build Command** to `npm install && npm run build` and **Publish Directory** to `dist`.
3. Add a **Rewrite** rule (required for React Router):
   - Source: `/*`
   - Destination: `/index.html`
   - Action: **Rewrite**

Without the rewrite, direct URLs such as `/members` or `/policy` return 404 on refresh.

No environment variables are required. On the free tier, the site may sleep after idle; the first visit can be slow. Add a custom domain under **Settings → Custom Domains** if needed.

Verify locally before deploying:

```bash
npm run build
npm run preview   # http://localhost:4173
```

## Main demos (Members / Demo Mode)

| Demo | What happens | What the Crypto Trace proves |
| --- | --- | --- |
| **Demo 1 — Create, split & store the Recovery Secret** | Fresh workspace with no recovery setup → mandatory **Recovery Setup** flow → configure quorum → add custodians → generate & split → done | 32-byte secret created client-side → Shamir split into N shares (fingerprint + holder) → shares held in custodian custody → Vault Key sealed → plaintext wiped |
| **Demo 2 — Lost account: request → approvals → reconstruct → re-wrap** | Affected user loses credentials → recovery request → switch roles to approve as each custodian → Begin Recovery | Approvers see metadata only; each approval is recorded; quorum progresses (e.g. 1/2 → 2/2); shares combine → commitment matches setup → Vault Key recovered and re-wrapped → temporary secret destroyed |

**Demo Mode** includes a presenter script plus extras: single-owner risk scenario, standard user-key reset (Owner approval), Recovery Test, and Reset Demo.

## Project layout

```
src/
├── app/App.tsx              # layout, router, role switcher
├── pages/                   # Members, Policy, Requests, Detail, Audit, Demo, …
├── components/              # QuorumProgress, RecoveryTimeline, Pills, Banners, …
├── services/
│   ├── crypto.service.ts    # keygen, fingerprint (Web Crypto)
│   ├── shamir.service.ts    # split / combine (shamir-secret-sharing)
│   ├── envelope.service.ts  # wrap / unwrap + recovery envelope
│   └── vault.ts             # in-memory key vault (never mirrored into UI state)
├── store/store.ts           # Zustand: state machine, quorum, audit, scenarios
└── models/types.ts          # User, RecoveryPolicy, RecoveryRequest, AuditEvent, …
```

Typical request lifecycle: `PENDING_OWNER_APPROVAL` / `PENDING_APPROVAL` → `QUORUM_REACHED` → `RECOVERY_IN_PROGRESS` → `AWAITING_USER_CONFIRMATION` → `AWAITING_NEW_PASSWORD` → `COMPLETED` (plus `REJECTED` / `FAILED` / `EXPIRED` / `CANCELLED`). Every transition writes an audit event. Audit never records share values, secrets, private keys, or Personal Recovery Codes.

## Key Architecture

The Key Architecture view answers the two questions that matter for the technical solution:

- **Where keys live** — live trust boundaries (user clients / Tracelium server as ciphertext-only / recovery-party custody) plus a key inventory (created when, created where, stored where, what the server can see).
- **When recovery material is created** — timeline from account creation → workspace creation → **Recovery Setup** (Recovery Secret, shares, and recovery envelope are born here — not on day one) → key reset → break-glass.

## Crypto Trace

The **`</>` Crypto Trace** control (top bar, or from Recovery Policy) streams real cryptographic operations as they happen:

- `KEYGEN` — RSA key pairs / Vault Key / Recovery Secret (with SHA-256 commitment)
- `SHAMIR` — split / combine (per-share hashes, threshold parameters)
- `WRAP` — wrap Vault Key into envelopes (ciphertext preview)
- `ENVELOPE` — seal / open recovery envelope (IV, auth-tag verification)
- `VERIFY` — reconstructed secret hash matches setup commitment; recovered Vault Key matches original (proves data need not be re-encrypted); tamper check — a one-byte share mutation is rejected by AES-GCM
- `WIPE` — moment the secret is cleared from memory

The console never prints secret, share, or private-key values — only SHA-256 commitments, enough to prove correctness without breaking the zero-knowledge story.

## Trust boundaries demonstrated

- Owner approval of a reset **does not** restore the old private key — a new identity is issued.
- Key reset re-wraps envelopes; it **does not** re-encrypt workspace data.
- The Recovery Secret exists only transiently in memory once quorum is met, with a countdown, and is wiped immediately after re-wrap.
- The Tracelium System Admin has no workspace envelope and can never reach quorum alone (UI and logic both enforce this).
- 1-of-1 quorums and owner-controlled secondary email identities surface explicit trade-off warnings.

## Testing

- `npm run typecheck` — TypeScript check
- `npm run test:logic` — end-to-end store logic with real crypto across scenarios (no browser)
- `npm run test:ui` — headless Chrome clicks through the demo; fails on console errors; screenshots land in `test-results/`. Requires `npm run dev` and Google Chrome (`CHROME_PATH` to override)

## Out of scope (by design)

No real file encryption, no outbound email, no production passkeys (“Verify with Passkey” is simulated), no Nitro Enclaves, and no real authentication.
