import { useState } from 'react'
import { Pill } from './Pills'
import { RecoveryTimeline } from './RecoveryTimeline'
import { TraceDrawer } from './TraceDrawer'
import type { RecoveryStep } from '../models/types'
import { useTraceStore } from '../services/trace'
import { useAppStore } from '../store/store'

const CREATE_LABELS = [
  'Step 1 — Vault Key shown on device',
  'Step 2 — Recovery Secret created',
  'Step 3 — Vault Key encrypted with Recovery Secret → stored on server',
  'Step 4 — Recovery Secret split into Shamir pieces',
  'Step 5 — Each piece encrypted with holder public key',
  'Step 6 — Plaintext Recovery Secret wiped from memory',
]

type Phase = 'prompt' | 'creating' | 'done'

export function MandatoryRecoverySetup() {
  const policy = useAppStore((s) => s.policy)
  const generateRecoverySetup = useAppStore((s) => s.generateRecoverySetup)
  const completeDemoOnboarding = useAppStore((s) => s.completeDemoOnboarding)

  const [phase, setPhase] = useState<Phase>('prompt')
  const [stepStates, setStepStates] = useState<RecoveryStep['state'][]>(
    CREATE_LABELS.map(() => 'pending'),
  )
  const [creating, setCreating] = useState(false)

  const active = policy.parties.filter((p) => p.status === 'ACTIVE')
  const M = policy.threshold
  const N = policy.totalParties
  const slotsFull = active.length >= N
  const policyReady = slotsFull && M >= 1 && M <= N && policy.mode !== 'DISABLED'

  const runCreate = async () => {
    setPhase('creating')
    setCreating(true)
    setStepStates(CREATE_LABELS.map(() => 'pending'))
    useTraceStore.getState().setOpen(true)
    for (let i = 0; i < CREATE_LABELS.length; i++) {
      setStepStates((s) => s.map((st, j) => (j === i ? 'active' : st)))
      if (i === 0) await generateRecoverySetup()
      await new Promise((r) => setTimeout(r, 750))
      setStepStates((s) => s.map((st, j) => (j === i ? 'done' : st)))
    }
    setCreating(false)
    setPhase('done')
  }

  const finish = () => {
    completeDemoOnboarding()
    setPhase('prompt')
  }

  const timelineSteps: RecoveryStep[] = CREATE_LABELS.map((label, i) => ({
    label: i === 3 ? `Step 4 — Split into ${N} pieces (${M}-of-${N} Shamir)` : label,
    state: stepStates[i],
  }))

  return (
    <div className="onboarding-body">
      <div className="onboarding-wrap">
        <div className="onboarding-card">

        {phase === 'prompt' && (
          <>
            <div className="onboarding-icon">⚠️</div>
            <h1>Recovery code required</h1>
            <p>
              This workspace does not have a recovery code yet. You need to create one now so
              that if you lose access to your account later, authorized recovery parties can
              help you get your data back.
            </p>
            <p>
              Without a recovery code, losing your key means your encrypted data is{' '}
              <strong>permanently unrecoverable</strong> — nobody, including Tracelium, can
              restore it. The code is generated on your device and distributed securely.
              This step cannot be skipped.
            </p>

            {!policyReady && (
              <p className="onboarding-error">
                Recovery Policy is not ready — configure authorized people and a valid quorum
                before creating the code.
              </p>
            )}

            <div className="onboarding-actions">
              <button
                className="btn primary"
                disabled={!policyReady || creating}
                onClick={() => void runCreate()}
              >
                Create Recovery Code
              </button>
            </div>
          </>
        )}

        {phase === 'creating' && (
          <>
            <h1>Creating recovery code…</h1>
            <p className="onboarding-lead">
              Everything happens on your device. Watch the Crypto Trace: Vault Key → Recovery
              Secret → sealed Vault Key on server → Shamir pieces → RSA wrap → wipe.
            </p>
            <RecoveryTimeline steps={timelineSteps} />
          </>
        )}

        {phase === 'done' && (
          <>
            <h1>
              Setup complete <Pill tone="green">Active · v{policy.secretVersion}</Pill>
            </h1>
            <p className="onboarding-lead">
              {M}-of-{N} recovery is now active. Each authorized person holds one protected
              share.
            </p>
            <div className="grid cols-2" style={{ margin: '12px 0' }}>
              {active.map((p) => (
                <div key={p.id} className="share-card">
                  <span className="mono" style={{ color: 'var(--muted)' }}>
                    Share ID: {p.shareId}
                  </span>
                  <span>
                    Status: <Pill tone="green">Protected</Pill>
                  </span>
                  <span className="holder">Holder: {p.displayName}</span>
                </div>
              ))}
            </div>
            <div className="onboarding-actions">
              <button className="btn primary" onClick={finish}>
                Continue to workspace
              </button>
            </div>
          </>
        )}
        </div>
      </div>
      <TraceDrawer />
    </div>
  )
}
