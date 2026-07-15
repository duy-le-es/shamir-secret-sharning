import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { NoticeBanner, RiskWarning } from '../components/Banners'
import { Pill, RequestStatusPill } from '../components/Pills'
import { QuorumProgress } from '../components/QuorumProgress'
import { RecoveryTimeline } from '../components/RecoveryTimeline'
import { useAppStore, userKeyLabel } from '../store/store'
import { fmtDateTime } from '../utils/format'
import { canViewRequest } from '../utils/requestVisibility'

function SecretCountdown({ expiresAt, cleared }: { expiresAt: string; cleared: boolean }) {
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [])

  if (cleared) {
    return (
      <div className="countdown-box" style={{ background: 'var(--green-bg)', borderColor: 'var(--green-bd)', color: '#166534' }}>
        <span>✓ Temporary recovery material cleared</span>
        <span>Persistent storage: never used</span>
      </div>
    )
  }
  const remaining = Math.max(0, new Date(expiresAt).getTime() - Date.now())
  const mm = String(Math.floor(remaining / 60000)).padStart(2, '0')
  const ss = String(Math.floor((remaining % 60000) / 1000)).padStart(2, '0')
  return (
    <div className="countdown-box">
      <span>
        Temporary key lifetime: <span className="clock">{mm}:{ss}</span>
      </span>
      <span>Persistent storage: Disabled</span>
      <span>Location: volatile memory</span>
    </div>
  )
}



export function RecoveryDetailPage() {
  const { id } = useParams()
  const users = useAppStore((s) => s.users)
  const policy = useAppStore((s) => s.policy)
  const request = useAppStore((s) => s.requests.find((r) => r.id === id))
  const currentUserId = useAppStore((s) => s.currentUserId)
  const approveKeyReset = useAppStore((s) => s.approveKeyReset)
  const approveEmergencyRecoveryOwner = useAppStore((s) => s.approveEmergencyRecoveryOwner)
  const approveBreakGlass = useAppStore((s) => s.approveBreakGlass)
  const rejectRequest = useAppStore((s) => s.rejectRequest)
  const beginBreakGlassRecovery = useAppStore((s) => s.beginBreakGlassRecovery)
  const beginEmergencyRecovery = useAppStore((s) => s.beginEmergencyRecovery)
  const openRecoveryEmailLink = useAppStore((s) => s.openRecoveryEmailLink)
  const setNewPasswordAfterRecovery = useAppStore((s) => s.setNewPasswordAfterRecovery)

  const [passkeyVerified, setPasskeyVerified] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    setPasskeyVerified(false)
    setNewPassword('')
    setConfirmPassword('')
  }, [currentUserId, id])

  const currentUser = users.find((u) => u.id === currentUserId)
  const isDemoUser = currentUser?.role === 'DEMO_USER'
  const listPath = isDemoUser ? '/account-recovery' : '/requests'
  const listLabel = isDemoUser ? 'Account Recovery' : 'Recovery Requests'

  if (!request || !canViewRequest(request, currentUser, policy.parties)) {
    return (
      <div>
        <div className="page-header"><h1>Request not found</h1></div>
        <Link to={listPath}>← Back to {listLabel.toLowerCase()}</Link>
      </div>
    )
  }

  const affected = users.find((u) => u.id === request.affectedUserId)!
  const requester = users.find((u) => u.id === request.requestedBy)
  const isOwner = currentUser?.role === 'OWNER'
  const isSelfRecoveryRequest = isDemoUser && request.affectedUserId === currentUserId
  const isEmergency = request.type === 'EMERGENCY_RECOVERY'
  const isBreakGlass = request.type === 'BREAK_GLASS'
  const activeParties = policy.parties.filter((p) => p.status === 'ACTIVE')

  const myParty = activeParties.find((p) => p.userId === currentUserId)
  const myDecision = myParty
    ? request.approvals.find((a) => a.partyId === myParty.id)?.decision
    : undefined
  const canApproveCustodian =
    isEmergency &&
    request.status === 'PENDING_APPROVAL' &&
    myParty &&
    !myDecision
  const canApproveBreakGlass =
    isBreakGlass && request.status === 'PENDING_APPROVAL' && myParty && !myDecision
  const isTraceliumAdmin = currentUser?.role === 'TRACELIUM_ADMIN'

  const showSteps =
    request.status === 'RECOVERY_IN_PROGRESS' ||
    request.status === 'COMPLETED' ||
    request.status === 'FAILED' ||
    request.status === 'AWAITING_EMAIL_LINK' ||
    request.status === 'AWAITING_NEW_PASSWORD' ||
    request.steps.some((s) => s.state !== 'pending')

  const openEmailLink = () => {
    void openRecoveryEmailLink(request.id)
  }

  const submitPassword = () => {
    if (newPassword !== confirmPassword) return
    void setNewPasswordAfterRecovery(request.id, newPassword)
  }

  return (
    <div>
      <div className="page-header">
        <div className="crumbs">
          <Link to={listPath}>{listLabel}</Link> / {request.id}
        </div>
        <h1>
          <span className="mono" style={{ fontSize: 20 }}>{request.id}</span>{' '}
          <RequestStatusPill status={request.status} />
        </h1>
        <div className="subtitle">
          {isEmergency
            ? isSelfRecoveryRequest
              ? 'Emergency recovery — password and all devices lost'
              : 'Shamir emergency recovery with envelope unwrap'
            : isSelfRecoveryRequest
              ? 'Your account recovery request — waiting for recovery party approvals'
              : isBreakGlass
                ? 'Workspace break-glass recovery'
                : 'Standard user key reset'}
        </div>
      </div>

      <NoticeBanner />

      <div className="card">
        <h2>Request details</h2>
        <dl className="kv">
          <dt>Recovery type</dt>
          <dd>
            {isEmergency
              ? 'Emergency Recovery (Shamir + envelopes)'
              : isBreakGlass
                ? 'Break-glass (multi-party)'
                : 'Standard User Key Reset'}
          </dd>
          <dt>Affected account</dt>
          <dd>
            {affected.name} {affected.role === 'OWNER' && <Pill tone="blue">Workspace Owner</Pill>}
          </dd>
          <dt>Current user key</dt>
          <dd><span className="key-badge">{userKeyLabel(affected)}</span></dd>
          <dt>Requested by</dt>
          <dd>{requester?.name ?? request.requestedBy}</dd>
          <dt>Reason</dt>
          <dd>{request.reason}</dd>
          {isEmergency && (
            <>
              <dt>Lost credentials</dt>
              <dd>Password · all authorised devices</dd>
              <dt>Recovery scope</dt>
              <dd>Recover existing Vault Key (no data re-encryption)</dd>
            </>
          )}
          {!isBreakGlass && !isEmergency && (
            <>
              <dt>Authorized projects</dt>
              <dd>Project A, Project B</dd>
            </>
          )}
          {isBreakGlass && (
            <>
              <dt>Recovery scope</dt>
              <dd>Restore workspace ownership access</dd>
            </>
          )}
          <dt>Created</dt>
          <dd>{fmtDateTime(request.createdAt)}</dd>
          <dt>Expires</dt>
          <dd>{fmtDateTime(request.expiresAt)}</dd>
          {request.ownerApproved && (
            <>
              <dt>Owner approval</dt>
              <dd><Pill tone="green">Approved</Pill> {request.ownerApprovedAt && fmtDateTime(request.ownerApprovedAt)}</dd>
            </>
          )}
          {request.recoveredDekFingerprint && (
            <>
              <dt>Recovered Vault Key</dt>
              <dd>
                <span className="mono">{request.recoveredDekFingerprint}</span>{' '}
                <Pill tone="green">Same key preserved</Pill>
              </dd>
            </>
          )}
        </dl>
      </div>

      {/* ---------- emergency: owner approval ---------- */}
      {isEmergency && request.status === 'PENDING_OWNER_APPROVAL' && (
        <div className="card">
          <h2>Workspace Owner approval</h2>
          {isOwner ? (
            <>
              <p className="card-sub" style={{ marginTop: 0 }}>
                Approving authorizes recovery custodians to release their Shamir shares.
                The recovery session will reconstruct Recovery Secret RS-vN, restore the existing
                Vault Key, seal it with a time-limited hash key for temporary server storage, and
                email the user a one-time link — not issue a new Vault Key.
              </p>
              <div className="btn-row">
                <button className="btn danger" onClick={() => rejectRequest(request.id)}>
                  Reject
                </button>
                <button className="btn primary" onClick={() => approveEmergencyRecoveryOwner(request.id)}>
                  Approve Emergency Recovery
                </button>
              </div>
            </>
          ) : isSelfRecoveryRequest ? (
            <RiskWarning tone="warning">
              Waiting for the Workspace Owner to approve your emergency recovery request.
              Switch role to the owner to continue the demo.
            </RiskWarning>
          ) : (
            <RiskWarning tone="warning">
              Waiting for the Workspace Owner. Switch role to the owner to approve or reject.
            </RiskWarning>
          )}
        </div>
      )}

      {/* ---------- standard user key reset: owner decision ---------- */}
      {!isBreakGlass && !isEmergency && request.status === 'PENDING_APPROVAL' && (
        <div className="card">
          <h2>Owner decision</h2>
          {isOwner ? (
            <>
              <p className="card-sub" style={{ marginTop: 0 }}>
                Approving does <strong>not</strong> reveal the old private key. A brand-new
                cryptographic identity is created for {affected.name}, and the old key is revoked.
              </p>
              <div className="btn-row">
                <button className="btn danger" onClick={() => rejectRequest(request.id)}>
                  Reject
                </button>
                <button className="btn primary" onClick={() => void approveKeyReset(request.id)}>
                  Approve Key Reset
                </button>
              </div>
            </>
          ) : (
            <RiskWarning tone="info">
              Waiting for the Workspace Owner. Switch role to the owner to approve or reject.
            </RiskWarning>
          )}
        </div>
      )}

      {/* ---------- emergency / break-glass: quorum + party actions ---------- */}
      {(isEmergency || isBreakGlass) &&
        request.status !== 'PENDING_OWNER_APPROVAL' &&
        !request.status.startsWith('AWAITING') &&
        request.status !== 'COMPLETED' && (
        <div className="grid cols-2">
          <div className="card" style={{ marginBottom: 0 }}>
            <h2>Approval progress</h2>
            <QuorumProgress request={request} parties={activeParties} />
            {isSelfRecoveryRequest && request.status === 'PENDING_APPROVAL' && (
              <div style={{ marginTop: 12 }}>
                <RiskWarning tone="info">
                  {isEmergency
                    ? 'After owner approval, recovery custodians must authenticate and release their Shamir shares.'
                    : 'Recovery parties are reviewing your request. Each approval is logged in the Audit Log.'}
                  {' '}You cannot approve your own recovery.
                </RiskWarning>
              </div>
            )}
          </div>

          <div className="card" style={{ marginBottom: 0 }}>
            <h2>{isSelfRecoveryRequest ? 'What happens next' : 'Your role in this recovery'}</h2>

            {isTraceliumAdmin && myParty && (
              <RiskWarning tone="info" title="You are one recovery custodian">
                You cannot: initiate this recovery · complete recovery independently · view
                decrypted customer data.
              </RiskWarning>
            )}

            {isSelfRecoveryRequest && request.status === 'PENDING_APPROVAL' ? (
              <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>
                Once {request.requiredApprovals} recovery custodians approve, the recovery session
                can reconstruct Recovery Secret RS-vN and recover your Vault Key.
              </p>
            ) : canApproveCustodian || canApproveBreakGlass ? (
              <>
                <p className="card-sub" style={{ marginTop: 0 }}>
                  You hold recovery share{' '}
                  <span className="key-badge">{myParty!.shareId}</span>. Re-authenticate
                  before releasing it into the recovery session.
                </p>
                <p className="card-sub" style={{ marginTop: 0 }}>
                  As a custodian you see request metadata and quorum progress only — never
                  key material or other parties&apos; shares.
                </p>
                {!passkeyVerified ? (
                  <button className="btn teal" onClick={() => setPasskeyVerified(true)}>
                    Verify with Passkey
                  </button>
                ) : (
                  <>
                    <div style={{ marginBottom: 10 }}>
                      <Pill tone="green">Identity verified · Passkey</Pill>
                    </div>
                    <div className="btn-row">
                      <button className="btn danger" onClick={() => rejectRequest(request.id)}>
                        Reject
                      </button>
                      <button className="btn primary" onClick={() => approveBreakGlass(request.id)}>
                        {isEmergency
                          ? 'Approve and Release Shamir Share'
                          : 'Approve and Release Recovery Share'}
                      </button>
                    </div>
                  </>
                )}
              </>
            ) : myDecision ? (
              <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>
                You already {myDecision === 'APPROVED' ? 'approved' : 'rejected'} this request.
                {request.status === 'PENDING_APPROVAL' &&
                  ' Waiting for the remaining recovery custodians — switch roles to continue the demo.'}
              </p>
            ) : request.status === 'PENDING_APPROVAL' ? (
              <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>
                {currentUser?.name} is not a recovery custodian for this workspace. Switch role to
                a recovery party to approve.
              </p>
            ) : (
              <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>
                No further approvals are needed.
              </p>
            )}

            {request.status === 'QUORUM_REACHED' && (
              <>
                <RiskWarning tone="success" title="Quorum reached">
                  {isEmergency
                    ? 'Enough Shamir shares authorized. The recovery session can reconstruct Recovery Secret RS-vN — temporarily, in memory only.'
                    : 'Enough recovery shares have been released. The recovery session can now reconstruct the secret — temporarily, in memory only.'}
                </RiskWarning>
                <button
                  className="btn primary"
                  onClick={() =>
                    void (isEmergency
                      ? beginEmergencyRecovery(request.id)
                      : beginBreakGlassRecovery(request.id))
                  }
                >
                  Begin Recovery Session
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---------- user opens the one-time recovery email link ---------- */}
      {isEmergency && request.status === 'AWAITING_EMAIL_LINK' && isSelfRecoveryRequest && (
        <div className="card">
          <h2>Open your recovery email</h2>
          <p className="card-sub" style={{ marginTop: 0 }}>
            A one-time recovery link was sent to{' '}
            <strong>{request.recoveryEmailSentTo ?? affected.email}</strong>. The link carries a
            time-limited hash key. Opening it decrypts your Vault Key from temporary server
            storage so you can set a new password.
          </p>
          {request.hashKeyExpiresAt && (
            <RiskWarning tone="warning" title="Time-limited link">
              This link expires at {fmtDateTime(request.hashKeyExpiresAt)}. After that the
              temporary Vault Key storage is deleted and a new recovery request is required.
            </RiskWarning>
          )}
          <RiskWarning tone="info" title="Demo: email delivery">
            In production this link arrives in your inbox. For the demo, open it here.
          </RiskWarning>
          <button className="btn primary" onClick={openEmailLink}>
            Open One-Time Recovery Link
          </button>
        </div>
      )}

      {/* ---------- user sets new password ---------- */}
      {isEmergency && request.status === 'AWAITING_NEW_PASSWORD' && isSelfRecoveryRequest && (
        <div className="card">
          <h2>Create a new password</h2>
          <p className="card-sub" style={{ marginTop: 0 }}>
            The hash key from your one-time link decrypted the same Vault Key. Derive a new
            Password KEK from your password and wrap that Vault Key into a new Password
            Envelope stored on the server. The temporary storage is then deleted.
          </p>
          <label className="field">
            <span>New password</span>
            <input
              type="password"
              className="input"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Confirm password</span>
            <input
              type="password"
              className="input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </label>
          {newPassword && confirmPassword && newPassword !== confirmPassword && (
            <RiskWarning tone="danger">Passwords do not match.</RiskWarning>
          )}
          <button
            className="btn primary"
            disabled={!newPassword || newPassword !== confirmPassword || newPassword.length < 8}
            onClick={submitPassword}
          >
            Save Password Envelope
          </button>
        </div>
      )}

      {/* ---------- temp secret indicator ---------- */}
      {(isEmergency || isBreakGlass) && request.tempSecretExpiresAt && (
        <SecretCountdown
          expiresAt={request.tempSecretExpiresAt}
          cleared={!!request.secretCleared}
        />
      )}

      {/* ---------- execution timeline ---------- */}
      {showSteps && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Recovery session</h2>
          <RecoveryTimeline steps={request.steps} />
        </div>
      )}

      {/* ---------- result ---------- */}
      {request.resultSummary && (
        <div className="card">
          <h2>Result</h2>
          <dl className="kv">
            <dt>User key</dt>
            <dd>
              <span className="key-badge">{request.resultSummary.newKey}</span>{' '}
              <Pill tone="green">Active</Pill>
            </dd>
            {request.resultSummary.sameRecoveryDek && (
              <>
                <dt>User Recovery DEK</dt>
                <dd><Pill tone="green">Same DEK recovered</Pill> — no data re-encryption</dd>
              </>
            )}
            {!request.resultSummary.sameRecoveryDek && (
              <>
                <dt>Old key</dt>
                <dd>
                  <span className="key-badge">{request.resultSummary.oldKey}</span>{' '}
                  <Pill tone="red">Revoked</Pill>
                </dd>
                <dt>New key</dt>
                <dd>
                  <span className="key-badge">{request.resultSummary.newKey}</span>{' '}
                  <Pill tone="green">Active</Pill>
                </dd>
              </>
            )}
          </dl>
        </div>
      )}

      {request.status === 'REJECTED' && (
        <RiskWarning tone="danger" title="Rejected">
          This recovery request was rejected. No key material changed and no secret was
          reconstructed.
        </RiskWarning>
      )}
    </div>
  )
}
