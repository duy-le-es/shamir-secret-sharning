import type { RecoveryParty, RecoveryRequest } from '../models/types'

export function QuorumProgress({
  request,
  parties,
}: {
  request: RecoveryRequest
  parties: RecoveryParty[]
}) {
  const approved = request.approvals.filter((a) => a.decision === 'APPROVED')
  const quorumMet = approved.length >= request.requiredApprovals
  const secretActive =
    request.status === 'QUORUM_REACHED' || request.status === 'RECOVERY_IN_PROGRESS'

  const decisionFor = (partyId: string) =>
    request.approvals.find((a) => a.partyId === partyId)?.decision

  return (
    <div>
      <div style={{ fontWeight: 700, fontSize: 15 }}>
        {request.requiredApprovals}-of-{parties.length} Recovery Quorum
      </div>
      <div className="quorum-bar">
        <div
          style={{
            width: `${Math.min(100, (approved.length / request.requiredApprovals) * 100)}%`,
          }}
        />
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 8 }}>
        Quorum: {Math.min(approved.length, request.requiredApprovals)} of{' '}
        {request.requiredApprovals}
        {quorumMet && ' — quorum reached'}
      </div>

      {parties.map((p) => {
        const decision = decisionFor(p.id)
        return (
          <div key={p.id} className="quorum-party">
            <span
              className={`dot ${
                decision === 'APPROVED' ? 'approved' : decision === 'REJECTED' ? 'rejected' : ''
              }`}
            />
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{p.displayName}</div>
              <div className="mono" style={{ color: 'var(--muted)', fontSize: 11.5 }}>
                {p.shareId ?? 'no share'} · {p.email}
              </div>
            </div>
            <span style={{ fontSize: 12.5, color: 'var(--muted)', fontWeight: 600 }}>
              {decision === 'APPROVED' ? 'Approved' : decision === 'REJECTED' ? 'Rejected' : 'Pending'}
            </span>
          </div>
        )
      })}

      <div className={`lock-state ${secretActive && quorumMet ? 'unlocked' : 'locked'}`}>
        {request.secretCleared
          ? '🔒 Recovery Secret: destroyed after use'
          : secretActive && quorumMet
            ? '🔓 Recovery Secret: temporarily unlockable'
            : '🔒 Recovery Secret: locked'}
      </div>
    </div>
  )
}
