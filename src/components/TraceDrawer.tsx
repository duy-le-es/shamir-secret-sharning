import { useEffect, useRef } from 'react'
import type { TraceKind } from '../services/trace'
import { useTraceStore } from '../services/trace'
import { fmtTime } from '../utils/format'

const KIND_COLOR: Record<TraceKind, string> = {
  KEYGEN: '#2dd4bf',
  WRAP: '#60a5fa',
  SHAMIR: '#c084fc',
  ENVELOPE: '#fbbf24',
  VERIFY: '#4ade80',
  WIPE: '#f87171',
  INFO: '#94a3b8',
}

export function TraceDrawer() {
  const entries = useTraceStore((s) => s.entries)
  const clear = useTraceStore((s) => s.clear)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [entries.length])

  return (
    <aside className="trace-drawer">
      <div className="trace-header">
        <div>
          <strong>Crypto Trace</strong>
          <div className="trace-sub">
            Live cryptographic operation log. Keys, Shamir shares, and RSA ciphertext
            are recorded here as each step runs.
          </div>
        </div>
        <div className="btn-row" style={{ flexWrap: 'nowrap' }}>
          <button className="btn sm trace-clear" onClick={clear}>Clear</button>
        </div>
      </div>
      <div className="trace-body" ref={bodyRef}>
        {entries.length === 0 && (
          <div className="trace-empty">
            No operations yet. Generate a recovery setup, reset a key or run a break-glass
            recovery — every crypto call will stream here.
          </div>
        )}
        {entries.map((e) => (
          <div key={e.id} className="trace-entry">
            <div className="trace-title">
              <span className="trace-time">{fmtTime(e.timestamp)}</span>
              <span className="trace-kind" style={{ color: KIND_COLOR[e.kind], borderColor: KIND_COLOR[e.kind] }}>
                {e.kind}
              </span>
              <span>{e.title}</span>
            </div>
            {e.lines.map((line, i) => {
              const isKeyValue = /^[0-9a-fA-F]{64,}$/.test(line)
              return (
                <div
                  key={i}
                  className={isKeyValue ? 'trace-line trace-line-key' : 'trace-line'}
                >
                  {line}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </aside>
  )
}
