import type { RecoveryParty, RecoveryRequest, User } from '../models/types'

export function isActiveRecoveryParty(
  parties: RecoveryParty[],
  userId: string | undefined,
): boolean {
  if (!userId) return false
  return parties.some((p) => p.status === 'ACTIVE' && p.userId === userId)
}

/**
 * Who can see a recovery request:
 * - Workspace Owner: everything
 * - Affected user: their own request
 * - Active Recovery Parties only: emergency / break-glass (custodian work)
 * - Everyone else (removed parties, random members): never
 */
export function canViewRequest(
  request: RecoveryRequest,
  viewer: User | undefined,
  parties: RecoveryParty[] = [],
): boolean {
  if (!viewer) return false
  if (viewer.role === 'OWNER') return true
  if (request.affectedUserId === viewer.id) return true

  if (request.status === 'PENDING_OWNER_APPROVAL') return false
  if (request.type === 'USER_KEY_RESET' && request.status === 'PENDING_APPROVAL') return false

  // Custodian-path requests: only people currently on the Recovery Parties list
  if (request.type === 'EMERGENCY_RECOVERY' || request.type === 'BREAK_GLASS') {
    return isActiveRecoveryParty(parties, viewer.id)
  }

  return false
}
