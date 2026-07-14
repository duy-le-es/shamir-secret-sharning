import { useState } from 'react'
import { Link } from 'react-router-dom'
import { NoticeBanner, RiskWarning } from '../components/Banners'
import { Pill } from '../components/Pills'
import { RecoveryTimeline } from '../components/RecoveryTimeline'
import type { RecoveryStep } from '../models/types'
import { useTraceStore } from '../services/trace'
import { useAppStore } from '../store/store'
import { fmtDateTime } from '../utils/format'

const CREATE_LABELS = [
  'Vault Key shown on device',
  'Recovery Secret created',
  'Vault Key encrypted with Recovery Secret → stored on server',
  'Recovery Secret split into Shamir pieces',
  'Each piece encrypted with holder public key',
  'Plaintext Recovery Secret wiped from memory',
]

const WIZARD_TITLES = ['Quorum', 'Authorized people', 'Create the code', 'Done']

export function RecoverySetupPage() {
  const users = useAppStore((s) => s.users)
  const currentUserId = useAppStore((s) => s.currentUserId)
  const policy = useAppStore((s) => s.policy)
  const setThreshold = useAppStore((s) => s.setThreshold)
  const setTotalParties = useAppStore((s) => s.setTotalParties)
  const addMemberParty = useAppStore((s) => s.addMemberParty)
  const addExternalParty = useAppStore((s) => s.addExternalParty)
  const addTraceliumParty = useAppStore((s) => s.addTraceliumParty)
  const removeParty = useAppStore((s) => s.removeParty)
  const generateRecoverySetup = useAppStore((s) => s.generateRecoverySetup)
  const runRecoveryTest = useAppStore((s) => s.runRecoveryTest)

  // 0 = not in wizard (modal / status), 1 = quorum, 2 = people, 3 = create, 4 = done
  const [wizardStep, setWizardStep] = useState(0)
  const [stepStates, setStepStates] = useState<RecoveryStep['state'][]>(
    CREATE_LABELS.map(() => 'pending'),
  )
  const [creating, setCreating] = useState(false)
  const [externalEmail, setExternalEmail] = useState('')

  const currentUser = users.find((u) => u.id === currentUserId)
  const isOwner = currentUser?.role === 'OWNER'
  // the demo user walks through the same mandatory creation flow as an owner
  const canCreate = isOwner || currentUser?.role === 'DEMO_USER'
  const active = policy.parties.filter((p) => p.status === 'ACTIVE')
  const N = policy.totalParties
  const M = policy.threshold
  const slotsFull = active.length >= N
  const thresholdInvalid = M > N || M < 1
  const hasAdminParty = active.some((p) => p.type === 'TRACELIUM_ADMIN')

  const virgin = !policy.setupGenerated && policy.secretVersion === 0
  const outdated = !policy.setupGenerated && policy.secretVersion > 0

  const addableMembers = users.filter(
    (u) =>
      !u.isSystem &&
      u.role !== 'RECOVERY_CONTACT' &&
      u.role !== 'DEMO_USER' &&
      !active.some((p) => p.userId === u.id),
  )

  const runCreate = async () => {
    setCreating(true)
    setStepStates(CREATE_LABELS.map(() => 'pending'))
    for (let i = 0; i < CREATE_LABELS.length; i++) {
      setStepStates((s) => s.map((st, j) => (j === i ? 'active' : st)))
      if (i === 0) {
        useTraceStore.getState().setOpen(true)
        await generateRecoverySetup()
      }
      await new Promise((r) => setTimeout(r, 750))
      setStepStates((s) => s.map((st, j) => (j === i ? 'done' : st)))
    }
    setCreating(false)
    setWizardStep(4)
  }

  const timelineSteps: RecoveryStep[] = CREATE_LABELS.map((label, i) => ({
    label:
      i === 3 ? `Recovery Secret split into ${N} pieces (${M}-of-${N})` : label,
    state: stepStates[i],
  }))

  return (
    <div>
      {/* ---------- blocking warning modal — cannot be dismissed ---------- */}
      {virgin && wizardStep === 0 && (
        <div className="modal-overlay">
          <div className="modal">
            <div className="modal-icon">⚠️</div>
            <h2>Recovery code required</h2>
            <p>
              This workspace has <strong>no recovery code</strong>. If the Workspace Owner
              loses their key, all encrypted data is <strong>permanently unrecoverable</strong>{' '}
              — nobody, including Tracelium, can restore it.
            </p>
            <p>
              You must create a recovery code now: it is generated on your device, split into{' '}
              shares, and handed to the people you authorize. This step cannot be skipped or
              closed.
            </p>
            {!canCreate && (
              <p style={{ color: 'var(--red)' }}>
                Only the Workspace Owner can do this. Use the role switcher (top right) to
                switch to the Owner.
              </p>
            )}
            <div className="modal-actions">
              <button
                className="btn primary"
                disabled={!canCreate}
                onClick={() => setWizardStep(1)}
              >
                Create Recovery Code
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="page-header">
        <div className="crumbs">Workspace</div>
        <h1>Recovery Setup</h1>
        <div className="subtitle">
          Guided creation of the workspace recovery code. Policy fine-tuning lives in{' '}
          <Link to="/policy">Recovery Policy</Link>.
        </div>
      </div>

      <NoticeBanner />

      {/* ---------- wizard progress ---------- */}
      {wizardStep > 0 && (
        <div className="wizard-progress">
          {WIZARD_TITLES.map((t, i) => (
            <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span
                className={`w-step ${wizardStep === i + 1 ? 'current' : wizardStep > i + 1 ? 'done' : ''}`}
              >
                {wizardStep > i + 1 ? '✓' : i + 1} {t}
              </span>
              {i < WIZARD_TITLES.length - 1 && <span className="w-sep">→</span>}
            </span>
          ))}
        </div>
      )}

      {/* ---------- step 1: quorum ---------- */}
      {wizardStep === 1 && (
        <div className="card">
          <h2>Step 1 — Choose the quorum</h2>
          <p className="card-sub">
            How many approvals are needed to use the recovery code, out of how many
            authorized people. No single person — including Tracelium — should be able to
            recover alone.
          </p>
          <div className="btn-row" style={{ fontSize: 15 }}>
            <input
              type="number"
              className="qty"
              min={1}
              max={Math.max(N, 1)}
              value={M}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
            <span>required approvals, of</span>
            <input
              type="number"
              className="qty"
              min={1}
              max={8}
              value={N}
              onChange={(e) => setTotalParties(Math.max(1, Math.min(8, Number(e.target.value))))}
            />
            <span>authorized people</span>
            {!thresholdInvalid && <Pill tone="blue">{M}-of-{N}</Pill>}
          </div>
          {thresholdInvalid && (
            <RiskWarning tone="danger" title="Invalid quorum">
              Required approvals cannot exceed the total number of people.
            </RiskWarning>
          )}
          {M === 1 && !thresholdInvalid && (
            <RiskWarning tone="warning" title="Weak quorum">
              A single person could unlock the recovery code without independent approval.
            </RiskWarning>
          )}
          <div className="btn-row" style={{ marginTop: 14 }}>
            <button className="btn primary" disabled={thresholdInvalid} onClick={() => setWizardStep(2)}>
              Continue
            </button>
          </div>
        </div>
      )}

      {/* ---------- step 2: authorized people ---------- */}
      {wizardStep === 2 && (
        <div className="card">
          <h2>
            Step 2 — Add the authorized people{' '}
            <Pill tone={slotsFull ? 'green' : 'yellow'}>{active.length} / {N}</Pill>
          </h2>
          <p className="card-sub">
            Each person you add here will hold exactly one share of the recovery code. Being
            added grants <strong>no access</strong> to anything until shares are issued in
            the next step — and even then, {M - 1 >= 1 ? `${M - 1} share(s) alone reveal nothing` : 'their share only works within the quorum'}.
          </p>

          {active.map((p) => (
            <div key={p.id} className="quorum-party">
              <span className="dot approved" style={{ background: 'var(--teal)', borderColor: 'var(--teal)' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: 'var(--ink)' }}>
                  {p.displayName}{' '}
                  {p.type === 'TRACELIUM_ADMIN' && <Pill tone="blue">Tracelium</Pill>}
                  {p.type === 'EXTERNAL_EMAIL' && <Pill tone="yellow">External</Pill>}
                </div>
                <div className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                  {p.email} · will receive one share
                </div>
              </div>
              <button className="btn sm danger" onClick={() => removeParty(p.id)}>
                Remove
              </button>
            </div>
          ))}

          <h3>Add {slotsFull && <span style={{ color: 'var(--muted)', fontWeight: 400 }}>— all {N} slots filled</span>}</h3>
          <div className="btn-row">
            {addableMembers.map((u) => (
              <button key={u.id} className="btn sm" disabled={slotsFull} onClick={() => addMemberParty(u.id)}>
                + {u.name}
              </button>
            ))}
            {!hasAdminParty && (
              <button className="btn sm" disabled={slotsFull} onClick={() => addTraceliumParty()}>
                + Tracelium System Admin
              </button>
            )}
          </div>
          <div className="btn-row" style={{ marginTop: 10 }}>
            <input
              type="email"
              placeholder="secondary-recovery@email.com"
              value={externalEmail}
              onChange={(e) => setExternalEmail(e.target.value)}
              style={{ maxWidth: 260 }}
            />
            <button
              className="btn sm"
              disabled={slotsFull || !externalEmail.includes('@')}
              onClick={() => {
                addExternalParty(externalEmail.trim())
                setExternalEmail('')
              }}
            >
              + Add secondary recovery identity
            </button>
          </div>

          {!slotsFull && (
            <RiskWarning tone="info">
              Add {N - active.length} more to fill all {N} slots before the code can be
              created.
            </RiskWarning>
          )}

          <div className="btn-row" style={{ marginTop: 14 }}>
            <button className="btn" onClick={() => setWizardStep(1)}>Back</button>
            <button className="btn primary" disabled={!slotsFull} onClick={() => setWizardStep(3)}>
              Continue
            </button>
          </div>
        </div>
      )}

      {/* ---------- step 3: create ---------- */}
      {wizardStep === 3 && (
        <div className="card">
          <h2>Step 3 — Create &amp; seal the recovery code</h2>
          <p className="card-sub">
            Everything below happens on your device. Watch the Crypto Trace panel: Vault Key →
            Recovery Secret → sealed Vault Key on server → Shamir split → RSA-wrapped shares.
          </p>
          <RecoveryTimeline steps={timelineSteps} />
          <div className="btn-row" style={{ marginTop: 14 }}>
            {stepStates.every((s) => s === 'pending') && (
              <button className="btn" disabled={creating} onClick={() => setWizardStep(2)}>
                Back
              </button>
            )}
            <button className="btn primary" disabled={creating || !slotsFull} onClick={() => void runCreate()}>
              {creating ? 'Creating…' : 'Create Recovery Code'}
            </button>
          </div>
        </div>
      )}

      {/* ---------- step 4: done ---------- */}
      {wizardStep === 4 && (
        <div className="card">
          <h2>
            Setup complete <Pill tone="green">Active · v{policy.secretVersion}</Pill>
          </h2>
          <p className="card-sub">
            {M}-of-{N} recovery is now active. Each authorized person holds one protected
            share.
          </p>
          <div className="grid cols-3" style={{ marginBottom: 12 }}>
            {active.map((p) => (
              <div key={p.id} className="share-card">
                <span className="mono" style={{ color: 'var(--muted)' }}>Share ID: {p.shareId}</span>
                <span>Status: <Pill tone="green">Protected</Pill></span>
                <span className="holder">Holder: {p.displayName}</span>
              </div>
            ))}
          </div>
          <dl className="kv">
            <dt>Server now stores</dt>
            <dd>Vault Key ciphertext (AES-GCM under RS) + fingerprints — nothing usable alone</dd>
            <dt>Plaintext Recovery Secret</dt>
            <dd>Wiped — it only exists as the {N} RSA-wrapped shares</dd>
          </dl>
          <div className="btn-row" style={{ marginTop: 14 }}>
            <button className="btn primary" onClick={() => setWizardStep(0)}>Finish</button>
          </div>
        </div>
      )}

      {/* ---------- status views (not in wizard) ---------- */}
      {wizardStep === 0 && policy.setupGenerated && (
        <div className="card">
          <h2>
            Recovery setup <Pill tone="green">Active · v{policy.secretVersion}</Pill>
          </h2>
          <p className="card-sub">
            {M}-of-{N} quorum · {active.length} authorized people. Adjust who and how many in{' '}
            <Link to="/policy">Recovery Policy</Link> — any change requires regenerating here.
          </p>
          <div className="grid cols-3" style={{ marginBottom: 12 }}>
            {active.map((p) => (
              <div key={p.id} className="share-card">
                <span className="mono" style={{ color: 'var(--muted)' }}>Share ID: {p.shareId}</span>
                <span>Status: <Pill tone="green">Protected</Pill></span>
                <span className="holder">Holder: {p.displayName}</span>
              </div>
            ))}
          </div>
          <div className="btn-row">
            <button className="btn" onClick={() => void runRecoveryTest()}>Run Recovery Test</button>
            <button className="btn teal" onClick={() => useTraceStore.getState().setOpen(true)}>
              &lt;/&gt; View Crypto Trace
            </button>
            {policy.lastTest && (
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
                Last tested {fmtDateTime(policy.lastTest.at)} — {policy.lastTest.ok ? 'healthy' : 'failed'}
              </span>
            )}
          </div>
        </div>
      )}

      {wizardStep === 0 && outdated && (
        <div className="card">
          <h2>
            Recovery setup <Pill tone="yellow">Outdated — v{policy.secretVersion} shares are stale</Pill>
          </h2>
          {policy.pendingChanges.length > 0 && (
            <RiskWarning tone="warning" title={`Changes since setup v${policy.secretVersion}`}>
              <div style={{ margin: '6px 0' }}>
                {policy.pendingChanges.map((c, i) => (
                  <div key={i}>• {c}</div>
                ))}
              </div>
              Regenerating issues fresh v{policy.secretVersion + 1} shares to the current
              people — every v{policy.secretVersion} share becomes void, including those held
              by removed parties.
            </RiskWarning>
          )}
          <RecoveryTimeline steps={timelineSteps} />
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button
              className="btn primary"
              disabled={creating || !slotsFull || thresholdInvalid || !canCreate}
              onClick={() => void runCreate()}
            >
              {creating ? 'Regenerating…' : 'Regenerate Recovery Setup'}
            </button>
            {!slotsFull && (
              <span style={{ fontSize: 12.5, color: 'var(--red)' }}>
                Needs exactly {N} people ({active.length} added) — fix in{' '}
                <Link to="/policy">Recovery Policy</Link>.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
