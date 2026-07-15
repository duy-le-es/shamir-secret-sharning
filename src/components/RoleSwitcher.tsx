import { useNavigate } from 'react-router-dom'
import { ROLE_LABEL } from '../models/types'
import { useAppStore } from '../store/store'

function demoFinishRecoveryPath(
  userId: string,
  users: { id: string; role: string }[],
  requests: { id: string; affectedUserId: string; status: string }[],
): string | null {
  const user = users.find((u) => u.id === userId)
  if (user?.role !== 'DEMO_USER') return null
  const pending = requests.find(
    (r) =>
      r.affectedUserId === userId &&
      (r.status === 'AWAITING_EMAIL_LINK' || r.status === 'AWAITING_NEW_PASSWORD'),
  )
  return pending ? `/account-recovery/${pending.id}` : null
}

export function RoleSwitcher() {
  const navigate = useNavigate()
  const users = useAppStore((s) => s.users)
  const requests = useAppStore((s) => s.requests)
  const currentUserId = useAppStore((s) => s.currentUserId)
  const setRole = useAppStore((s) => s.setRole)

  const owners = users.filter((u) => u.role === 'OWNER')
  const demoUsers = users.filter((u) => u.role === 'DEMO_USER')
  const parties = users.filter((u) => u.role !== 'OWNER' && u.role !== 'DEMO_USER')

  const onChange = (userId: string) => {
    if (userId === currentUserId) return
    setRole(userId)
    const finishPath = demoFinishRecoveryPath(userId, users, requests)
    navigate(finishPath ?? '/members', { replace: true })
  }

  return (
    <div className="role-switcher">
      <span>Viewing as</span>
      <select value={currentUserId} onChange={(e) => onChange(e.target.value)}>
        <optgroup label="Workspace Owner">
          {owners.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} — {ROLE_LABEL[u.role]}
            </option>
          ))}
        </optgroup>
        {parties.length > 0 && (
          <optgroup label="Recovery Parties (view only)">
            {parties.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} — {ROLE_LABEL[u.role]}
              </option>
            ))}
          </optgroup>
        )}
        {demoUsers.length > 0 && (
          <optgroup label="Demo">
            {demoUsers.map((u) => {
              const finishing = !!demoFinishRecoveryPath(u.id, users, requests)
              return (
                <option key={u.id} value={u.id}>
                  {u.name} — {finishing ? 'finish recovery' : 'sign in required'}
                </option>
              )
            })}
          </optgroup>
        )}
      </select>
    </div>
  )
}
