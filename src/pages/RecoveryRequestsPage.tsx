import { Link, Navigate, useNavigate } from 'react-router-dom'
import { NoticeBanner } from '../components/Banners'
import { RequestStatusPill } from '../components/Pills'
import { useAppStore } from '../store/store'
import { fmtDateTime } from '../utils/format'
import { canViewRequest, isActiveRecoveryParty } from '../utils/requestVisibility'

export function RecoveryRequestsPage() {
  const navigate = useNavigate()
  const users = useAppStore((s) => s.users)
  const policy = useAppStore((s) => s.policy)
  const requests = useAppStore((s) => s.requests)
  const currentUser = useAppStore((s) => s.users.find((u) => u.id === s.currentUserId))

  const allowed =
    currentUser?.role === 'OWNER' || isActiveRecoveryParty(policy.parties, currentUser?.id)

  const visibleRequests = requests.filter((r) =>
    canViewRequest(r, currentUser, policy.parties),
  )

  if (!allowed) {
    return <Navigate to="/members" replace />
  }

  return (
    <div>
      <div className="page-header">
        <div className="crumbs">Workspace</div>
        <h1>Recovery Requests</h1>
        <div className="subtitle">
          Standard user resets are approved by the Workspace Owner. Owner recovery requires
          the multi-party break-glass quorum.
        </div>
      </div>

      <NoticeBanner />

      <div className="card">
        <h2>All Requests</h2>
        {visibleRequests.length === 0 ? (
          <div className="empty">No recovery requests yet.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Request</th>
                <th>Type</th>
                <th>Affected</th>
                <th>Approvals</th>
                <th>Status</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {visibleRequests.map((r) => {
                const u = users.find((x) => x.id === r.affectedUserId)
                const approved = r.approvals.filter((a) => a.decision === 'APPROVED').length
                return (
                  <tr key={r.id} className="clickable" onClick={() => navigate(`/requests/${r.id}`)}>
                    <td>
                      <Link to={`/requests/${r.id}`} className="mono" onClick={(e) => e.stopPropagation()}>
                        {r.id}
                      </Link>
                    </td>
                    <td>
                      {r.type === 'EMERGENCY_RECOVERY'
                        ? 'Emergency recovery'
                        : r.type === 'BREAK_GLASS'
                          ? 'Break-glass'
                          : 'User key reset'}
                    </td>
                    <td>{u?.name}</td>
                    <td className="mono">
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
