import { NoticeBanner } from '../components/Banners'
import { Pill } from '../components/Pills'
import { vault } from '../services/vault'
import { useTraceStore } from '../services/trace'
import { firstName, useAppStore } from '../store/store'

const KEY_INVENTORY: Array<{
  key: string
  createdWhen: string
  createdWhere: string
  storedWhere: string
  serverSees: string
}> = [
    {
      key: 'User Private Key (UK-x-vN)',
      createdWhen: 'Account creation · re-created at every key reset / recovery',
      createdWhere: "User's device (Web Crypto, client-side)",
      storedWhere: "User's trusted client only — never leaves the device",
      serverSees: 'Never',
    },
    {
      key: 'User Public Key (UK-PUB-x-vN)',
      createdWhen: 'Same moment as the private key',
      createdWhere: "User's device",
      storedWhere: 'Server (public material)',
      serverSees: 'Public key only',
    },
    {
      key: 'Recovery Secret (RS-vN, 32 bytes)',
      createdWhen: 'Owner generates / regenerates the Recovery Setup',
      createdWhere: "Owner's device, client-side",
      storedWhere: 'NOWHERE — plaintext exists for milliseconds, then wiped; only shares remain',
      serverSees: 'Only its SHA-256 commitment',
    },
    {
      key: 'Shamir Share (SHR-xxx)',
      createdWhen: 'Same moment — Recovery Secret is split immediately',
      createdWhere: "Owner's device (GF(256) split)",
      storedWhere: 'RSA-encrypted in each recovery party custody',
      serverSees: 'Nothing usable — k−1 shares reveal zero bits of the secret',
    },
    {
      key: 'Temporary reconstructed secret',
      createdWhen: 'Break-glass only, after quorum is reached',
      createdWhere: 'Recovery session memory',
      storedWhere: 'Volatile memory for seconds — wiped at the end of the session',
      serverSees: 'Never persisted',
    },
    {
      key: 'User Recovery DEK (per user, 256-bit)',
      createdWhen: 'Account creation · re-issued at every key reset / recovery',
      createdWhere: "User's device (Web Crypto, client-side)",
      storedWhere: "User's trusted client only — never leaves the device",
      serverSees: 'Never',
    },
    {
      key: 'Personal Recovery (per user, 12 words)',
      createdWhen: 'Account creation · re-issued at every key reset / recovery',
      createdWhere: "User's device (random-words, client-side)",
      storedWhere: 'Kept offline by the user',
      serverSees: 'Verifier hash only, never the plaintext',
    },
    {
      key: 'Recovery Code (per user)',
      createdWhen: 'Account creation · re-issued after every key reset',
      createdWhere: 'Client-side',
      storedWhere: 'Kept offline by the user',
      serverSees: 'Verifier hash only, never the plaintext',
    },
  ]

const LIFECYCLE: Array<{ moment: string; created: string[] }> = [
  {
    moment: '1 · Account creation (per user)',
    created: [
      'User Identity key pair UK-x-v1 — generated on the user’s device',
      'User Recovery DEK — 256-bit random key, client-side',
      'Personal Recovery — 12-word phrase, shown once and kept offline',
      'Recovery Code — shown once to the user, kept offline',
    ],
  },
  {
    moment: '2 · Recovery Setup generation (by Owner)',
    created: [
      'Recovery Secret RS-vN — 32 random bytes, client-side',
      'Shamir shares SHR-xxx — split and RSA-encrypted per recovery party',
      'Plaintext secret wiped within the same operation',
    ],
  },
  {
    moment: '3 · User key reset (Owner approves)',
    created: ['New user key pair UK-x-v(N+1)', 'New Recovery Code for the user'],
  },
  {
    moment: '4 · Break-glass recovery (quorum of parties)',
    created: [
      'Temporary reconstructed secret — memory only, destroyed after use',
      'New owner key pair — old owner key revoked',
    ],
  },
]

export function KeyArchitecturePage() {
  const users = useAppStore((s) => s.users)
  const policy = useAppStore((s) => s.policy)
  useAppStore((s) => s.requests)

  const members = users.filter((u) => !u.isSystem && u.keyVersion > 0)
  const activeParties = policy.parties.filter((p) => p.status === 'ACTIVE')

  return (
    <div>
      <div className="page-header">
        <div className="crumbs">Workspace</div>
        <h1>Key Architecture</h1>
        <div className="subtitle">
          Where every key lives right now, and when each one is created. The live view below
          reads the actual in-memory vault of this demo.
        </div>
      </div>

      <NoticeBanner />

      <div className="card">
        <h2>Live trust boundaries</h2>
        <p className="card-sub">
          Three custody zones. Nothing in the server column can decrypt anything in the other
          two columns.
        </p>
        <div className="grid cols-3">
          <div className="boundary">
            <div className="boundary-head client">User trusted clients</div>
            {members.map((u) => (
              <div key={u.id} className="artifact">
                <span className="key-badge">UK-{firstName(u)}-v{u.keyVersion} (private)</span>
                <span className="artifact-note">
                  {u.keyStatus === 'ACTIVE' ? `${u.name}'s device` : `${u.name} — key ${u.keyStatus.toLowerCase()}`}
                </span>
                {vault.vaultKeys.has(u.id) && (
                  <span className="artifact-note" style={{ display: 'block', marginTop: 4 }}>
                    Recovery DEK · {vault.vaultKeys.get(u.id)!.slice(0, 12)}…
                  </span>
                )}
                {vault.personalRecoveryKeys.has(u.id) && (
                  <span className="artifact-note" style={{ display: 'block', marginTop: 4 }}>
                    Personal Recovery · {vault.personalRecoveryKeys.get(u.id)!.split(' ').slice(0, 3).join(' ')} …
                  </span>
                )}
              </div>
            ))}
          </div>

          <div className="boundary">
            <div className="boundary-head server">Tracelium server (zero-knowledge)</div>
            <div className="artifact">
              <span className="key-badge">RS commitment</span>
              <span className="artifact-note">
                {vault.secretHash ? (
                  <Pill tone="green">SHA-256 fingerprint stored</Pill>
                ) : (
                  <Pill>Not generated</Pill>
                )}
              </span>
            </div>
            <div className="artifact">
              <span className="artifact-note">
                <strong>NOT stored:</strong> user private keys · Recovery Secret · share
                values · Recovery Codes
              </span>
            </div>
          </div>

          <div className="boundary">
            <div className="boundary-head party">Recovery party custody</div>
            {activeParties.length === 0 && (
              <div className="artifact">
                <span className="artifact-note">No recovery parties configured.</span>
              </div>
            )}
            {activeParties.map((p) => (
              <div key={p.id} className="artifact">
                <span className="key-badge">{p.shareId ?? 'no share yet'}</span>
                <span className="artifact-note">{p.displayName}</span>
              </div>
            ))}
            <div className="artifact">
              <span className="artifact-note">
                {vault.tempSecret ? (
                  <Pill tone="blue">Reconstructed secret in memory — active recovery</Pill>
                ) : (
                  <>Any {policy.threshold} share(s) reconstruct the secret; fewer reveal nothing.</>
                )}
              </span>
            </div>
          </div>
        </div>
        <div className="btn-row" style={{ marginTop: 14 }}>
          <button className="btn teal sm" onClick={() => useTraceStore.getState().setOpen(true)}>
            &lt;/&gt; Watch these keys being created in the Crypto Trace
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Key inventory</h2>
        <table>
          <thead>
            <tr>
              <th>Key</th>
              <th>Created when</th>
              <th>Created where</th>
              <th>Stored where</th>
              <th>Server sees</th>
            </tr>
          </thead>
          <tbody>
            {KEY_INVENTORY.map((row) => (
              <tr key={row.key}>
                <td><strong>{row.key}</strong></td>
                <td>{row.createdWhen}</td>
                <td>{row.createdWhere}</td>
                <td>{row.storedWhere}</td>
                <td>{row.serverSees}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Creation timeline</h2>
        {LIFECYCLE.map((block) => (
          <div key={block.moment} style={{ marginBottom: 16 }}>
            <strong>{block.moment}</strong>
            <ul className="demo-step-list" style={{ marginTop: 6 }}>
              {block.created.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
