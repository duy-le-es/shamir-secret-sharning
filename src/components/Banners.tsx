import { useAppStore } from '../store/store'

export function RiskWarning({
  tone,
  title,
  children,
}: {
  tone: 'info' | 'warning' | 'danger' | 'success'
  title?: string
  children: React.ReactNode
}) {
  return (
    <div className={`banner ${tone}`}>
      <div>
        {title && <strong>{title} — </strong>}
        {children}
      </div>
    </div>
  )
}

export function NoticeBanner() {
  const notice = useAppStore((s) => s.notice)
  const setNotice = useAppStore((s) => s.setNotice)
  if (!notice) return null
  return (
    <div className={`banner ${notice.tone}`}>
      <div>{notice.text}</div>
      <button className="dismiss" onClick={() => setNotice(null)} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}
