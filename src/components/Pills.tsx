import type { KeyStatus, RequestStatus } from '../models/types'

type Tone = 'green' | 'yellow' | 'red' | 'blue' | 'gray'

export function Pill({ tone = 'gray', children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={`pill ${tone === 'gray' ? '' : tone}`}>{children}</span>
}

const REQUEST_TONE: Record<RequestStatus, Tone> = {
  PENDING_OWNER_APPROVAL: 'yellow',
  PENDING_APPROVAL: 'yellow',
  QUORUM_REACHED: 'blue',
  RECOVERY_IN_PROGRESS: 'blue',
  AWAITING_EMAIL_LINK: 'blue',
  AWAITING_NEW_PASSWORD: 'blue',
  COMPLETED: 'green',
  REJECTED: 'red',
  EXPIRED: 'gray',
  CANCELLED: 'gray',
  FAILED: 'red',
}

const REQUEST_LABEL: Record<RequestStatus, string> = {
  PENDING_OWNER_APPROVAL: 'Pending owner approval',
  PENDING_APPROVAL: 'Pending custodian approvals',
  QUORUM_REACHED: 'Quorum reached',
  RECOVERY_IN_PROGRESS: 'Recovery in progress',
  AWAITING_EMAIL_LINK: 'Recovery email sent',
  AWAITING_NEW_PASSWORD: 'Set new password',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
}

export function RequestStatusPill({ status }: { status: RequestStatus }) {
  return <Pill tone={REQUEST_TONE[status]}>{REQUEST_LABEL[status]}</Pill>
}

const KEY_TONE: Record<KeyStatus, Tone> = {
  ACTIVE: 'green',
  LOST: 'yellow',
  REVOKED: 'red',
}

export function KeyStatusPill({ status }: { status: KeyStatus }) {
  return <Pill tone={KEY_TONE[status]}>{status.charAt(0) + status.slice(1).toLowerCase()}</Pill>
}
