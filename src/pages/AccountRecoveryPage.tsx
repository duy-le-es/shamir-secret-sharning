import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { NoticeBanner, RiskWarning } from '../components/Banners'
import { KeyStatusPill, RequestStatusPill } from '../components/Pills'
import { useAppStore, userKeyLabel } from '../store/store'
import { fmtDateTime } from '../utils/format'

const REASONS = [
  'Lost password, Personal Recovery Code, and all devices',
  'Lost device only',
  'Private key unavailable',
  'Suspected key compromise',
]

type FlowStep = 'idle' | 'reported' | 'submitted'

export function AccountRecoveryPage() {
  const navigate = useNavigate()
  const users = useAppStore((s) => s.users)
  const policy = useAppStore((s) => s.policy)
  const requests = useAppStore((s) => s.requests)
  const currentUserId = useAppStore((s) => s.currentUserId)
  const reportAccountAccessLost = useAppStore((s) => s.reportAccountAccessLost)
  const submitAccountRecovery = useAppStore((s) => s.submitAccountRecovery)

  const me = users.find((u) => u.id === currentUserId)
  const [reason, setReason] = useState(REASONS[0])
  const [flowStep, setFlowStep] = useState<FlowStep>(
    me?.keyStatus === 'LOST' ? 'reported' : 'idle',
  )

  const myRequests = requests.filter((r) => r.affectedUserId === currentUserId)
  const openRequest = myRequests.find(
    (r) =>
      r.status === 'PENDING_OWNER_APPROVAL' ||
      r.status === 'PENDING_APPROVAL' ||
      r.status === 'QUORUM_REACHED' ||
      r.status === 'RECOVERY_IN_PROGRESS' ||
      r.status === 'AWAITING_USER_CONFIRMATION' ||
      r.status === 'AWAITING_NEW_PASSWORD',
  )
  const activeParties = policy.parties.filter((p) => p.status === 'ACTIVE')
  const recoveryReady = policy.setupGenerated && policy.mode !== 'DISABLED'

  if (!me || me.role !== 'DEMO_USER') {
    return (
      <div>
        <div className="page-header">
          <h1>Account Recovery</h1>
        </div>
        <RiskWarning tone="info">This page is only available to the Demo User account.</RiskWarning>
      </div>
    )
  }

  const reportLoss = () => {
    reportAccountAccessLost()
    setFlowStep('reported')
  }

  const submit = () => {
    const id = submitAccountRecovery(reason)
    if (id) {
      setFlowStep('submitted')
      navigate(`/account-recovery/${id}`)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="crumbs">Workspace</div>
        <h1>Emergency Account Recovery</h1>
        <div className="subtitle">
          Use this when you have lost your password, Personal Recovery Code, and all authorised
          devices. Recovery custodians provide Shamir shares to reconstruct Recovery Secret RS-vN
          and recover your Vault Key.
        </div>
      </div>

      <NoticeBanner />

      <div className="card">
        <h2>Emergency recovery flow</h2>
        <ol style={{ margin: 0, paddingLeft: 20, fontSize: 13.5, lineHeight: 1.7 }}>
          <li>Submit an Emergency Recovery Request</li>
          <li>Workspace Owner approves</li>
          <li>Recovery custodians authenticate and release Shamir shares ({policy.threshold}-of-{activeParties.length})</li>
          <li>Reconstruct Recovery Secret RS-vN → decrypt Vault Key</li>
          <li>Recover your existing Vault Key (no data re-encryption)</li>
          <li>Receive new Personal Recovery Code → confirm → set new password</li>
        </ol>
      </div>

      <div className="card">
        <h2>Your account status</h2>
        <dl className="kv">
          <dt>Account</dt>
          <dd>{me.name} · {me.email}</dd>
          <dt>User key</dt>
          <dd><span className="key-badge">{userKeyLabel(me)}</span></dd>
          <dt>Key status</dt>
          <dd><KeyStatusPill status={me.keyStatus} /></dd>
        </dl>
      </div>

      {openRequest ? (
        <div className="card">
          <h2>
            {openRequest.status === 'AWAITING_USER_CONFIRMATION'
              ? 'Confirm Personal Recovery Code'
              : openRequest.status === 'AWAITING_NEW_PASSWORD'
                ? 'Set a new password'
                : 'Recovery in progress'}
          </h2>
          <p className="card-sub" style={{ marginTop: 0 }}>
            Request <span className="mono">{openRequest.id}</span> —{' '}
            <RequestStatusPill status={openRequest.status} />
          </p>
          {openRequest.status === 'PENDING_OWNER_APPROVAL' && (
            <p className="card-sub">Waiting for Workspace Owner approval.</p>
          )}
          {openRequest.status === 'PENDING_APPROVAL' && (
            <p className="card-sub">
              Owner approved. Custodian approvals:{' '}
              {openRequest.approvals.filter((a) => a.decision === 'APPROVED').length}/
              {openRequest.requiredApprovals}
            </p>
          )}
          {openRequest.status === 'AWAITING_USER_CONFIRMATION' && (
            <RiskWarning tone="info">
              Custodians finished the recovery session. Enter the new Personal Recovery Code,
              then set a password — your key status returns to <strong>Active</strong>.
            </RiskWarning>
          )}
          {openRequest.status === 'AWAITING_NEW_PASSWORD' && (
            <RiskWarning tone="info">
              Personal Recovery Code confirmed. Create a new password to finish and mark your
              key Active.
            </RiskWarning>
          )}
          <div className="btn-row">
            <button
              className="btn primary"
              onClick={() => navigate(`/account-recovery/${openRequest.id}`)}
            >
              {openRequest.status === 'AWAITING_USER_CONFIRMATION'
                ? 'Enter Personal Recovery Code'
                : openRequest.status === 'AWAITING_NEW_PASSWORD'
                  ? 'Set new password'
                  : 'View recovery status'}
            </button>
          </div>
        </div>
      ) : me.keyStatus === 'ACTIVE' && flowStep === 'idle' ? (
        <div className="card">
          <h2>Lost password, Personal Recovery Code, and all devices?</h2>
          <p className="card-sub" style={{ marginTop: 0 }}>
            This emergency path is for when you cannot use your password, Personal Recovery
            Code, or any authorised device. Reporting lost access is recorded in the audit log
            before any recovery request is created.
          </p>
          <button className="btn danger" onClick={reportLoss}>
            I&apos;ve lost access to my account
          </button>
        </div>
      ) : me.keyStatus === 'LOST' && !openRequest ? (
        <div className="card">
          <h2>Submit emergency recovery request</h2>
          {flowStep === 'reported' && (
            <RiskWarning tone="info">
              Access loss reported and logged. Choose a reason and submit your emergency recovery request.
            </RiskWarning>
          )}

          <label className="field">
            <span>What happened?</span>
          </label>
          {REASONS.map((r) => (
            <label key={r} className="radio-row" style={{ padding: '3px 0' }}>
              <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} />
              <span>{r}</span>
            </label>
          ))}

          <h3>Recovery policy that will apply</h3>
          <dl className="kv">
            <dt>Recovery custodians</dt>
            <dd>{activeParties.length}</dd>
            <dt>Required Shamir quorum</dt>
            <dd>{policy.threshold} of {activeParties.length}</dd>
            <dt>Owner approval</dt>
            <dd>Required before custodians release shares</dd>
          </dl>

          {!recoveryReady && (
            <RiskWarning tone="danger" title="Recovery unavailable">
              No valid recovery setup exists for this workspace. Contact your workspace owner.
            </RiskWarning>
          )}

          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn primary" disabled={!recoveryReady} onClick={submit}>
              Submit Emergency Recovery Request
            </button>
          </div>
        </div>
      ) : me.keyStatus === 'ACTIVE' && flowStep !== 'idle' ? (
        <RiskWarning tone="success" title="Access restored">
          Your account is active again. No further recovery action is needed.
        </RiskWarning>
      ) : null}

      <div className="card">
        <h2>Your recovery history</h2>
        <p className="card-sub" style={{ marginTop: 0 }}>
          Every step — access loss report, owner approval, custodian quorum, envelope unwrap,
          Personal Recovery confirmation, and password envelope — is recorded in the Audit Log.
        </p>
        {myRequests.length === 0 ? (
          <div className="empty">No recovery requests yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Request</th>
                <th>Reason</th>
                <th>Approvals</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {myRequests.map((r) => {
                const approved = r.approvals.filter((a) => a.decision === 'APPROVED').length
                return (
                  <tr
                    key={r.id}
                    className="clickable"
                    onClick={() => navigate(`/account-recovery/${r.id}`)}
                  >
                    <td>
                      <Link
                        to={`/account-recovery/${r.id}`}
                        className="mono"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {r.id}
                      </Link>
                    </td>
                    <td>{r.reason}</td>
                    <td className="mono">
                      {r.ownerApproved ? 'Owner ✓ · ' : ''}
                      {approved}/{r.requiredApprovals}
                    </td>
                    <td><RequestStatusPill status={r.status} /></td>
                    <td style={{ color: 'var(--muted)' }}>{fmtDateTime(r.createdAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
