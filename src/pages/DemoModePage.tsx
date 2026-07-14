import { useNavigate } from 'react-router-dom'
import { NoticeBanner } from '../components/Banners'
import { Pill } from '../components/Pills'
import { useTraceStore } from '../services/trace'
import type { ScenarioName } from '../store/store'
import { useAppStore } from '../store/store'

export function DemoModePage() {
  const navigate = useNavigate()
  const scenario = useAppStore((s) => s.scenario)
  const ready = useAppStore((s) => s.ready)
  const policy = useAppStore((s) => s.policy)
  const loadScenario = useAppStore((s) => s.loadScenario)
  const clearRecoverySetup = useAppStore((s) => s.clearRecoverySetup)
  const demoLostUserKey = useAppStore((s) => s.demoLostUserKey)
  const demoLostOwnerKey = useAppStore((s) => s.demoLostOwnerKey)
  const runRecoveryTest = useAppStore((s) => s.runRecoveryTest)
  const setNotice = useAppStore((s) => s.setNotice)

  const startDemo1 = () => {
    clearRecoverySetup()
    setNotice({
      tone: 'info',
      text: 'Demo 1 — You are the Workspace Owner. The workspace has no recovery code: follow the mandatory setup flow and watch the Crypto Trace.',
    })
    navigate('/setup')
  }

  const startDemo2 = () => {
    if (!policy.setupGenerated) {
      setNotice({
        tone: 'warning',
        text: 'Run Demo 1 first (or Reset Demo) so a recovery setup exists — Demo 2 needs shares to aggregate.',
      })
      return
    }
    demoLostOwnerKey()
    useTraceStore.getState().setOpen(true)
    navigate('/requests')
  }

  return (
    <div>
      <div className="page-header">
        <div className="crumbs">Workspace</div>
        <h1>Demo Mode</h1>
        <div className="subtitle">
          Two core demos. Keep the Crypto Trace panel open — it is the proof.
        </div>
      </div>

      <NoticeBanner />

      <div className="card">
        <h2>
          Demo 1 — Create, split &amp; store the Recovery Secret{' '}
          <Pill tone="blue">~2 min</Pill>
        </h2>
        <p className="card-sub">
          Shows how the recovery code comes into existence, how it is split into shares, and
          where each piece is stored — every step logged live.
        </p>
        <ol className="demo-step-list">
          <li>
            Click <strong>Start Demo 1</strong> — the workspace becomes a fresh one with no
            recovery code, and the Recovery Setup page opens with a{' '}
            <strong>mandatory warning modal that cannot be dismissed</strong>.
          </li>
          <li>
            Click <strong>Create Recovery Code</strong> — the guided flow starts: choose the
            quorum (2-of-3), then add the authorized people (each will hold one share).
          </li>
          <li>
            Click <strong>Create Recovery Code</strong> and read the Crypto Trace with the
            customer: Vault Key → Recovery Secret created → Vault Key sealed (server) →
            Shamir split into pieces → each piece RSA-encrypted with holder public key →
            plaintext wiped.
          </li>
          <li>
            Landing point: the server ends up holding only the sealed Vault Key ciphertext and
            fingerprints — never the Recovery Secret, never a usable share.
          </li>
          <li>
            <strong>Bonus — replace a party:</strong> Remove Dave (immediate — no approval).
            Ask to add Bob; after custodians approve, Finish creates RS-v2 and issues fresh
            shares — every older share becomes void.
          </li>
        </ol>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn primary" disabled={!ready} onClick={startDemo1}>
            Start Demo 1
          </button>
        </div>
      </div>

      <div className="card">
        <h2>
          Demo 2 — Lost account: request → approvals → aggregate → re-encrypt{' '}
          <Pill tone="blue">~3 min</Pill>
        </h2>
        <p className="card-sub">
          Shows how a lost account is recovered: what the request contains, what approvers
          see, how each approval is recorded and aggregated, and how the key is re-encrypted.
        </p>
        <ol className="demo-step-list">
          <li>
            Click <strong>Start Demo 2</strong> — Alice loses all credentials and a
            break-glass request is filed. Open the request.
          </li>
          <li>
            Show what an approver sees: request metadata only (who, why, when, required
            quorum) — <strong>never any key material</strong>.
          </li>
          <li>
            Switch role to <strong>Dave (Senior Staff)</strong> → Verify with Passkey →
            Approve. The trace logs the stored approval record and that share SHR-002 is
            authorized for release — aggregation shows 1 of 2.
          </li>
          <li>
            Switch to <strong>Carol (Security Officer)</strong> → approve → trace logs
            "Quorum aggregated".
          </li>
          <li>
            Click <strong>Begin Recovery Session</strong>: released shares are combined, the
            rebuilt secret's fingerprint matches the setup, the envelope opens, a new owner
            key is created and the Workspace Key is <strong>re-encrypted (re-wrapped)</strong>{' '}
            for it — then the temporary secret is destroyed.
          </li>
          <li>
            Finish in the Audit Log: request → each approval → quorum → re-wrap → revoke, as
            one chain.
          </li>
        </ol>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn primary" disabled={!ready} onClick={startDemo2}>
            Start Demo 2
          </button>
        </div>
      </div>

      <div className="card">
        <h2>Other tools</h2>
        <div className="btn-row">
          <button
            className={`btn sm ${scenario === 'standard' ? 'primary' : ''}`}
            disabled={!ready}
            onClick={() => { void loadScenario('standard'); navigate('/members') }}
          >
            Standard workspace
          </button>
          <button
            className={`btn sm ${scenario === 'single-owner' ? 'primary' : ''}`}
            disabled={!ready}
            onClick={() => { void loadScenario('single-owner'); navigate('/members') }}
          >
            Single-owner workspace
          </button>
          <button className="btn sm danger" disabled={!ready} onClick={() => void loadScenario(scenario)}>
            Reset Demo
          </button>
          <button className="btn sm" onClick={() => { demoLostUserKey(); navigate('/requests') }}>
            Variant: normal user reset (Owner approves)
          </button>
          <button className="btn sm" onClick={() => { void runRecoveryTest(); navigate('/members') }}>
            Run Recovery Test
          </button>
        </div>
        <p className="footnote">
          Reset regenerates all keys, envelopes and shares from scratch and clears requests,
          audit log and the trace.
        </p>
      </div>
    </div>
  )
}
