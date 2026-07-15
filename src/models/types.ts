export type RoleKind =
  | 'OWNER'
  | 'SENIOR_STAFF'
  | 'SECURITY_OFFICER'
  | 'ENGINEER'
  | 'TRACELIUM_ADMIN'
  | 'RECOVERY_CONTACT'
  | 'DEMO_USER'

export const ROLE_LABEL: Record<RoleKind, string> = {
  OWNER: 'Workspace Owner',
  SENIOR_STAFF: 'Senior Staff',
  SECURITY_OFFICER: 'Security Officer',
  ENGINEER: 'Engineer',
  TRACELIUM_ADMIN: 'Tracelium System Admin',
  RECOVERY_CONTACT: 'Secondary Recovery Identity',
  DEMO_USER: 'Demo User',
}

export type KeyStatus = 'ACTIVE' | 'LOST' | 'REVOKED'

export interface User {
  id: string
  name: string
  email: string
  role: RoleKind
  keyVersion: number // 0 = no workspace key material (e.g. Tracelium admin)
  keyStatus: KeyStatus
  fingerprint: string // public key fingerprint, hex
  envelopeVersion: number // 0 = no workspace envelope for this user
  isSystem?: boolean
}

export type PartyType = 'WORKSPACE_MEMBER' | 'EXTERNAL_EMAIL' | 'TRACELIUM_ADMIN'

export interface RecoveryParty {
  id: string
  type: PartyType
  userId: string // every party maps to a switchable identity in the demo
  displayName: string
  email?: string
  shareId?: string
  status: 'ACTIVE' | 'REMOVED'
}

export type RecoveryMode = 'CUSTOMER_ONLY' | 'HYBRID' | 'DISABLED'

export const MODE_LABEL: Record<RecoveryMode, string> = {
  CUSTOMER_ONLY: 'Customer-only',
  HYBRID: 'Hybrid (customer + Tracelium)',
  DISABLED: 'Disabled',
}

export interface RecoveryPolicy {
  mode: RecoveryMode
  threshold: number // M — required approvals
  totalParties: number // N — party slots; the parties list is capped at this
  parties: RecoveryParty[]
  setupGenerated: boolean
  secretVersion: number
  pendingChanges: string[] // policy edits since the last generated setup
  lastTest?: { at: string; ok: boolean; checks: TestCheck[] }
}

/** Adding a custodian while an RS is live requires current holders to approve, then RS-v(N+1). Removals are immediate. */
export type ReshareKind = 'ADD_PARTY'

export type ReshareStatus = 'PENDING_APPROVAL' | 'QUORUM_REACHED' | 'COMPLETED' | 'CANCELLED' | 'REJECTED'

export interface ReshareProposal {
  id: string
  kind: ReshareKind
  status: ReshareStatus
  /** RS version that custodians currently hold */
  fromSecretVersion: number
  createdBy: string
  createdAt: string
  /** Current RS holders who must approve (party ids at proposal time) */
  approverPartyIds: string[]
  requiredApprovals: number
  approvals: Approval[]
  /** Party to add — applied only after complete */
  pendingParty?: RecoveryParty
  /** Extra user row for external adds */
  pendingUser?: User
  /** If adding when slots are full, bump N to this value on complete */
  proposedTotalParties?: number
  reason: string
}

export interface TestCheck {
  label: string
  ok: boolean
  detail?: string
}

export type RequestType = 'USER_KEY_RESET' | 'BREAK_GLASS' | 'EMERGENCY_RECOVERY'

export type RequestStatus =
  | 'PENDING_OWNER_APPROVAL'
  | 'PENDING_APPROVAL'
  | 'QUORUM_REACHED'
  | 'RECOVERY_IN_PROGRESS'
  | 'AWAITING_EMAIL_LINK'
  | 'AWAITING_NEW_PASSWORD'
  | 'COMPLETED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CANCELLED'
  | 'FAILED'

export interface Approval {
  partyId: string // recovery party id (break-glass) or user id (key reset)
  decision: 'APPROVED' | 'REJECTED'
  signedAt: string
  authenticationMethod: string
}

export type StepState = 'pending' | 'active' | 'done'

export interface RecoveryStep {
  label: string
  state: StepState
  detail?: string
}

export interface RecoveryRequest {
  id: string
  type: RequestType
  workspaceId: string
  affectedUserId: string
  requestedBy: string
  reason: string
  requiredApprovals: number
  approvals: Approval[]
  status: RequestStatus
  createdAt: string
  expiresAt: string
  steps: RecoveryStep[]
  tempSecretExpiresAt?: string
  secretCleared?: boolean
  ownerApproved?: boolean
  ownerApprovedAt?: string
  /** Recovered DEK fingerprint — proves same DEK, not a re-issue */
  recoveredDekFingerprint?: string
  /** Emergency recovery: address the one-time recovery email was sent to */
  recoveryEmailSentTo?: string
  /** Emergency recovery: temporary hash key / one-time link expiry */
  hashKeyExpiresAt?: string
  resultSummary?: {
    oldKey: string
    newKey: string
    dataReencrypted: boolean
    sameRecoveryDek?: boolean
  }
}

export type AuditResult = 'SUCCESS' | 'FAILURE' | 'INFO'

export interface AuditEvent {
  id: string
  requestId?: string
  actorId: string // user id or 'SYSTEM'
  eventType: string
  target?: string
  result: AuditResult
  metadata?: Record<string, unknown>
  timestamp: string
}

export const AUDIT_EVENT_TYPES = [
  'Recovery policy updated',
  'Recovery party added',
  'Recovery party removed',
  'Recovery setup generated',
  'Recovery share issued',
  'Recovery request created',
  'Party approved',
  'Party rejected',
  'Quorum reached',
  'User key reset',
  'New user key generated',
  'Key envelope re-wrapped',
  'Old key revoked',
  'Recovery secret reconstructed',
  'Recovery secret destroyed',
  'Recovery session completed',
  'Recovery request rejected',
  'Recovery test executed',
  'Key loss reported',
  'User signed in',
  'Account access lost reported',
  'Account recovery requested',
  'Emergency recovery owner approved',
  'Vault Key recovered',
  'User Recovery DEK recovered',
  'Temporary hash key created',
  'Vault Key stored temporarily',
  'Recovery email sent',
  'Recovery link opened',
  'Temporary Vault Key storage deleted',
  'Password Envelope re-wrapped',
  'Reshare proposal created',
  'Reshare approved',
  'Reshare rejected',
  'Reshare completed',
] as const
