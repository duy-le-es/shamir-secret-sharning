import { useEffect } from 'react'
import { Navigate, NavLink, Route, Routes } from 'react-router-dom'
import { RoleSwitcher } from '../components/RoleSwitcher'
import { MandatoryRecoverySetup } from '../components/MandatoryRecoverySetup'
import { TraceDrawer } from '../components/TraceDrawer'
import { AuditLogPage } from '../pages/AuditLogPage'
import { DemoModePage } from '../pages/DemoModePage'
import { LoginPage } from '../pages/LoginPage'
import { MembersPage } from '../pages/MembersPage'
import { RecoveryDetailPage } from '../pages/RecoveryDetailPage'
import { RecoveryPolicyPage } from '../pages/RecoveryPolicyPage'
import { RecoveryRequestsPage } from '../pages/RecoveryRequestsPage'
import { AccountRecoveryPage } from '../pages/AccountRecoveryPage'
import { initDemo, useAppStore } from '../store/store'
import { canViewRequest, isActiveRecoveryParty } from '../utils/requestVisibility'

const ADMIN_NAV = [
  { to: '/members', label: 'Members', icon: '👥' },
  { to: '/policy', label: 'Recovery Policy', icon: '🛡' },
  { to: '/requests', label: 'Requests', icon: '🔑', badge: 'requests' as const },
  { to: '/audit', label: 'Audit Log', icon: '≡' },
]

const DEMO_USER_NAV = [
  { to: '/members', label: 'Members', icon: '👥' },
  { to: '/policy', label: 'Recovery Policy', icon: '🛡' },
  { to: '/account-recovery', label: 'Account Recovery', icon: '🔓', badge: 'account-recovery' as const },
  { to: '/audit', label: 'Audit Log', icon: '≡' },
]

export function App() {
  const ready = useAppStore((s) => s.ready)
  const workspaceName = useAppStore((s) => s.workspaceName)
  const needsLogin = useAppStore((s) => {
    const viewer = s.users.find((u) => u.id === s.currentUserId)
    if (!viewer || viewer.role !== 'DEMO_USER' || s.demoAuthenticated) return false
    // Recovery finish steps skip the login wall — go straight to the email link / new password
    const finishing = s.requests.some(
      (r) =>
        r.affectedUserId === viewer.id &&
        (r.status === 'AWAITING_EMAIL_LINK' || r.status === 'AWAITING_NEW_PASSWORD'),
    )
    return !finishing
  })
  const needsMandatoryRecovery = useAppStore(
    (s) =>
      s.demoAuthenticated &&
      !s.demoOnboardingComplete &&
      s.users.find((u) => u.id === s.currentUserId)?.role === 'DEMO_USER',
  )
  const currentUser = useAppStore((s) => s.users.find((u) => u.id === s.currentUserId))
  const isDemoUser = currentUser?.role === 'DEMO_USER'
  const canSeeRequestsNav = useAppStore((s) => {
    const viewer = s.users.find((u) => u.id === s.currentUserId)
    if (!viewer || viewer.role === 'DEMO_USER') return false
    if (viewer.role === 'OWNER') return true
    return isActiveRecoveryParty(s.policy.parties, viewer.id)
  })
  const pendingCount = useAppStore((s) => {
    const viewer = s.users.find((u) => u.id === s.currentUserId)
    if (!viewer) return 0
    const party = isActiveRecoveryParty(s.policy.parties, viewer.id)
    if (viewer.role !== 'OWNER' && !party) return 0
    return s.requests.filter((r) => {
      if (!canViewRequest(r, viewer, s.policy.parties)) return false
      if (r.status === 'QUORUM_REACHED') return true
      if (r.status === 'PENDING_APPROVAL') {
        if (r.type === 'USER_KEY_RESET') return viewer.role === 'OWNER'
        return true
      }
      if (r.status === 'PENDING_OWNER_APPROVAL') return viewer.role === 'OWNER'
      return false
    }).length
  })
  const nav = isDemoUser
    ? DEMO_USER_NAV
    : ADMIN_NAV.filter((item) => item.to !== '/requests' || canSeeRequestsNav)
  const myOpenRecoveryCount = useAppStore((s) =>
    isDemoUser
      ? s.requests.filter(
        (r) =>
          r.affectedUserId === s.currentUserId &&
          (r.status === 'PENDING_OWNER_APPROVAL' ||
            r.status === 'PENDING_APPROVAL' ||
            r.status === 'QUORUM_REACHED' ||
            r.status === 'RECOVERY_IN_PROGRESS' ||
            r.status === 'AWAITING_EMAIL_LINK' ||
            r.status === 'AWAITING_NEW_PASSWORD'),
      ).length
      : 0,
  )

  useEffect(() => {
    initDemo()
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <img className="logo" src="/logo.png" alt="Tracelium" />
          <span>
            Tracelium
          </span>
        </div>
        {ready && !needsLogin && !needsMandatoryRecovery && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <RoleSwitcher />
          </div>
        )}
      </header>

      {ready && needsLogin ? (
        <LoginPage />
      ) : ready && needsMandatoryRecovery ? (
        <MandatoryRecoverySetup />
      ) : (
        <div className="app-body">
          <nav className="sidebar">
            <div className="section-label">{workspaceName}</div>
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                <span className="icon">{item.icon}</span>
                {item.label}
                {item.badge === 'requests' && pendingCount > 0 && (
                  <span className="badge-count">{pendingCount}</span>
                )}
                {item.badge === 'account-recovery' && myOpenRecoveryCount > 0 && (
                  <span className="badge-count">{myOpenRecoveryCount}</span>
                )}
              </NavLink>
            ))}
          </nav>

          <main className="main">
            <div className="main-inner">
              {!ready ? (
                <div className="empty" style={{ paddingTop: 80 }}>
                  Loading demo workspace…
                </div>
              ) : (
                <Routes>
                  <Route path="/" element={<Navigate to="/members" replace />} />
                  <Route path="/members" element={<MembersPage />} />
                  <Route path="/policy" element={<RecoveryPolicyPage />} />
                  <Route
                    path="/requests"
                    element={isDemoUser ? <Navigate to="/account-recovery" replace /> : <RecoveryRequestsPage />}
                  />
                  <Route path="/requests/:id" element={<RecoveryDetailPage />} />
                  <Route path="/account-recovery" element={<AccountRecoveryPage />} />
                  <Route path="/account-recovery/:id" element={<RecoveryDetailPage />} />
                  <Route path="/audit" element={<AuditLogPage />} />
                  <Route path="/demo" element={<DemoModePage />} />
                </Routes>
              )}
            </div>
          </main>

          <TraceDrawer />
        </div>
      )}
    </div>
  )
}
