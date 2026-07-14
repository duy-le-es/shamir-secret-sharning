import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore } from '../store/store'

export function LoginPage() {
  const navigate = useNavigate()
  const users = useAppStore((s) => s.users)
  const requests = useAppStore((s) => s.requests)
  const workspaceName = useAppStore((s) => s.workspaceName)
  const loginDemo = useAppStore((s) => s.loginDemo)

  const demo = users.find((u) => u.role === 'DEMO_USER')
  const [password, setPassword] = useState('')
  const [signingIn, setSigningIn] = useState(false)

  const pendingUserStep = demo
    ? requests.find(
        (r) =>
          r.affectedUserId === demo.id &&
          (r.status === 'AWAITING_USER_CONFIRMATION' || r.status === 'AWAITING_NEW_PASSWORD'),
      )
    : undefined

  const submit = () => {
    if (!password || signingIn) return
    setSigningIn(true)
    setTimeout(() => {
      loginDemo()
      if (pendingUserStep) {
        navigate(`/account-recovery/${pendingUserStep.id}`)
      } else {
        const open = demo
          ? requests.find(
              (r) =>
                r.affectedUserId === demo.id &&
                (r.status === 'PENDING_OWNER_APPROVAL' ||
                  r.status === 'PENDING_APPROVAL' ||
                  r.status === 'QUORUM_REACHED' ||
                  r.status === 'RECOVERY_IN_PROGRESS'),
            )
          : undefined
        navigate(open ? `/account-recovery/${open.id}` : '/members')
      }
    }, 600)
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <img className="login-logo" src="/logo.png" alt="Tracelium" />
        <h2>Sign in to Tracelium</h2>
        <p className="login-sub">Workspace: {workspaceName}</p>
        {pendingUserStep && (
          <p className="login-hint" style={{ marginTop: 0, color: 'var(--ink)' }}>
            Recovery is waiting — after sign-in you will confirm your Personal Recovery Code
            and set a new password.
          </p>
        )}
        <label className="field">
          <span>Email</span>
          <input type="email" value={demo?.email ?? ''} readOnly />
        </label>
        <label className="field">
          <span>Password</span>
          <input
            type="password"
            placeholder="••••••••"
            value={password}
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submit()}
          />
        </label>
        <button
          className="btn primary login-btn"
          disabled={!password || signingIn}
          onClick={submit}
        >
          {signingIn
            ? 'Signing in…'
            : pendingUserStep
              ? 'Sign in to finish recovery'
              : 'Sign in'}
        </button>
        <p className="login-hint">Demo account — any password works.</p>
      </div>
    </div>
  )
}
