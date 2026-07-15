import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { NoticeBanner } from '../components/Banners'
import { KeyStatusPill } from '../components/Pills'
import { ROLE_LABEL } from '../models/types'
import { useAppStore, userKeyLabel, firstName } from '../store/store'

const USER_ACTION_STATUSES = [
  'AWAITING_EMAIL_LINK',
  'AWAITING_NEW_PASSWORD',
] as const

const OPEN_RECOVERY_STATUSES = [
  'PENDING_OWNER_APPROVAL',
  'PENDING_APPROVAL',
  'QUORUM_REACHED',
  'RECOVERY_IN_PROGRESS',
  'AWAITING_EMAIL_LINK',
  'AWAITING_NEW_PASSWORD',
] as const

export function MembersPage() {
  const navigate = useNavigate()
  const users = useAppStore((s) => s.users)
  const requests = useAppStore((s) => s.requests)
  const currentUserId = useAppStore((s) => s.currentUserId)
  const setRole = useAppStore((s) => s.setRole)
  const setNotice = useAppStore((s) => s.setNotice)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const members = users.filter((u) => u.role !== 'RECOVERY_CONTACT')
  const selected = users.find((u) => u.id === selectedId)
  const currentUser = users.find((u) => u.id === currentUserId)

  const openRequestFor = (userId: string) =>
    requests.find(
      (r) =>
        r.affectedUserId === userId &&
        (OPEN_RECOVERY_STATUSES as readonly string[]).includes(r.status),
    )

  const continueDemoRecovery = (userId: string, requestId: string, needsUserAction: boolean) => {
    const isSelf = currentUserId === userId && currentUser?.role === 'DEMO_USER'
    if (isSelf) {
      navigate(`/account-recovery/${requestId}`)
      return
    }
    setNotice({
      tone: 'info',
      text: needsUserAction
        ? 'Sign in as Demo User to open the one-time recovery link and set a new password (status becomes Active).'
        : 'Sign in as Demo User to follow the recovery request.',
    })
    setRole(userId)
  }

  return (
    <div>
      <div className="page-header">
        <div className="crumbs">Workspace</div>
        <h1>Members &amp; Key Status</h1>
        <div className="subtitle">
          Every member holds their own RSA user key pair. Recovery uses Shamir shares
          encrypted with each party&apos;s public key.
        </div>
      </div>

      <NoticeBanner />

      <div className="card">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>User Key</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {members.map((u) => {
              const openReq = openRequestFor(u.id)
              const needsUserAction =
                !!openReq &&
                (USER_ACTION_STATUSES as readonly string[]).includes(openReq.status)
              const isDemoSelf =
                u.role === 'DEMO_USER' &&
                currentUserId === u.id &&
                currentUser?.role === 'DEMO_USER'

              return (
                <tr
                  key={u.id}
                  className={`clickable ${selectedId === u.id ? 'selected' : ''}`}
                  onClick={() => setSelectedId(u.id === selectedId ? null : u.id)}
                >
                  <td>
                    <strong>{u.name}</strong>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{u.email}</div>
                  </td>
                  <td>{ROLE_LABEL[u.role]}</td>
                  <td>
                    <span className="key-badge">{userKeyLabel(u)}</span>
                  </td>
                  <td>
                    <KeyStatusPill status={u.keyStatus} />
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    {u.role === 'DEMO_USER' && u.keyStatus === 'LOST' && openReq && (
                      <button
                        className="btn sm primary"
                        onClick={() =>
                          continueDemoRecovery(u.id, openReq.id, needsUserAction)
                        }
                      >
                        {needsUserAction
                          ? isDemoSelf
                            ? 'Continue — confirm recovery'
                            : 'Continue as Demo User'
                          : isDemoSelf
                            ? 'View recovery'
                            : 'Open as Demo User'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {selected && !selected.isSystem && (
        <div className="card">
          <h2>{selected.name} — key material</h2>
          <dl className="kv">
            <dt>User Public Key</dt>
            <dd>
              <span className="key-badge">
                UK-PUB-{firstName(selected)}-v{selected.keyVersion}
              </span>{' '}
              <span className="mono" style={{ color: 'var(--muted)' }}>
                fp {selected.fingerprint}
              </span>
            </dd>
            <dt>Private Key</dt>
            <dd>Stored on user&apos;s trusted client — never leaves the device</dd>
            <dt>Viewing as this user</dt>
            <dd>{currentUserId === selected.id ? 'Yes' : 'No — use the role switcher'}</dd>
            {selected.role === 'DEMO_USER' && selected.keyStatus === 'LOST' && (
              <>
                <dt>Recovery</dt>
                <dd>
                  {openRequestFor(selected.id)
                    ? `Open request ${openRequestFor(selected.id)!.id} — Demo User must open the one-time recovery link then set a new password to become Active again.`
                    : 'Key marked Lost — submit recovery from Account Recovery when signed in as Demo User.'}
                </dd>
              </>
            )}
          </dl>
          <details className="tech">
            <summary>Show Technical Details</summary>
            <div className="tech-body">
              {`User key pair: RSA-OAEP 2048 (Web Crypto, generated client-side)
Public key fingerprint: ${selected.fingerprint}
Private key: never uploaded — stays on the user's device`}
            </div>
          </details>
        </div>
      )}

      {selected?.isSystem && (
        <div className="card">
          <h2>{selected.name}</h2>
          <p style={{ fontSize: 13.5, color: 'var(--muted)' }}>
            The Tracelium System Admin has <strong>no user key</strong> in this workspace.
            The admin can only act as one optional recovery party inside a customer-approved quorum.
          </p>
        </div>
      )}
    </div>
  )
}
