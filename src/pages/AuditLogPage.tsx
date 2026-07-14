import { Fragment, useMemo, useState } from 'react'
import { NoticeBanner } from '../components/Banners'
import { Pill } from '../components/Pills'
import { AUDIT_EVENT_TYPES } from '../models/types'
import { useAppStore } from '../store/store'
import { fmtTime } from '../utils/format'

export function AuditLogPage() {
  const audit = useAppStore((s) => s.audit)
  const users = useAppStore((s) => s.users)
  const [filter, setFilter] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)

  const filtered = useMemo(
    () => (filter ? audit.filter((e) => e.eventType === filter) : audit),
    [audit, filter],
  )

  const actorName = (actorId: string) =>
    actorId === 'SYSTEM' ? 'System' : (users.find((u) => u.id === actorId)?.name ?? actorId)

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(audit, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'recovery-audit-log.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div>
      <div className="page-header">
        <div className="crumbs">Workspace</div>
        <h1>Audit Log</h1>
        <div className="subtitle">
          Every recovery action is recorded. Share values, secrets, private keys and Recovery
          Codes are never written to the log.
        </div>
      </div>

      <NoticeBanner />

      <div className="card">
        <div className="btn-row" style={{ marginBottom: 12 }}>
          <select className="input" style={{ maxWidth: 280 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All event types</option>
            {AUDIT_EVENT_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <button className="btn sm" onClick={exportJson}>Export JSON</button>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
            {filtered.length} of {audit.length} events
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="empty">No audit events match this filter.</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Actor</th>
                <th>Event</th>
                <th>Target</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <Fragment key={e.id}>
                  <tr
                    className="clickable"
                    onClick={() => setOpenId(openId === e.id ? null : e.id)}
                  >
                    <td className="mono" style={{ color: 'var(--muted)' }}>{fmtTime(e.timestamp)}</td>
                    <td>{actorName(e.actorId)}</td>
                    <td style={{ fontWeight: 600 }}>{e.eventType}</td>
                    <td className="mono" style={{ fontSize: 12 }}>{e.target ?? '—'}</td>
                    <td>
                      <Pill tone={e.result === 'SUCCESS' ? 'green' : e.result === 'FAILURE' ? 'red' : 'blue'}>
                        {e.result === 'INFO' ? 'Info' : e.result === 'SUCCESS' ? 'Success' : 'Failure'}
                      </Pill>
                    </td>
                  </tr>
                  {openId === e.id && (
                    <tr>
                      <td colSpan={5} style={{ background: 'var(--bg-soft)' }}>
                        <dl className="kv" style={{ padding: '6px 4px' }}>
                          <dt>Event ID</dt>
                          <dd className="mono">{e.id}</dd>
                          <dt>Request ID</dt>
                          <dd className="mono">{e.requestId ?? '—'}</dd>
                          <dt>Actor</dt>
                          <dd>{actorName(e.actorId)}</dd>
                          <dt>Timestamp</dt>
                          <dd className="mono">{e.timestamp}</dd>
                          {e.metadata && (
                            <>
                              <dt>Metadata</dt>
                              <dd className="mono" style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
                                {JSON.stringify(e.metadata, null, 2)}
                              </dd>
                            </>
                          )}
                        </dl>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}

        <p className="footnote">
          Never logged: Shamir share values · Recovery secret · Private keys · Passwords ·
          Recovery Code plaintext.
        </p>
      </div>
    </div>
  )
}
