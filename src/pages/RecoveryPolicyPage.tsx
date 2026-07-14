import { useState } from 'react'
import { NoticeBanner, RiskWarning } from '../components/Banners'
import { Pill } from '../components/Pills'
import type { RecoveryMode } from '../models/types'
import { vault } from '../services/vault'
import { useAppStore } from '../store/store'

export function RecoveryPolicyPage() {
  const users = useAppStore((s) => s.users)
  const currentUserId = useAppStore((s) => s.currentUserId)
  const policy = useAppStore((s) => s.policy)
  const reshareProposal = useAppStore((s) => s.reshareProposal)
  const setMode = useAppStore((s) => s.setMode)
  const setThreshold = useAppStore((s) => s.setThreshold)
  const setTotalParties = useAppStore((s) => s.setTotalParties)
  const addMemberParty = useAppStore((s) => s.addMemberParty)
  const addExternalParty = useAppStore((s) => s.addExternalParty)
  const addTraceliumParty = useAppStore((s) => s.addTraceliumParty)
  const removeParty = useAppStore((s) => s.removeParty)
  const approveReshare = useAppStore((s) => s.approveReshare)
  const rejectReshare = useAppStore((s) => s.rejectReshare)
  const cancelReshare = useAppStore((s) => s.cancelReshare)
  const completeReshareAndUpgrade = useAppStore((s) => s.completeReshareAndUpgrade)
  const generateRecoverySetup = useAppStore((s) => s.generateRecoverySetup)

  const [externalEmail, setExternalEmail] = useState('')

  const currentUser = users.find((u) => u.id === currentUserId)
  const isOwner = currentUser?.role === 'OWNER'
  const active = policy.parties.filter((p) => p.status === 'ACTIVE')
  const hasAdminParty = active.some((p) => p.type === 'TRACELIUM_ADMIN')
  const owner = users.find((u) => u.role === 'OWNER')
  const setupLive = policy.setupGenerated && policy.secretVersion > 0
  const hasLiveRsUi =
    !!vault.secretHash &&
    vault.shares.size > 0 &&
    vault.recoverySecretEnvelopes.size > 0

  const N = policy.totalParties
  const M = policy.threshold
  const slotsLeft = N - active.length
  const slotsFull = slotsLeft <= 0
  const reshareOpen =
    !!reshareProposal &&
    (reshareProposal.status === 'PENDING_APPROVAL' || reshareProposal.status === 'QUORUM_REACHED')

  /** Must be on the live Recovery Parties list AND listed as a required voter. */
  const myApproverParty =
    reshareProposal &&
    active.find(
      (p) =>
        p.userId === currentUserId && reshareProposal.approverPartyIds.includes(p.id),
    )

  // Strict: only current Recovery Parties who must vote can see add requests.
  // Owner who created it can also see (to Finish).
  const canSeeReshareRequest =
    !!reshareProposal &&
    (reshareProposal.status === 'PENDING_APPROVAL' ||
      reshareProposal.status === 'QUORUM_REACHED') &&
    (!!myApproverParty ||
      (isOwner && reshareProposal.createdBy === currentUserId))

  const addableMembers = users.filter(
    (u) =>
      !u.isSystem &&
      u.role !== 'RECOVERY_CONTACT' &&
      u.role !== 'DEMO_USER' &&
      !active.some((p) => p.userId === u.id) &&
      !(reshareProposal?.pendingParty?.userId === u.id),
  )

  const thresholdInvalid = M > N || M < 1
  const tooManyParties = active.length > N
  const oneOfOne = M === 1 && policy.mode !== 'DISABLED'
  const selfOnlyExternal =
    active.length > 0 &&
    active.every((p) => p.userId === owner?.id || p.type === 'EXTERNAL_EMAIL') &&
    active.some((p) => p.type === 'EXTERNAL_EMAIL') &&
    !hasAdminParty

  const iAlreadyApproved =
    !!myApproverParty &&
    !!reshareProposal?.approvals.some(
      (a) => a.partyId === myApproverParty.id && a.decision === 'APPROVED',
    )
  const approvedCount =
    reshareProposal?.approvals.filter((a) => a.decision === 'APPROVED').length ?? 0

  const visibleApproverIds =
    reshareProposal?.approverPartyIds.filter((pid) => active.some((p) => p.id === pid)) ??
    []

  return (
    <div>
      <div className="page-header">
        <div className="crumbs">Workspace</div>
        <h1>Recovery Policy</h1>
        <div className="subtitle">
          Quorum is <strong>{M}-of-{N}</strong>: need {M} approvals from the {N} people listed
          below. Removing someone is immediate; adding someone (when RS is live) needs
          Recovery Party approvals to create the next RS version.
        </div>
      </div>

      <NoticeBanner />

      <div className="card">
        <h2>Recovery Mode</h2>
        {(
          [
            ['CUSTOMER_ONLY', 'Customer-only', 'All recovery parties are chosen and controlled by the customer.'],
            ['HYBRID', 'Hybrid', 'Customer parties plus the Tracelium System Admin as one non-decisive party.'],
          ] as Array<[RecoveryMode, string, string]>
        ).map(([mode, label, desc]) => (
          <label key={mode} className="radio-row">
            <input
              type="radio"
              name="mode"
              checked={policy.mode === mode}
              disabled={!isOwner || reshareOpen}
              onChange={() => setMode(mode)}
            />
            <span>
              <span className="radio-label">{label}</span>
              <span className="radio-desc"> — {desc}</span>
            </span>
          </label>
        ))}

        {policy.mode === 'DISABLED' && (
          <RiskWarning tone="danger" title="Recovery is not configured yet">
            Nobody — including Tracelium — can restore access if the owner key is lost right
            now. Choose a mode above and add recovery parties to enable emergency recovery.
          </RiskWarning>
        )}
      </div>

      {policy.mode !== 'DISABLED' && (
        <>
          <div className="card">
            <h2>Recovery Quorum</h2>
            <p className="card-sub">
              <strong>M of N</strong> — M = how many must approve; N = max people in the list
              below.
            </p>
            <div className="btn-row" style={{ fontSize: 15 }}>
              <input
                type="number"
                className="qty"
                min={1}
                max={Math.max(N, 1)}
                value={M}
                disabled={!isOwner || reshareOpen}
                onChange={(e) => setThreshold(Number(e.target.value))}
              />
              <span>required approvals, of</span>
              <input
                type="number"
                className="qty"
                min={1}
                max={8}
                value={N}
                disabled={!isOwner || reshareOpen}
                onChange={(e) => setTotalParties(Math.max(1, Math.min(8, Number(e.target.value))))}
              />
              <span>people max</span>
              {!thresholdInvalid && <Pill tone="blue">{M}-of-{N}</Pill>}
            </div>
            {thresholdInvalid && (
              <RiskWarning tone="danger" title="Invalid quorum">
                Required approvals cannot exceed the number of recovery parties.
              </RiskWarning>
            )}
            {oneOfOne && !thresholdInvalid && (
              <RiskWarning tone="warning" title="Weak quorum">
                A single recovery party can unlock the recovery secret without independent
                approval.
              </RiskWarning>
            )}
          </div>

          {/* Pending add — only Owner + Recovery Parties can see */}
          {canSeeReshareRequest && reshareProposal && (
            <div className="card">
              <h2>
                Request for you{' '}
                <Pill
                  tone={
                    reshareProposal.status === 'QUORUM_REACHED'
                      ? 'green'
                      : reshareProposal.status === 'REJECTED'
                        ? 'red'
                        : 'yellow'
                  }
                >
                  {reshareProposal.status === 'QUORUM_REACHED'
                    ? 'Approved — Owner can finish'
                    : reshareProposal.status === 'REJECTED'
                      ? 'Rejected'
                      : `Needs ${reshareProposal.requiredApprovals - approvedCount} more approval(s)`}
                </Pill>
              </h2>
              <p className="card-sub" style={{ marginTop: 0 }}>
                {myApproverParty
                  ? 'You are on the Recovery Parties list — approve or reject this add.'
                  : isOwner
                    ? 'You created this add request. After enough Recovery Parties approve, finish to create the next RS version.'
                    : null}
              </p>
              <dl className="kv">
                <dt>Change</dt>
                <dd>{reshareProposal.reason}</dd>
                <dt>Secret after</dt>
                <dd>
                  RS-v{reshareProposal.fromSecretVersion} → RS-v
                  {reshareProposal.fromSecretVersion + 1}
                </dd>
                <dt>Votes</dt>
                <dd className="mono">
                  {approvedCount} / {reshareProposal.requiredApprovals} required
                </dd>
              </dl>

              <h3>Who must vote (current Recovery Parties)</h3>
              {visibleApproverIds.map((pid) => {
                const p = active.find((x) => x.id === pid)
                const decision = reshareProposal.approvals.find((a) => a.partyId === pid)
                const isMe = p?.userId === currentUserId
                return (
                  <div key={pid} className="quorum-party">
                    <span
                      className={`dot ${decision?.decision === 'APPROVED' ? 'approved' : ''}`}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>
                        {p?.displayName ?? pid}
                        {isMe && (
                          <span style={{ color: 'var(--muted)', fontWeight: 400 }}> (you)</span>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        {decision?.decision === 'APPROVED' ? 'Approved' : 'Not yet'}
                      </div>
                    </div>
                  </div>
                )
              })}

              <div className="btn-row" style={{ marginTop: 12 }}>
                {myApproverParty &&
                  reshareProposal.status === 'PENDING_APPROVAL' &&
                  !iAlreadyApproved && (
                    <>
                      <button className="btn primary" onClick={() => approveReshare()}>
                        Approve
                      </button>
                      <button className="btn sm danger" onClick={() => rejectReshare()}>
                        Reject
                      </button>
                    </>
                  )}
                {isOwner && reshareProposal.status === 'QUORUM_REACHED' && (
                  <button
                    className="btn primary"
                    onClick={() => void completeReshareAndUpgrade()}
                  >
                    Finish — create RS-v{reshareProposal.fromSecretVersion + 1}
                  </button>
                )}
                {isOwner && reshareOpen && (
                  <button className="btn sm" onClick={() => cancelReshare()}>
                    Cancel request
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="card">
            <h2>
              Recovery Parties{' '}
              <Pill tone={slotsFull && !tooManyParties ? 'green' : 'yellow'}>
                {active.length} / {N} people
              </Pill>
              {setupLive && (
                <Pill tone="blue">RS-v{policy.secretVersion}</Pill>
              )}
            </h2>
            <p className="card-sub" style={{ marginTop: 0 }}>
              These people hold Shamir shares
              {setupLive ? ` of RS-v${policy.secretVersion}` : ''}. Remove is immediate.
              Add (while RS is live) needs custodian approvals, then RS-v
              {Math.max(policy.secretVersion, 1) + 1}.
            </p>
            {active.length === 0 && (
              <div className="empty">No recovery parties configured yet.</div>
            )}
            {active.map((p) => (
              <div key={p.id} className="quorum-party">
                <span
                  className="dot approved"
                  style={{ background: 'var(--teal)', borderColor: 'var(--teal)' }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, color: 'var(--ink)' }}>
                    {p.displayName}{' '}
                    {p.userId === currentUserId && <Pill tone="blue">You</Pill>}
                    {p.type === 'TRACELIUM_ADMIN' && <Pill tone="blue">Tracelium</Pill>}
                    {p.type === 'EXTERNAL_EMAIL' && <Pill tone="yellow">External</Pill>}
                  </div>
                  <div className="mono" style={{ fontSize: 11.5, color: 'var(--muted)' }}>
                    {p.email}
                    {p.shareId
                      ? ` · share ${p.shareId}`
                      : ' · share issued after setup is generated'}
                  </div>
                </div>
                {isOwner && (
                  <button
                    className="btn sm danger"
                    disabled={reshareOpen}
                    onClick={() => removeParty(p.id)}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}

            {tooManyParties && (
              <RiskWarning tone="danger" title="Too many parties for this quorum">
                Remove {active.length - N} part{active.length - N > 1 ? 'ies' : 'y'} or
                increase the total to {active.length}.
              </RiskWarning>
            )}
            {!slotsFull && !tooManyParties && !setupLive && policy.secretVersion === 0 && (
              <RiskWarning tone="info">
                Add {slotsLeft} more person{slotsLeft > 1 ? 's' : ''} to fill {M}-of-{N}.
              </RiskWarning>
            )}
            {selfOnlyExternal && (
              <RiskWarning tone="warning" title="Limited protection">
                A secondary email controlled by the same person does not provide true
                multi-party protection.
              </RiskWarning>
            )}
            {hasAdminParty && (
              <RiskWarning tone="info" title="Tracelium as a recovery party">
                Tracelium cannot recover the workspace alone.
              </RiskWarning>
            )}

            {isOwner && (
              <>
                <h3 style={{ marginTop: 16 }}>
                  {hasLiveRsUi ? 'Ask to add someone' : 'Add a recovery party'}
                </h3>
                {hasLiveRsUi ? (
                  <p className="card-sub" style={{ marginTop: 0 }}>
                    Recovery Secret is in the vault → adding someone creates an approval
                    request. After quorum, the system unwraps the Vault Key with the current
                    RS and re-seals it as RS-v{Math.max(policy.secretVersion, 1) + 1}.
                  </p>
                ) : (
                  <p className="card-sub" style={{ marginTop: 0 }}>
                    No Recovery Secret in the vault yet → add people to the list normally.
                    No approvals required until a setup is generated.
                  </p>
                )}
                <div className="btn-row">
                  {addableMembers.map((u) => (
                    <button
                      key={u.id}
                      className="btn sm"
                      disabled={(!hasLiveRsUi && slotsFull) || reshareOpen}
                      onClick={() => addMemberParty(u.id)}
                    >
                      + {u.name}
                    </button>
                  ))}
                  {!hasAdminParty && (
                    <button
                      className="btn sm"
                      disabled={(!hasLiveRsUi && slotsFull) || reshareOpen}
                      onClick={() => addTraceliumParty()}
                    >
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
                    disabled={
                      ((!hasLiveRsUi && slotsFull) || reshareOpen) ||
                      !externalEmail.includes('@')
                    }
                    onClick={() => {
                      addExternalParty(externalEmail.trim())
                      setExternalEmail('')
                    }}
                  >
                    + Add secondary recovery identity
                  </button>
                </div>
              </>
            )}
          </div>

          {policy.pendingChanges.length > 0 && !reshareOpen && isOwner && (
            <div className="card">
              <h2>
                Pending changes since RS-v{policy.secretVersion}{' '}
                <Pill tone="yellow">Action needed</Pill>
              </h2>
              <ul style={{ margin: '0 0 12px', paddingLeft: 18, fontSize: 13.5 }}>
                {policy.pendingChanges.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
              <p className="card-sub" style={{ marginTop: 0 }}>
                These edits are not live yet. To apply them, create{' '}
                <strong>RS-v{policy.secretVersion + 1}</strong> and issue new shares to the
                current Recovery Parties.
              </p>
              <div className="btn-row">
                <button
                  className="btn primary"
                  disabled={thresholdInvalid || active.length !== N}
                  onClick={() => void generateRecoverySetup()}
                >
                  Create RS-v{policy.secretVersion + 1} now
                </button>
              </div>
              {active.length !== N && (
                <RiskWarning tone="warning">
                  Fill exactly {N} recovery parties ({active.length} of {N} now) before creating
                  the new Recovery Secret.
                </RiskWarning>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
