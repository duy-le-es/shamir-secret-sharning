import { create } from 'zustand'
import type {
  AuditEvent,
  AuditResult,
  RecoveryMode,
  RecoveryParty,
  RecoveryPolicy,
  RecoveryRequest,
  RecoveryStep,
  RequestType,
  ReshareProposal,
  TestCheck,
  User,
} from '../models/types'
import userKeysSeed from '../data/user-keys.json'
import type { UserKeysFile } from '../data/user-keys'
import {
  createRandomKey,
  fingerprintPublicKey,
  generateUserKeyPair,
  importUserKeyPairFromPem,
  randomSecret,
  sha256hex,
  toHex,
  wipe,
} from '../services/crypto.service'
import { clearTrace, trace } from '../services/trace'
import { encryptKeyWithPublicKey } from '../utils/crypto.helper'
import {
  createEmergencyRecoveryEnvelope,
  createPasswordEnvelope,
  createTempHashKeyEnvelope,
  unwrapEmergencyRecoveryEnvelope,
  unwrapTempHashKeyEnvelope,
} from '../services/envelope.service'
import { combineShares, splitSecret } from '../services/shamir.service'
import { resetVault, vault } from '../services/vault'

const DEMO_PASSWORD = 'tracelium-demo'

export type ScenarioName = 'standard' | 'single-owner'

export interface Notice {
  tone: 'info' | 'success' | 'warning' | 'danger'
  text: string
}

interface AppState {
  ready: boolean
  scenario: ScenarioName
  workspaceName: string
  currentUserId: string
  demoAuthenticated: boolean
  demoOnboardingComplete: boolean
  users: User[]
  policy: RecoveryPolicy
  requests: RecoveryRequest[]
  reshareProposal: ReshareProposal | null
  audit: AuditEvent[]
  notice: Notice | null

  // role / demo control
  setRole: (userId: string) => void
  loginDemo: () => void
  completeDemoOnboarding: () => void
  setNotice: (notice: Notice | null) => void
  loadScenario: (name: ScenarioName) => Promise<void>

  // policy management
  setMode: (mode: RecoveryMode) => void
  setThreshold: (threshold: number) => void
  setTotalParties: (totalParties: number) => void
  addMemberParty: (userId: string) => void
  addExternalParty: (email: string) => void
  addTraceliumParty: () => void
  removeParty: (partyId: string) => void
  approveReshare: () => void
  rejectReshare: () => void
  cancelReshare: () => void
  completeReshareAndUpgrade: () => Promise<void>
  clearRecoverySetup: () => void
  generateRecoverySetup: () => Promise<void>
  runRecoveryTest: () => Promise<void>

  // key loss + requests
  simulateKeyLoss: (userId: string) => void
  reportAccountAccessLost: () => void
  submitAccountRecovery: (reason: string) => string | null
  createRequest: (
    type: RequestType,
    affectedUserId: string,
    reason: string,
  ) => string | null
  approveKeyReset: (requestId: string) => Promise<void>
  approveEmergencyRecoveryOwner: (requestId: string) => void
  approveBreakGlass: (requestId: string) => void
  rejectRequest: (requestId: string) => void
  beginBreakGlassRecovery: (requestId: string) => Promise<void>
  beginEmergencyRecovery: (requestId: string) => Promise<void>
  openRecoveryEmailLink: (requestId: string) => Promise<boolean>
  setNewPasswordAfterRecovery: (requestId: string, password: string) => Promise<boolean>

  // guided demo buttons
  demoLostUserKey: () => void
  demoLostOwnerKey: () => void
}

// ---------------------------------------------------------------- helpers

let reqSeq = 1000
let auditSeq = 0
let partySeq = 0
let extSeq = 0
let shareSeq = 0
let reshareSeq = 0

const nowIso = () => new Date().toISOString()
const hoursFromNow = (h: number) =>
  new Date(Date.now() + h * 3600_000).toISOString()
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export const firstName = (user: User) => user.name.split(' ')[0]
export const userKeyLabel = (user: User) =>
  user.keyVersion === 0 ? '—' : `UK-${firstName(user)}-v${user.keyVersion}`
export const envelopeLabel = (user: User) =>
  user.envelopeVersion === 0 ? '—' : `Envelope-v${user.envelopeVersion}`

const USER_RESET_STEPS = [
  'Old user sessions revoked',
  'Old user key marked as revoked',
  'New user key generated',
  'Audit event recorded',
]

const BREAK_GLASS_STEPS = [
  'Validate party signatures',
  'Load approved recovery shares',
  'Reconstruct recovery secret in memory',
  'Generate new owner key',
  'Revoke old owner key',
  'Destroy reconstructed secret',
  'Close recovery session',
]

const emergencyRecoverySteps = (secretVersion: number): string[] => {
  const rs = `RS-v${Math.max(secretVersion, 1)}`
  return [
    'Validate custodian signatures',
    'Load approved Shamir shares',
    `Reconstruct Recovery Secret ${rs}`,
    `Restore Vault Key with Recovery Secret ${rs}`,
    'Verify restored Vault Key',
    'Create temporary hash key (time-limited)',
    'Encrypt Vault Key with hash key — temporary server storage',
    `Clear recovery session material (${rs})`,
    'Record audit events',
    'Send recovery email with one-time link',
  ]
}

const OPEN_REQUEST_STATUSES = [
  'PENDING_OWNER_APPROVAL',
  'PENDING_APPROVAL',
  'QUORUM_REACHED',
  'RECOVERY_IN_PROGRESS',
  'AWAITING_EMAIL_LINK',
  'AWAITING_NEW_PASSWORD',
] as const

/** Lifetime of the temporary hash key / one-time recovery link (demo: 15 minutes). */
const HASH_KEY_TTL_MS = 15 * 60_000

const freshSteps = (labels: string[]): RecoveryStep[] =>
  labels.map((label) => ({ label, state: 'pending' }))

/** Live Recovery Secret in the vault (shares + sealed Vault Key). */
const hasLiveRecoverySecret = () =>
  !!vault.secretHash &&
  vault.shares.size > 0 &&
  vault.recoverySecretEnvelopes.size > 0

const liveRsHolders = (parties: RecoveryParty[]) =>
  parties.filter((p) => p.status === 'ACTIVE' && (p.shareId || vault.shares.has(p.id)))

// ---------------------------------------------------------------- store

export const useAppStore = create<AppState>((set, get) => {
  const pushAudit = (
    eventType: string,
    opts: {
      actorId?: string
      requestId?: string
      target?: string
      result?: AuditResult
      metadata?: Record<string, unknown>
    } = {},
  ) => {
    const event: AuditEvent = {
      id: `AUD-${String(++auditSeq).padStart(4, '0')}`,
      eventType,
      actorId: opts.actorId ?? 'SYSTEM',
      requestId: opts.requestId,
      target: opts.target,
      result: opts.result ?? 'SUCCESS',
      metadata: opts.metadata,
      timestamp: nowIso(),
    }
    set((s) => ({ audit: [event, ...s.audit] }))
  }

  const patchRequest = (
    requestId: string,
    patch: Partial<RecoveryRequest> | ((r: RecoveryRequest) => Partial<RecoveryRequest>),
  ) => {
    set((s) => ({
      requests: s.requests.map((r) =>
        r.id === requestId
          ? { ...r, ...(typeof patch === 'function' ? patch(r) : patch) }
          : r,
      ),
    }))
  }

  const patchUser = (userId: string, patch: Partial<User>) => {
    set((s) => ({
      users: s.users.map((u) => (u.id === userId ? { ...u, ...patch } : u)),
    }))
  }

  const setStep = (
    requestId: string,
    index: number,
    state: RecoveryStep['state'],
    detail?: string,
  ) => {
    patchRequest(requestId, (r) => ({
      steps: r.steps.map((step, i) =>
        i === index ? { ...step, state, detail: detail ?? step.detail } : step,
      ),
    }))
  }

  const runStep = async (
    requestId: string,
    index: number,
    ms: number,
    work?: () => Promise<string | void>,
  ) => {
    setStep(requestId, index, 'active')
    await sleep(ms)
    const detail = work ? await work() : undefined
    setStep(requestId, index, 'done', detail ?? undefined)
  }

  const markPolicyOutdated = (actorId: string, change: string) => {
    set((s) => ({
      policy: {
        ...s.policy,
        setupGenerated: false,
        pendingChanges: [...s.policy.pendingChanges, change],
      },
    }))
    pushAudit('Recovery policy updated', {
      actorId,
      metadata: { change },
      result: 'INFO',
    })
  }

  // -------- scenario bootstrap ------------------------------------------

  const provisionUserEnvelopes = async (
    userId: string,
    userName: string,
    vaultKey: string,
    demoPassword = DEMO_PASSWORD,
  ) => {
    const emergencyKey = randomSecret(32)
    vault.emergencyRecoveryKeys.set(userId, emergencyKey)
    vault.emergencyRecoveryKeyHashes.set(userId, await sha256hex(emergencyKey))
    vault.emergencyRecoveryEnvelopes.set(
      userId,
      await createEmergencyRecoveryEnvelope(vaultKey, emergencyKey, userName),
    )
    vault.passwordEnvelopes.set(
      userId,
      await createPasswordEnvelope(vaultKey, demoPassword, userName),
    )
  }

  const bootstrap = async (name: ScenarioName) => {
    set({ ready: false })
    resetVault()
    clearTrace()
    reqSeq = 1000
    auditSeq = 0
    partySeq = 0
    extSeq = 0
    shareSeq = 0

    const traceliumAdmin: User = {
      id: 'tracelium-admin',
      name: 'Tracelium Admin',
      email: 'sysadmin@tracelium.io',
      role: 'TRACELIUM_ADMIN',
      keyVersion: 0,
      keyStatus: 'ACTIVE',
      fingerprint: '—',
      envelopeVersion: 0,
      isSystem: true,
    }

    const memberDefs: Array<Pick<User, 'id' | 'name' | 'email' | 'role'>> =
      name === 'standard'
        ? [
          { id: 'alice', name: 'Alice Nguyen', email: 'alice@acme.io', role: 'OWNER' },
          { id: 'dave', name: 'Dave Tran', email: 'dave@acme.io', role: 'SENIOR_STAFF' },
          { id: 'carol', name: 'Carol Le', email: 'carol@acme.io', role: 'SECURITY_OFFICER' },
          { id: 'bob', name: 'Bob Pham', email: 'bob@acme.io', role: 'ENGINEER' },
          { id: 'emma', name: 'Emma Vo', email: 'emma@acme.io', role: 'SENIOR_STAFF' },
          { id: 'demo', name: 'Demo User', email: 'demo@acme.io', role: 'DEMO_USER' },
        ]
        : [{ id: 'alice', name: 'Alice Nguyen', email: 'alice@solo.io', role: 'OWNER' }]

    const users: User[] = []
    for (const def of memberDefs) {
      const seed = (userKeysSeed as UserKeysFile).users[def.id]
      if (!seed) {
        throw new Error(`Missing pre-generated RSA keys for user "${def.id}" in user-keys.json`)
      }
      if (!seed.vaultKey) {
        throw new Error(`Missing vaultKey for user "${def.id}" in user-keys.json`)
      }
      const pair = await importUserKeyPairFromPem(seed.publicKey, seed.privateKey)
      vault.userKeys.set(def.id, pair)
      vault.vaultKeys.set(def.id, seed.vaultKey)
      trace('KEYGEN', `Vault Key — ${def.name}`, [seed.vaultKey])
      await provisionUserEnvelopes(def.id, def.name, seed.vaultKey, seed.demoPassword)
      users.push({
        ...def,
        keyVersion: 1,
        keyStatus: 'ACTIVE',
        fingerprint: await fingerprintPublicKey(pair.publicKey),
        envelopeVersion: 1,
      })
    }
    users.push(traceliumAdmin)

    const parties: RecoveryParty[] =
      name === 'standard'
        ? (['dave', 'carol', 'bob'] as const).map((uid) => {
          const u = users.find((x) => x.id === uid)!
          return {
            id: `PTY-${String(++partySeq).padStart(3, '0')}`,
            type: 'WORKSPACE_MEMBER' as const,
            userId: uid,
            displayName: u.name,
            email: u.email,
            status: 'ACTIVE' as const,
          }
        })
        : []

    set({
      scenario: name,
      workspaceName: name === 'standard' ? 'Acme Hardware' : 'Solo Hardware Lab',
      currentUserId: 'alice',
      demoAuthenticated: false,
      demoOnboardingComplete: false,
      users,
      requests: [],
      reshareProposal: null,
      audit: [],
      notice: null,
      policy: {
        mode: name === 'standard' ? 'CUSTOMER_ONLY' : 'DISABLED',
        threshold: 2,
        totalParties: name === 'standard' ? 3 : 2,
        parties,
        setupGenerated: false,
        secretVersion: 0,
        pendingChanges: [],
      },
    })

    set({ ready: true })
  }

  // -------- recovery setup ----------------------------------------------

  const generateRecoverySetup = async () => {
    const { policy, currentUserId, users } = get()
    const active = policy.parties.filter((p) => p.status === 'ACTIVE')
    if (policy.mode === 'DISABLED' || active.length === 0) return
    if (active.length !== policy.totalParties) return
    if (policy.threshold > active.length || policy.threshold < 1) return

    const N = active.length
    const secretVersion = get().policy.secretVersion + 1
    const owner = users.find((u) => u.id === currentUserId)
    const vaultKey = vault.vaultKeys.get(currentUserId)
    if (!owner || !vaultKey) return

    clearTrace()

    // 1 — Vault Key
    trace('KEYGEN', `Vault Key — ${owner.name}`, [vaultKey])

    // 2 — Recovery Secret
    const secret = randomSecret(32)
    vault.secretHash = await sha256hex(secret)
    trace('KEYGEN', `Recovery Secret RS-v${secretVersion} created`, [toHex(secret)])

    // 3 — Encrypt Vault Key with Recovery Secret → server-stored ciphertext
    vault.recoverySecretEnvelopes.clear()
    const sealed = await createEmergencyRecoveryEnvelope(vaultKey, secret, owner.name)
    vault.recoverySecretEnvelopes.set(currentUserId, sealed)
    trace('WRAP', `Vault Key encrypted with Recovery Secret RS-v${secretVersion}`, [
      'algorithm: AES-256-GCM',
      `IV: ${sealed.iv}`,
      `Vault Key owner: ${owner.name}`,
    ])
    trace('ENVELOPE', 'Encrypted Vault Key stored on server', [sealed.ciphertext])

    // 4 — Split Recovery Secret into N pieces (log all pieces first)
    const shares = await splitSecret(secret, active.length, policy.threshold)
    const pieceLines: string[] = [
      `${policy.threshold}-of-${N} threshold: ${policy.threshold} shares required to reconstruct`,
    ]
    for (let i = 0; i < shares.length; i++) {
      pieceLines.push(`Piece ${i + 1} of ${N} (hex): ${toHex(shares[i])}`)
    }
    trace('SHAMIR', `Recovery Secret split into ${N} pieces`, pieceLines)

    // 5 — Encrypt each piece with the holder's public key
    vault.shares.forEach((s) => s.fill(0))
    vault.shares.clear()
    const updatedParties = policy.parties.map((p) => {
      if (p.status !== 'ACTIVE') return p
      const idx = active.indexOf(p)
      vault.shares.set(p.id, shares[idx])
      return { ...p, shareId: `SHR-${String(++shareSeq).padStart(3, '0')}` }
    })

    for (let i = 0; i < active.length; i++) {
      const party = updatedParties.find((p) => p.id === active[i].id)!
      const pieceHex = toHex(shares[i])
      const seed = party.userId
        ? (userKeysSeed as UserKeysFile).users[party.userId]
        : undefined
      if (seed) {
        const wrapped = encryptKeyWithPublicKey(pieceHex, seed.publicKey)
        if (wrapped) {
          trace(
            'WRAP',
            `Piece ${i + 1} encrypted with ${party.displayName} public key — ${party.shareId}`,
            [wrapped],
          )
        }
      } else {
        trace('WRAP', `Piece ${i + 1} issued to ${party.displayName} — ${party.shareId}`, [
          'no RSA public key on file — share held in demo custody only',
          `share (hex): ${pieceHex}`,
        ])
      }
    }

    wipe(secret)
    trace('WIPE', 'Plaintext Recovery Secret wiped from memory', [
      'only the encrypted Vault Key (server) and RSA-wrapped shares remain',
    ])

    set((s) => ({
      policy: {
        ...s.policy,
        parties: updatedParties,
        setupGenerated: true,
        secretVersion: s.policy.secretVersion + 1,
        pendingChanges: [],
      },
    }))

    pushAudit('Recovery setup generated', {
      actorId: currentUserId,
      metadata: {
        threshold: policy.threshold,
        totalShares: active.length,
        plaintextSecretStoredOnServer: false,
      },
    })
    for (const p of updatedParties.filter((p) => p.status === 'ACTIVE')) {
      pushAudit('Recovery share issued', {
        actorId: 'SYSTEM',
        target: `${p.shareId} → ${p.displayName}`,
        result: 'INFO',
      })
    }

    // Per-user User Emergency Recovery Keys — Shamir-split to the same parties (no trace noise)
    vault.userEmergencyShares.forEach((m) => {
      m.forEach((s) => s.fill(0))
      m.clear()
    })
    vault.userEmergencyShares.clear()
    for (const userId of vault.emergencyRecoveryKeys.keys()) {
      const emergencyKey = vault.emergencyRecoveryKeys.get(userId)!
      const userShares = await splitSecret(emergencyKey, active.length, policy.threshold)
      const shareMap = new Map<string, Uint8Array>()
      for (let i = 0; i < active.length; i++) {
        shareMap.set(active[i].id, userShares[i])
      }
      vault.userEmergencyShares.set(userId, shareMap)
    }
  }

  // -------- break-glass execution ---------------------------------------

  const beginBreakGlassRecovery = async (requestId: string) => {
    const req = get().requests.find((r) => r.id === requestId)
    if (!req || req.status !== 'QUORUM_REACHED') return
    const actorId = get().currentUserId
    const affected = get().users.find((u) => u.id === req.affectedUserId)
    if (!affected) return
    const oldKey = userKeyLabel(affected)

    patchRequest(requestId, { status: 'RECOVERY_IN_PROGRESS' })

    try {
      const approvedPartyIds = req.approvals
        .filter((a) => a.decision === 'APPROVED')
        .map((a) => a.partyId)

      await runStep(requestId, 0, 900, async () => {
        return `${approvedPartyIds.length} signed approvals verified`
      })

      let loadedShares: Uint8Array[] = []
      await runStep(requestId, 1, 900, async () => {
        loadedShares = approvedPartyIds
          .map((pid) => vault.shares.get(pid))
          .filter((s): s is Uint8Array => !!s)
        if (loadedShares.length < req.requiredApprovals) {
          throw new Error('Missing recovery shares for approved parties')
        }
        const labels = get()
          .policy.parties.filter((p) => approvedPartyIds.includes(p.id))
          .map((p) => p.shareId)
          .join(', ')
        return `Shares loaded: ${labels}`
      })

      await runStep(requestId, 2, 1100, async () => {
        const totalCustodians = get().policy.parties.filter((p) => p.status === 'ACTIVE').length
        const shareIds = get()
          .policy.parties.filter((p) => approvedPartyIds.includes(p.id))
          .map((p) => p.shareId)
          .join(', ')
        const threshold = req.requiredApprovals
        const rsLabel = `RS-v${get().policy.secretVersion}`

        vault.tempSecret = await combineShares(loadedShares, threshold)
        const reconstructedHash = await sha256hex(vault.tempSecret)
        if (reconstructedHash !== vault.secretHash) {
          throw new Error('Reconstructed secret does not match setup commitment')
        }
        trace('SHAMIR', `Recovery Secret ${rsLabel} rebuilt (${threshold}-of-${totalCustodians})`, [
          `How Shamir works: at setup, ${rsLabel} was split into ${totalCustodians} pieces.`,
          `Policy requires any ${threshold} pieces — not all ${totalCustodians} — to rebuild the secret.`,
          `One piece alone reveals nothing; ${threshold} together reconstruct the original ${rsLabel}.`,
          `This session used: ${shareIds}`,
          `Verified OK — rebuilt secret matches the fingerprint saved at setup.`,
        ])
        patchRequest(requestId, {
          tempSecretExpiresAt: new Date(Date.now() + 45_000).toISOString(),
          secretCleared: false,
        })
        pushAudit('Recovery secret reconstructed', {
          actorId: 'SYSTEM',
          requestId,
          metadata: { location: 'volatile memory only', bytes: 32 },
          result: 'INFO',
        })
        return '32-byte secret assembled in volatile memory'
      })

      let newFingerprint = ''
      await runStep(requestId, 3, 1100, async () => {
        const pair = await generateUserKeyPair(
          `${affected.name} (UK-${firstName(affected)}-v${affected.keyVersion + 1})`,
        )
        vault.userKeys.set(affected.id, pair)
        const vaultKey = createRandomKey(256)
        vault.vaultKeys.set(affected.id, vaultKey)
        newFingerprint = await fingerprintPublicKey(pair.publicKey)
        trace('KEYGEN', `User Recovery DEK re-issued — ${affected.name}`, [
          `new 256-bit DEK (hex): ${vaultKey}`,
        ])
        return `UK-${firstName(affected)}-v${affected.keyVersion + 1} created client-side`
      })

      await runStep(requestId, 4, 900, async () => {
        pushAudit('Old key revoked', {
          actorId: 'SYSTEM',
          requestId,
          target: oldKey,
        })
        return `${oldKey} can no longer be used for authentication`
      })

      await runStep(requestId, 5, 900, async () => {
        wipe(vault.tempSecret)
        vault.tempSecret = null
        trace('WIPE', 'Temporary reconstructed secret cleared', [
          'secret overwritten with zeros in volatile memory',
          'existed only for the duration of this recovery session',
        ])
        patchRequest(requestId, { secretCleared: true })
        pushAudit('Recovery secret destroyed', {
          actorId: 'SYSTEM',
          requestId,
          metadata: { persistentStorage: 'never used' },
          result: 'INFO',
        })
        return 'Temporary recovery material cleared'
      })

      await runStep(requestId, 6, 800)

      patchUser(affected.id, {
        keyVersion: affected.keyVersion + 1,
        keyStatus: 'ACTIVE',
        fingerprint: newFingerprint,
      })
      patchRequest(requestId, {
        status: 'COMPLETED',
        resultSummary: {
          oldKey,
          newKey: `UK-${firstName(affected)}-v${affected.keyVersion + 1}`,
          dataReencrypted: false,
        },
      })
      pushAudit('Recovery session completed', {
        actorId,
        requestId,
        target: affected.name,
      })
      set({
        notice: {
          tone: 'success',
          text: `Break-glass recovery completed. ${affected.name} regained workspace access with a new key. Temporary recovery material was cleared.`,
        },
      })
    } catch (err) {
      wipe(vault.tempSecret)
      vault.tempSecret = null
      patchRequest(requestId, { status: 'FAILED', secretCleared: true })
      pushAudit('Recovery session completed', {
        actorId,
        requestId,
        result: 'FAILURE',
        metadata: { error: String(err) },
      })
    }
  }

  // -------- emergency recovery (envelope-based) --------------------------

  const beginEmergencyRecovery = async (requestId: string) => {
    const req = get().requests.find((r) => r.id === requestId)
    if (!req || req.type !== 'EMERGENCY_RECOVERY' || req.status !== 'QUORUM_REACHED') return
    const actorId = get().currentUserId
    const affected = get().users.find((u) => u.id === req.affectedUserId)
    if (!affected) return
    const originalVaultKey = vault.vaultKeys.get(affected.id)
    if (!originalVaultKey) return
    const rsVersion = get().policy.secretVersion
    const rsLabel = `RS-v${rsVersion}`

    patchRequest(requestId, { status: 'RECOVERY_IN_PROGRESS' })

    try {
      const approvedPartyIds = req.approvals
        .filter((a) => a.decision === 'APPROVED')
        .map((a) => a.partyId)

      await runStep(requestId, 0, 700, async () => {
        return `${approvedPartyIds.length} custodian approvals verified`
      })

      let loadedShares: Uint8Array[] = []
      await runStep(requestId, 1, 800, async () => {
        // Prefer workspace Recovery Secret shares (same RS created at setup).
        // Fall back to per-user emergency shares if setup envelopes are missing.
        const useWorkspaceRs = vault.recoverySecretEnvelopes.has(affected.id) && !!vault.secretHash
        loadedShares = approvedPartyIds
          .map((pid) => (useWorkspaceRs ? vault.shares.get(pid) : vault.userEmergencyShares.get(affected.id)?.get(pid)))
          .filter((s): s is Uint8Array => !!s)
        if (loadedShares.length < req.requiredApprovals) {
          throw new Error('Missing Shamir shares for approved custodians')
        }
        const labels = get()
          .policy.parties.filter((p) => approvedPartyIds.includes(p.id))
          .map((p) => p.shareId)
          .join(', ')
        return `Custodian shares loaded: ${labels}`
      })

      await runStep(requestId, 2, 1000, async () => {
        const useWorkspaceRs = vault.recoverySecretEnvelopes.has(affected.id) && !!vault.secretHash
        const totalCustodians = get().policy.parties.filter((p) => p.status === 'ACTIVE').length
        const shareIds = get()
          .policy.parties.filter((p) => approvedPartyIds.includes(p.id))
          .map((p) => p.shareId)
          .join(', ')
        const threshold = req.requiredApprovals

        vault.tempEmergencyKey = await combineShares(loadedShares, threshold)
        const reconstructedHash = await sha256hex(vault.tempEmergencyKey)
        const expectedHash = useWorkspaceRs
          ? vault.secretHash
          : vault.emergencyRecoveryKeyHashes.get(affected.id)
        if (!expectedHash || reconstructedHash !== expectedHash) {
          throw new Error('Reconstructed Recovery Secret does not match setup commitment')
        }

        trace('SHAMIR', `Recovery Secret ${rsLabel} rebuilt (${threshold}-of-${totalCustodians})`, [
          `How Shamir works: at setup, ${rsLabel} was split into ${totalCustodians} pieces.`,
          `Policy requires any ${threshold} pieces — not all ${totalCustodians} — to rebuild the secret.`,
          `One piece alone reveals nothing; ${threshold} together reconstruct the original ${rsLabel}.`,
          `This session used: ${shareIds}`,
          `Verified OK — rebuilt secret matches the fingerprint saved at setup.`,
        ])

        patchRequest(requestId, {
          tempSecretExpiresAt: new Date(Date.now() + 45_000).toISOString(),
          secretCleared: false,
        })
        pushAudit('Recovery secret reconstructed', {
          actorId: 'SYSTEM',
          requestId,
          metadata: { type: rsLabel, location: 'volatile memory only' },
          result: 'INFO',
        })
        return `Recovery Secret ${rsLabel} assembled in volatile memory`
      })

      let recoveredVaultKey = ''
      await runStep(requestId, 3, 900, async () => {
        const useWorkspaceRs = vault.recoverySecretEnvelopes.has(affected.id) && !!vault.secretHash
        const envelope = useWorkspaceRs
          ? vault.recoverySecretEnvelopes.get(affected.id)
          : vault.emergencyRecoveryEnvelopes.get(affected.id)
        if (!envelope || !vault.tempEmergencyKey) {
          throw new Error('Missing encrypted Vault Key envelope')
        }
        recoveredVaultKey = await unwrapEmergencyRecoveryEnvelope(
          envelope,
          vault.tempEmergencyKey,
          affected.name,
        )
        trace('ENVELOPE', `Vault Key decrypted with Recovery Secret ${rsLabel} — ${affected.name}`, [
          `Vault Key (hex): ${recoveredVaultKey}`,
          `IV: ${envelope.iv}`,
        ])
        return `Vault Key decrypted with ${rsLabel}`
      })

      await runStep(requestId, 4, 900, async () => {
        if (recoveredVaultKey !== originalVaultKey) {
          throw new Error('Recovered Vault Key does not match original')
        }
        const vaultKeyHash = await sha256hex(
          new Uint8Array(recoveredVaultKey.match(/.{2}/g)!.map((b) => parseInt(b, 16))),
        )
        patchRequest(requestId, { recoveredDekFingerprint: vaultKeyHash.slice(0, 12) })
        pushAudit('Vault Key recovered', {
          actorId: 'SYSTEM',
          requestId,
          target: affected.name,
          metadata: { sameVaultKey: true },
        })
        return 'Same Vault Key recovered (not re-issued)'
      })

      let hashKeyHex = ''
      let hashKeyExpiresAt = ''
      await runStep(requestId, 5, 800, async () => {
        const sessionToken = randomSecret(32)
        hashKeyHex = await sha256hex(sessionToken)
        wipe(sessionToken)
        hashKeyExpiresAt = new Date(Date.now() + HASH_KEY_TTL_MS).toISOString()
        vault.recoveryHashKeys.set(requestId, hashKeyHex)
        patchRequest(requestId, { hashKeyExpiresAt })
        trace('KEYGEN', `Temporary hash key created — ${affected.name}`, [
          `hash key = SHA-256(random session token): ${hashKeyHex}`,
          `time-limited: expires ${hashKeyExpiresAt}`,
          'delivered only inside the one-time email link — never stored in plaintext on the server',
        ])
        pushAudit('Temporary hash key created', {
          actorId: 'SYSTEM',
          requestId,
          target: affected.name,
          metadata: { expiresAt: hashKeyExpiresAt },
          result: 'INFO',
        })
        return 'Time-limited hash key derived for temporary Vault Key storage'
      })

      await runStep(requestId, 6, 900, async () => {
        const envelope = await createTempHashKeyEnvelope(
          recoveredVaultKey,
          hashKeyHex,
          affected.name,
        )
        vault.tempVaultKeyEnvelopes.set(requestId, envelope)
        trace('ENVELOPE', `Encrypted Vault Key stored temporarily on server — ${affected.name}`, [
          envelope.ciphertext,
          `storage is temporary — deleted after recovery completes or the hash key expires`,
        ])
        pushAudit('Vault Key stored temporarily', {
          actorId: 'SYSTEM',
          requestId,
          target: affected.name,
          metadata: { encryptedWith: 'temporary hash key', expiresAt: hashKeyExpiresAt },
        })
        return 'Restored Vault Key sealed with hash key — temporary server storage'
      })

      await runStep(requestId, 7, 800, async () => {
        wipe(vault.tempEmergencyKey)
        vault.tempEmergencyKey = null
        trace('WIPE', `Recovery session material cleared (${rsLabel})`, [
          'plaintext Recovery Secret overwritten with zeros in volatile memory',
          'custodian session shares destroyed',
          'only the hash-key-encrypted Vault Key (temporary) remains server-side',
        ])
        patchRequest(requestId, { secretCleared: true })
        pushAudit('Recovery secret destroyed', {
          actorId: 'SYSTEM',
          requestId,
          metadata: { type: rsLabel },
          result: 'INFO',
        })
        return `Recovery session material cleared (${rsLabel})`
      })

      await runStep(requestId, 8, 600, async () => {
        pushAudit('Recovery session completed', {
          actorId,
          requestId,
          target: affected.name,
          metadata: {
            phase: 'temporary Vault Key stored — awaiting user via email link',
            temporaryStorageExpiresAt: hashKeyExpiresAt,
          },
        })
        return 'Recovery event and temporary Vault Key storage fully logged'
      })

      await runStep(requestId, 9, 700, async () => {
        patchRequest(requestId, { recoveryEmailSentTo: affected.email })
        trace('INFO', `Recovery email sent — ${affected.name}`, [
          `to: ${affected.email}`,
          'one-time link contains the temporary hash key (never stored server-side in plaintext)',
          'opening the link lets the user set a new password and decrypt the Vault Key',
        ])
        pushAudit('Recovery email sent', {
          actorId: 'SYSTEM',
          requestId,
          target: affected.email,
          metadata: { linkExpiresAt: hashKeyExpiresAt },
        })
        return `One-time recovery link sent to ${affected.email}`
      })

      patchRequest(requestId, { status: 'AWAITING_EMAIL_LINK' })
      set({
        notice: {
          tone: 'info',
          text: `Emergency recovery session complete. A one-time recovery link was emailed to ${affected.email}. ${affected.name} must open it to set a new password and decrypt the Vault Key.`,
        },
      })
    } catch (err) {
      wipe(vault.tempEmergencyKey)
      vault.tempEmergencyKey = null
      vault.recoveryHashKeys.delete(requestId)
      vault.tempVaultKeyEnvelopes.delete(requestId)
      patchRequest(requestId, { status: 'FAILED', secretCleared: true })
      pushAudit('Recovery session completed', {
        actorId,
        requestId,
        result: 'FAILURE',
        metadata: { error: String(err) },
      })
    }
  }

  // -------- store object -------------------------------------------------

  return {
    ready: false,
    scenario: 'standard',
    workspaceName: 'Acme Hardware',
    currentUserId: 'alice',
    demoAuthenticated: false,
    demoOnboardingComplete: false,
    users: [],
    policy: {
      mode: 'CUSTOMER_ONLY',
      threshold: 2,
      totalParties: 3,
      parties: [],
      setupGenerated: false,
      secretVersion: 0,
      pendingChanges: [],
    },
    requests: [],
    reshareProposal: null,
    audit: [],
    notice: null,

    // Switching to Demo User normally requires login again — except when recovery is
    // waiting for the one-time email link / new password (skip login, go finish it).
    setRole: (userId) => {
      const { users, requests } = get()
      const user = users.find((u) => u.id === userId)
      const finishingRecovery =
        user?.role === 'DEMO_USER' &&
        requests.some(
          (r) =>
            r.affectedUserId === userId &&
            (r.status === 'AWAITING_EMAIL_LINK' || r.status === 'AWAITING_NEW_PASSWORD'),
        )
      set({
        currentUserId: userId,
        notice: null,
        demoAuthenticated: finishingRecovery,
      })
    },

    loginDemo: () => {
      const demo = get().users.find((u) => u.role === 'DEMO_USER')
      if (!demo) return
      set({
        currentUserId: demo.id,
        demoAuthenticated: true,
        demoOnboardingComplete: get().policy.setupGenerated,
        notice: null,
      })
      pushAudit('User signed in', { actorId: demo.id, result: 'INFO' })
    },
    completeDemoOnboarding: () => set({ demoOnboardingComplete: true }),
    setNotice: (notice) => set({ notice }),
    loadScenario: bootstrap,

    setMode: (mode) => {
      const { currentUserId, policy } = get()
      let parties = policy.parties
      if (mode === 'CUSTOMER_ONLY') {
        parties = parties.filter((p) => p.type !== 'TRACELIUM_ADMIN')
      }
      set((s) => ({ policy: { ...s.policy, mode, parties } }))
      markPolicyOutdated(currentUserId, `Recovery mode set to ${mode}`)
    },

    setThreshold: (threshold) => {
      const { currentUserId, policy } = get()
      set((s) => ({ policy: { ...s.policy, threshold } }))
      markPolicyOutdated(
        currentUserId,
        `Quorum changed to ${threshold}-of-${policy.totalParties}`,
      )
    },

    setTotalParties: (totalParties) => {
      const { currentUserId, policy } = get()
      set((s) => ({ policy: { ...s.policy, totalParties } }))
      markPolicyOutdated(
        currentUserId,
        `Quorum changed to ${policy.threshold}-of-${totalParties}`,
      )
    },

    addMemberParty: (userId) => {
      const { users, currentUserId, policy, reshareProposal } = get()
      const user = users.find((u) => u.id === userId)
      if (!user) return
      if (
        reshareProposal &&
        (reshareProposal.status === 'PENDING_APPROVAL' || reshareProposal.status === 'QUORUM_REACHED')
      ) {
        set({
          notice: {
            tone: 'warning',
            text: 'A reshare proposal is already in progress. Finish or cancel it first.',
          },
        })
        return
      }

      const active = policy.parties.filter((p) => p.status === 'ACTIVE')
      if (active.some((p) => p.userId === userId)) return

      const party: RecoveryParty = {
        id: `PTY-${String(++partySeq).padStart(3, '0')}`,
        type: 'WORKSPACE_MEMBER',
        userId,
        displayName: user.name,
        email: user.email,
        status: 'ACTIVE',
      }

      // No Recovery Secret yet → add to the list normally (no approve / no RS upgrade)
      if (!hasLiveRecoverySecret()) {
        if (active.length >= policy.totalParties) return
        set((s) => ({ policy: { ...s.policy, parties: [...s.policy.parties, party] } }))
        pushAudit('Recovery party added', { actorId: currentUserId, target: user.name })
        return
      }

      // Recovery Secret exists → request approvals, then unwrap Vault Key and seal under RS-v(N+1)
      const holders = liveRsHolders(policy.parties)
      if (holders.length < policy.threshold) {
        set({ notice: { tone: 'danger', text: 'Not enough RS holders to authorize a party change.' } })
        return
      }
      const needSlot = active.length >= policy.totalParties
      const proposal: ReshareProposal = {
        id: `RSH-${String(++reshareSeq).padStart(3, '0')}`,
        kind: 'ADD_PARTY',
        status: 'PENDING_APPROVAL',
        fromSecretVersion: policy.secretVersion,
        createdBy: currentUserId,
        createdAt: nowIso(),
        approverPartyIds: holders.map((p) => p.id),
        requiredApprovals: policy.threshold,
        approvals: [],
        pendingParty: party,
        proposedTotalParties: needSlot ? policy.totalParties + 1 : undefined,
        reason: needSlot
          ? `Add ${user.name} and expand quorum to ${policy.threshold}-of-${policy.totalParties + 1}`
          : `Add ${user.name} as recovery custodian`,
      }
      set({
        reshareProposal: proposal,
        notice: null,
      })
      pushAudit('Reshare proposal created', {
        actorId: currentUserId,
        target: user.name,
        metadata: { kind: 'ADD_PARTY', from: `RS-v${policy.secretVersion}` },
      })
      trace('INFO', `Reshare proposal — add ${user.name}`, [
        `Current RS-v${policy.secretVersion} holders must approve before RS-v${policy.secretVersion + 1}`,
        `Required: ${policy.threshold} of ${holders.length} custodian approvals`,
        'The new person receives a share only after upgrade completes',
      ])
    },

    addExternalParty: (email) => {
      const { currentUserId, policy, reshareProposal } = get()
      if (
        reshareProposal &&
        (reshareProposal.status === 'PENDING_APPROVAL' || reshareProposal.status === 'QUORUM_REACHED')
      ) {
        set({
          notice: {
            tone: 'warning',
            text: 'A reshare proposal is already in progress. Finish or cancel it first.',
          },
        })
        return
      }
      const active = policy.parties.filter((p) => p.status === 'ACTIVE')
      const uid = `ext-${++extSeq}`
      const pseudoUser: User = {
        id: uid,
        name: `Recovery Contact (${email})`,
        email,
        role: 'RECOVERY_CONTACT',
        keyVersion: 0,
        keyStatus: 'ACTIVE',
        fingerprint: '—',
        envelopeVersion: 0,
      }
      const party: RecoveryParty = {
        id: `PTY-${String(++partySeq).padStart(3, '0')}`,
        type: 'EXTERNAL_EMAIL',
        userId: uid,
        displayName: 'Secondary Recovery Identity',
        email,
        status: 'ACTIVE',
      }

      if (!hasLiveRecoverySecret()) {
        if (active.length >= policy.totalParties) return
        set((s) => ({
          users: [...s.users.filter((u) => !u.isSystem), pseudoUser, ...s.users.filter((u) => u.isSystem)],
          policy: { ...s.policy, parties: [...s.policy.parties, party] },
        }))
        pushAudit('Recovery party added', { actorId: currentUserId, target: email })
        return
      }

      const holders = liveRsHolders(policy.parties)
      if (holders.length < policy.threshold) {
        set({ notice: { tone: 'danger', text: 'Not enough RS holders to authorize a party change.' } })
        return
      }
      const needSlot = active.length >= policy.totalParties
      const proposal: ReshareProposal = {
        id: `RSH-${String(++reshareSeq).padStart(3, '0')}`,
        kind: 'ADD_PARTY',
        status: 'PENDING_APPROVAL',
        fromSecretVersion: policy.secretVersion,
        createdBy: currentUserId,
        createdAt: nowIso(),
        approverPartyIds: holders.map((p) => p.id),
        requiredApprovals: policy.threshold,
        approvals: [],
        pendingParty: party,
        pendingUser: pseudoUser,
        proposedTotalParties: needSlot ? policy.totalParties + 1 : undefined,
        reason: `Add secondary recovery identity ${email}`,
      }
      set({
        reshareProposal: proposal,
        notice: null,
      })
      pushAudit('Reshare proposal created', {
        actorId: currentUserId,
        target: email,
        metadata: { kind: 'ADD_PARTY' },
      })
    },

    addTraceliumParty: () => {
      const { currentUserId, policy, reshareProposal } = get()
      if (policy.parties.some((p) => p.type === 'TRACELIUM_ADMIN')) return
      if (
        reshareProposal &&
        (reshareProposal.status === 'PENDING_APPROVAL' || reshareProposal.status === 'QUORUM_REACHED')
      ) {
        set({
          notice: {
            tone: 'warning',
            text: 'A reshare proposal is already in progress. Finish or cancel it first.',
          },
        })
        return
      }
      const active = policy.parties.filter((p) => p.status === 'ACTIVE')
      const party: RecoveryParty = {
        id: `PTY-${String(++partySeq).padStart(3, '0')}`,
        type: 'TRACELIUM_ADMIN',
        userId: 'tracelium-admin',
        displayName: 'Tracelium System Admin',
        email: 'sysadmin@tracelium.io',
        status: 'ACTIVE',
      }

      if (!hasLiveRecoverySecret()) {
        if (active.length >= policy.totalParties) return
        set((s) => ({
          policy: { ...s.policy, mode: 'HYBRID', parties: [...s.policy.parties, party] },
        }))
        pushAudit('Recovery party added', {
          actorId: currentUserId,
          target: 'Tracelium System Admin',
          metadata: { note: 'Cannot recover the workspace independently' },
        })
        return
      }

      const holders = liveRsHolders(policy.parties)
      if (holders.length < policy.threshold) {
        set({ notice: { tone: 'danger', text: 'Not enough RS holders to authorize a party change.' } })
        return
      }
      const needSlot = active.length >= policy.totalParties
      const proposal: ReshareProposal = {
        id: `RSH-${String(++reshareSeq).padStart(3, '0')}`,
        kind: 'ADD_PARTY',
        status: 'PENDING_APPROVAL',
        fromSecretVersion: policy.secretVersion,
        createdBy: currentUserId,
        createdAt: nowIso(),
        approverPartyIds: holders.map((p) => p.id),
        requiredApprovals: policy.threshold,
        approvals: [],
        pendingParty: party,
        proposedTotalParties: needSlot ? policy.totalParties + 1 : undefined,
        reason: 'Add Tracelium System Admin as recovery custodian',
      }
      set({
        reshareProposal: proposal,
        notice: null,
      })
      pushAudit('Reshare proposal created', {
        actorId: currentUserId,
        target: 'Tracelium System Admin',
        metadata: { kind: 'ADD_PARTY' },
      })
    },

    removeParty: (partyId) => {
      const { currentUserId, policy, reshareProposal } = get()
      const party = policy.parties.find((p) => p.id === partyId)
      if (!party) return
      if (
        reshareProposal &&
        (reshareProposal.status === 'PENDING_APPROVAL' || reshareProposal.status === 'QUORUM_REACHED')
      ) {
        set({
          notice: {
            tone: 'warning',
            text: 'A reshare proposal is already in progress. Finish or cancel it first.',
          },
        })
        return
      }

      const remaining = policy.parties.filter((p) => p.id !== partyId && p.status === 'ACTIVE')
      if (hasLiveRecoverySecret() && remaining.length < policy.threshold) {
        set({
          notice: {
            tone: 'danger',
            text: `Cannot remove ${party.displayName}: need at least ${policy.threshold} Recovery Parties remaining (would have ${remaining.length}).`,
          },
        })
        return
      }

      // Immediate remove — no approvals / no RS upgrade. Wipe demo vault share if present.
      const remShare = vault.shares.get(partyId)
      if (remShare) {
        remShare.fill(0)
        vault.shares.delete(partyId)
        trace('WIPE', `Revoked recovery share — ${party.displayName}`, [
          'Removed from Recovery Parties without RS upgrade',
          `Share wiped from vault (RS-v${policy.secretVersion} unchanged for remaining custodians)`,
        ])
      }

      const nextMode =
        party.type === 'TRACELIUM_ADMIN' && policy.mode === 'HYBRID'
          ? ('CUSTOMER_ONLY' as const)
          : policy.mode

      set((s) => ({
        policy: {
          ...s.policy,
          mode: nextMode,
          parties: s.policy.parties.filter((p) => p.id !== partyId),
        },
        users:
          party.type === 'EXTERNAL_EMAIL'
            ? s.users.filter((u) => u.id !== party.userId)
            : s.users,
        notice: {
          tone: 'success',
          text: `${party.displayName} removed from Recovery Parties.`,
        },
      }))
      pushAudit('Recovery party removed', {
        actorId: currentUserId,
        target: party.displayName,
        metadata: hasLiveRecoverySecret()
          ? { immediate: true, rsVersion: `RS-v${policy.secretVersion}` }
          : undefined,
      })
    },

    approveReshare: () => {
      const { currentUserId, policy, reshareProposal } = get()
      if (!reshareProposal || reshareProposal.status !== 'PENDING_APPROVAL') return
      // Must still be on the live Recovery Parties list (removed users cannot approve)
      const myParty = policy.parties.find(
        (p) =>
          p.status === 'ACTIVE' &&
          p.userId === currentUserId &&
          reshareProposal.approverPartyIds.includes(p.id),
      )
      if (!myParty) {
        set({
          notice: {
            tone: 'warning',
            text: 'Only people currently on the Recovery Parties list can approve this request.',
          },
        })
        return
      }
      if (reshareProposal.approvals.some((a) => a.partyId === myParty.id)) return

      const approvals = [
        ...reshareProposal.approvals,
        {
          partyId: myParty.id,
          decision: 'APPROVED' as const,
          signedAt: nowIso(),
          authenticationMethod: 'Passkey (simulated)',
        },
      ]
      const approved = approvals.filter((a) => a.decision === 'APPROVED').length
      const status =
        approved >= reshareProposal.requiredApprovals ? 'QUORUM_REACHED' : 'PENDING_APPROVAL'
      set({
        reshareProposal: { ...reshareProposal, approvals, status },
        notice: null,
      })
      pushAudit('Reshare approved', {
        actorId: currentUserId,
        target: myParty.displayName,
        metadata: { approved, required: reshareProposal.requiredApprovals },
      })
      trace('INFO', `Reshare approved — ${myParty.displayName}`, [
        `RS-v${reshareProposal.fromSecretVersion} custodian authorization`,
        `${approved} of ${reshareProposal.requiredApprovals} required approvals`,
      ])
    },

    rejectReshare: () => {
      const { currentUserId, policy, reshareProposal } = get()
      if (!reshareProposal || reshareProposal.status === 'COMPLETED') return
      const onList = policy.parties.some(
        (p) =>
          p.status === 'ACTIVE' &&
          p.userId === currentUserId &&
          reshareProposal.approverPartyIds.includes(p.id),
      )
      if (!onList) {
        set({
          notice: {
            tone: 'warning',
            text: 'Only people currently on the Recovery Parties list can reject this request.',
          },
        })
        return
      }
      set({
        reshareProposal: null,
        notice: {
          tone: 'warning',
          text: 'Reshare proposal rejected. Party list unchanged.',
        },
      })
      pushAudit('Reshare rejected', { actorId: currentUserId, result: 'FAILURE' })
    },

    cancelReshare: () => {
      const { currentUserId, reshareProposal } = get()
      if (!reshareProposal || reshareProposal.status === 'COMPLETED') return
      set({
        reshareProposal: null,
        notice: { tone: 'info', text: 'Reshare proposal cancelled.' },
      })
      pushAudit('Reshare rejected', {
        actorId: currentUserId,
        metadata: { cancelled: true },
        result: 'INFO',
      })
    },

    completeReshareAndUpgrade: async () => {
      const { currentUserId, users, policy, reshareProposal } = get()
      if (!reshareProposal || reshareProposal.status !== 'QUORUM_REACHED') return
      const actor = users.find((u) => u.id === currentUserId)
      if (!actor || actor.role !== 'OWNER') {
        set({
          notice: { tone: 'warning', text: 'Only the Workspace Owner can complete the RS upgrade.' },
        })
        return
      }

      const rsLabel = `RS-v${reshareProposal.fromSecretVersion}`
      const approvedIds = reshareProposal.approvals
        .filter((a) => a.decision === 'APPROVED')
        .map((a) => a.partyId)
        .slice(0, reshareProposal.requiredApprovals)

      try {
        const loadedShares = approvedIds
          .map((pid) => vault.shares.get(pid))
          .filter((s): s is Uint8Array => !!s)
        if (loadedShares.length < reshareProposal.requiredApprovals) {
          throw new Error('Missing custodian shares for reshare')
        }

        const reconstructed = await combineShares(loadedShares, reshareProposal.requiredApprovals)
        const hash = await sha256hex(reconstructed)
        if (!vault.secretHash || hash !== vault.secretHash) {
          wipe(reconstructed)
          throw new Error('Reconstructed RS does not match setup commitment')
        }

        const sealedOwnerId = [...vault.recoverySecretEnvelopes.keys()][0]
        const sealed = sealedOwnerId ? vault.recoverySecretEnvelopes.get(sealedOwnerId) : undefined
        if (!sealed || !sealedOwnerId) {
          wipe(reconstructed)
          throw new Error('No Vault Key envelope under current RS')
        }
        const sealedUser = users.find((u) => u.id === sealedOwnerId)
        const vaultKeyHex = await unwrapEmergencyRecoveryEnvelope(
          sealed,
          reconstructed,
          sealedUser?.name ?? sealedOwnerId,
        )
        vault.vaultKeys.set(sealedOwnerId, vaultKeyHex)
        wipe(reconstructed)

        trace('SHAMIR', `${rsLabel} reconstructed for custodian rotation`, [
          `${reshareProposal.requiredApprovals} approved custodians released shares.`,
          `Recovery Secret ${rsLabel} rebuilt in memory.`,
        ])
        trace('ENVELOPE', `Vault Key decrypted with ${rsLabel} — will re-seal under RS-v${reshareProposal.fromSecretVersion + 1}`, [
          `owner: ${sealedUser?.name ?? sealedOwnerId}`,
          `Vault Key (hex): ${vaultKeyHex}`,
        ])

        let parties = [...policy.parties]
        let nextUsers = users
        let nextMode = policy.mode
        let nextTotal = policy.totalParties

        if (reshareProposal.pendingParty) {
          if (reshareProposal.pendingUser) {
            nextUsers = [
              ...users.filter((u) => !u.isSystem),
              reshareProposal.pendingUser,
              ...users.filter((u) => u.isSystem),
            ]
          }
          parties = [...parties, reshareProposal.pendingParty]
          if (reshareProposal.pendingParty.type === 'TRACELIUM_ADMIN') nextMode = 'HYBRID'
          if (reshareProposal.proposedTotalParties) nextTotal = reshareProposal.proposedTotalParties
        }

        set({
          users: nextUsers,
          currentUserId: sealedOwnerId,
          policy: {
            ...policy,
            mode: nextMode,
            totalParties: nextTotal,
            parties,
            setupGenerated: false,
            pendingChanges: [...policy.pendingChanges, reshareProposal.reason],
          },
          reshareProposal: { ...reshareProposal, status: 'COMPLETED' },
        })

        await generateRecoverySetup()

        set({
          currentUserId: 'alice',
          reshareProposal: null,
          notice: {
            tone: 'success',
            text: `Party change applied. Recovery Secret upgraded to RS-v${get().policy.secretVersion}. Fresh shares issued to current custodians.`,
          },
        })
        pushAudit('Reshare completed', {
          actorId: currentUserId,
          metadata: {
            from: rsLabel,
            to: `RS-v${get().policy.secretVersion}`,
            kind: reshareProposal.kind,
          },
        })
      } catch (err) {
        set({
          notice: {
            tone: 'danger',
            text: `Reshare failed: ${String(err)}`,
          },
        })
      }
    },

    clearRecoverySetup: () => {
      vault.shares.forEach((s) => s.fill(0))
      vault.shares.clear()
      vault.userEmergencyShares.forEach((m) => {
        m.forEach((s) => s.fill(0))
        m.clear()
      })
      vault.userEmergencyShares.clear()
      vault.recoverySecretEnvelopes.clear()
      vault.secretHash = null
      set((s) => ({
        currentUserId: 'alice',
        reshareProposal: null,
        policy: {
          ...s.policy,
          setupGenerated: false,
          secretVersion: 0,
          pendingChanges: [],
          parties: s.policy.parties.map((p) => ({ ...p, shareId: undefined })),
        },
      }))
      trace('INFO', 'Demo 1 started — existing recovery setup cleared', [
        'shares were destroyed so the creation can be shown live',
      ])
    },

    generateRecoverySetup,

    runRecoveryTest: async () => {
      const { policy, currentUserId } = get()
      const active = policy.parties.filter((p) => p.status === 'ACTIVE')
      const checks: TestCheck[] = []

      checks.push({
        label: 'Recovery parties are active',
        ok: active.length >= Math.max(policy.threshold, 1),
        detail: `${active.length} active, ${policy.threshold} required`,
      })
      checks.push({
        label: 'Quorum can be reached',
        ok:
          policy.setupGenerated &&
          policy.threshold >= 1 &&
          policy.threshold <= active.length,
        detail: policy.setupGenerated
          ? `${policy.threshold}-of-${active.length}`
          : 'Recovery setup has not been generated',
      })
      const sharesOk =
        active.length > 0 && active.every((p) => vault.shares.has(p.id))
      checks.push({
        label: 'All shares are available',
        ok: sharesOk,
        detail: sharesOk ? `${active.length} protected shares` : 'Missing shares',
      })

      let reconstructOk = false
      let tamperRejected = false
      if (sharesOk && policy.setupGenerated && vault.secretHash) {
        try {
          const testShares = active
            .slice(0, policy.threshold)
            .map((p) => vault.shares.get(p.id)!)
          const secret = await combineShares(
            testShares,
            policy.threshold,
            'recovery test (dry run)',
          )
          const hash = await sha256hex(secret)
          reconstructOk = hash === vault.secretHash
          trace(
            'VERIFY',
            reconstructOk
              ? 'Reconstructed secret matches setup commitment'
              : 'Reconstructed secret does not match setup commitment',
            [
              `setup SHA-256:       ${vault.secretHash}`,
              `reconstructed SHA-256: ${hash}`,
            ],
          )
          wipe(secret)
          trace('WIPE', 'Recovery test secret cleared from memory')

          const tampered = testShares.map((s) => s.slice())
          tampered[0][1] ^= 0xff
          const wrongSecret = await combineShares(
            tampered,
            policy.threshold,
            'tamper test (one share byte flipped)',
          )
          const wrongHash = await sha256hex(wrongSecret)
          tamperRejected = wrongHash !== vault.secretHash
          wipe(wrongSecret)
          if (tamperRejected) {
            trace('VERIFY', 'Tampered share failed commitment check', [
              'one byte of one share was intentionally modified for this test',
              'reconstructed SHA-256 no longer matches the setup commitment',
              'shares cannot be forged or partially guessed',
            ])
          }
        } catch {
          reconstructOk = false
        }
      }
      checks.push({
        label: 'Shamir reconstruction is valid',
        ok: reconstructOk,
        detail: reconstructOk
          ? 'Test reconstruction matched the setup commitment'
          : 'Reconstruction did not match',
      })
      checks.push({
        label: 'Tampered shares are rejected',
        ok: tamperRejected,
        detail: tamperRejected
          ? 'Flipped-byte share produced a wrong fingerprint (expected)'
          : 'Negative test could not run',
      })
      checks.push({ label: 'Audit log is working', ok: true })

      const ok = checks.every((c) => c.ok)
      set((s) => ({
        policy: { ...s.policy, lastTest: { at: nowIso(), ok, checks } },
      }))
      pushAudit('Recovery test executed', {
        actorId: currentUserId,
        result: ok ? 'SUCCESS' : 'FAILURE',
        metadata: { checks: checks.map((c) => `${c.label}: ${c.ok ? 'OK' : 'FAIL'}`) },
      })
    },

    simulateKeyLoss: (userId) => {
      const { users, currentUserId } = get()
      const user = users.find((u) => u.id === userId)
      if (!user || user.keyVersion === 0) return
      patchUser(userId, { keyStatus: 'LOST' })
      pushAudit('Key loss reported', {
        actorId: currentUserId,
        target: userKeyLabel(user),
        result: 'INFO',
      })
    },

    reportAccountAccessLost: () => {
      const { users, currentUserId } = get()
      const user = users.find((u) => u.id === currentUserId)
      if (!user || user.role !== 'DEMO_USER' || user.keyStatus === 'LOST') return
      patchUser(user.id, { keyStatus: 'LOST' })
      pushAudit('Account access lost reported', {
        actorId: currentUserId,
        target: user.name,
        result: 'INFO',
        metadata: {
          key: userKeyLabel(user),
          channel: 'account-recovery',
        },
      })
    },

    submitAccountRecovery: (reason) => {
      const { users, currentUserId, policy } = get()
      const user = users.find((u) => u.id === currentUserId)
      if (!user || user.role !== 'DEMO_USER') return null
      if (user.keyStatus !== 'LOST') {
        set({
          notice: {
            tone: 'warning',
            text: 'Report lost access before submitting an account recovery request.',
          },
        })
        return null
      }
      const open = get().requests.some(
        (r) =>
          r.affectedUserId === user.id &&
          OPEN_REQUEST_STATUSES.includes(r.status as (typeof OPEN_REQUEST_STATUSES)[number]),
      )
      if (open) {
        set({
          notice: {
            tone: 'info',
            text: 'You already have an open account recovery request.',
          },
        })
        return null
      }
      const id = get().createRequest('EMERGENCY_RECOVERY', user.id, reason)
      if (!id) return null
      pushAudit('Account recovery requested', {
        actorId: currentUserId,
        requestId: id,
        target: user.name,
        metadata: { reason, flow: 'self-service' },
      })
      return id
    },

    createRequest: (type, affectedUserId, reason) => {
      const { users, policy, currentUserId } = get()
      const affected = users.find((u) => u.id === affectedUserId)
      if (!affected) return null
      const needsSetup =
        (type === 'BREAK_GLASS' || type === 'EMERGENCY_RECOVERY') &&
        (!policy.setupGenerated || policy.mode === 'DISABLED')
      if (needsSetup) {
        set({
          notice: {
            tone: 'danger',
            text:
              type === 'EMERGENCY_RECOVERY'
                ? 'Emergency recovery is not available: no recovery setup has been generated for this workspace.'
                : 'Break-glass recovery is not available: no recovery setup has been generated for this workspace.',
          },
        })
        return null
      }
      const id = `REC-${++reqSeq}`
      const skipOwnerApproval =
        type === 'EMERGENCY_RECOVERY' && affected.role === 'OWNER'
      const initialStatus =
        type === 'EMERGENCY_RECOVERY' && !skipOwnerApproval
          ? 'PENDING_OWNER_APPROVAL'
          : 'PENDING_APPROVAL'
      const request: RecoveryRequest = {
        id,
        type,
        workspaceId: 'ws-1',
        affectedUserId,
        requestedBy: currentUserId,
        reason,
        requiredApprovals: type === 'USER_KEY_RESET' ? 1 : policy.threshold,
        approvals: [],
        status: initialStatus,
        ownerApproved: skipOwnerApproval ? true : undefined,
        createdAt: nowIso(),
        expiresAt: hoursFromNow(24),
        steps: freshSteps(
          type === 'USER_KEY_RESET'
            ? USER_RESET_STEPS
            : type === 'EMERGENCY_RECOVERY'
              ? emergencyRecoverySteps(policy.secretVersion)
              : BREAK_GLASS_STEPS,
        ),
      }
      set((s) => ({ requests: [request, ...s.requests] }))
      pushAudit('Recovery request created', {
        actorId: currentUserId,
        requestId: id,
        target: affected.name,
        metadata: { type, reason },
      })
      return id
    },

    approveKeyReset: async (requestId) => {
      const { requests, users, currentUserId } = get()
      const req = requests.find((r) => r.id === requestId)
      const approver = users.find((u) => u.id === currentUserId)
      if (!req || req.type !== 'USER_KEY_RESET' || req.status !== 'PENDING_APPROVAL') return
      if (!approver || approver.role !== 'OWNER') return
      const affected = users.find((u) => u.id === req.affectedUserId)
      if (!affected) return
      const oldKey = userKeyLabel(affected)

      patchRequest(requestId, {
        status: 'RECOVERY_IN_PROGRESS',
        approvals: [
          {
            partyId: currentUserId,
            decision: 'APPROVED',
            signedAt: nowIso(),
            authenticationMethod: 'Passkey',
          },
        ],
      })
      trace('VERIFY', `Owner approval recorded — ${approver.name}`, [
        `reviewed request ${requestId}: affected ${affected.name}, current key ${oldKey}, reason "${req.reason}"`,
        'decision APPROVED signed with passkey and stored in the audit trail',
        'this authorizes: revoke old key → create new user key pair',
      ])
      pushAudit('User key reset', {
        actorId: currentUserId,
        requestId,
        target: affected.name,
        metadata: { approvedBy: approver.name },
      })

      try {
        await runStep(requestId, 0, 800, async () => `All sessions for ${affected.name} invalidated`)
        await runStep(requestId, 1, 800, async () => {
          pushAudit('Old key revoked', { actorId: 'SYSTEM', requestId, target: oldKey })
          return `${oldKey} marked as revoked`
        })

        let newFingerprint = ''
        await runStep(requestId, 2, 1000, async () => {
          const pair = await generateUserKeyPair(
            `${affected.name} (UK-${firstName(affected)}-v${affected.keyVersion + 1})`,
          )
          vault.userKeys.set(affected.id, pair)
          const vaultKey = createRandomKey(256)
          vault.vaultKeys.set(affected.id, vaultKey)
          newFingerprint = await fingerprintPublicKey(pair.publicKey)
          trace('KEYGEN', `User Recovery DEK re-issued — ${affected.name}`, [
            `new 256-bit DEK (hex): ${vaultKey}`,
          ])
          pushAudit('New user key generated', {
            actorId: 'SYSTEM',
            requestId,
            target: `UK-${firstName(affected)}-v${affected.keyVersion + 1}`,
          })
          return `UK-${firstName(affected)}-v${affected.keyVersion + 1} created on user's trusted client`
        })

        await runStep(requestId, 3, 600)

        patchUser(affected.id, {
          keyVersion: affected.keyVersion + 1,
          keyStatus: 'ACTIVE',
          fingerprint: newFingerprint,
        })
        patchRequest(requestId, {
          status: 'COMPLETED',
          resultSummary: {
            oldKey,
            newKey: `UK-${firstName(affected)}-v${affected.keyVersion + 1}`,
            dataReencrypted: false,
          },
        })
        pushAudit('Recovery session completed', {
          actorId: currentUserId,
          requestId,
          target: affected.name,
        })
        set({
          notice: {
            tone: 'success',
            text: `${affected.name} regained access with a new key. The old key was revoked and no workspace data was re-encrypted.`,
          },
        })
      } catch (err) {
        patchRequest(requestId, { status: 'FAILED' })
        pushAudit('Recovery session completed', {
          actorId: currentUserId,
          requestId,
          result: 'FAILURE',
          metadata: { error: String(err) },
        })
      }
    },

    approveEmergencyRecoveryOwner: (requestId) => {
      const { requests, users, currentUserId } = get()
      const req = requests.find((r) => r.id === requestId)
      const approver = users.find((u) => u.id === currentUserId)
      if (!req || req.type !== 'EMERGENCY_RECOVERY' || req.status !== 'PENDING_OWNER_APPROVAL') return
      if (!approver || approver.role !== 'OWNER') return
      const affected = users.find((u) => u.id === req.affectedUserId)
      if (!affected) return

      patchRequest(requestId, {
        status: 'PENDING_APPROVAL',
        ownerApproved: true,
        ownerApprovedAt: nowIso(),
      })
      trace('VERIFY', `Owner approved emergency recovery — ${approver.name}`, [
        `reviewed request ${requestId}: affected ${affected.name}, reason "${req.reason}"`,
        'decision APPROVED — recovery custodians may now release Shamir shares',
      ])
      pushAudit('Emergency recovery owner approved', {
        actorId: currentUserId,
        requestId,
        target: affected.name,
      })
      set({
        notice: {
          tone: 'info',
          text: `Owner approved ${requestId}. Recovery custodians can now authenticate and release their shares.`,
        },
      })
    },

    approveBreakGlass: (requestId) => {
      const { requests, policy, currentUserId } = get()
      const req = requests.find((r) => r.id === requestId)
      const isEmergency = req?.type === 'EMERGENCY_RECOVERY'
      const isBreakGlass = req?.type === 'BREAK_GLASS'
      if (!req || (!isEmergency && !isBreakGlass) || req.status !== 'PENDING_APPROVAL') return
      const party = policy.parties.find(
        (p) => p.status === 'ACTIVE' && p.userId === currentUserId,
      )
      if (!party) return
      if (req.approvals.some((a) => a.partyId === party.id)) return

      const approvals = [
        ...req.approvals,
        {
          partyId: party.id,
          decision: 'APPROVED' as const,
          signedAt: nowIso(),
          authenticationMethod: 'Passkey',
        },
      ]
      const approvedCount = approvals.filter((a) => a.decision === 'APPROVED').length
      const quorum = approvedCount >= req.requiredApprovals

      patchRequest(requestId, {
        approvals,
        status: quorum ? 'QUORUM_REACHED' : 'PENDING_APPROVAL',
      })
      trace('VERIFY', `Approval recorded — ${party.displayName}`, [
        're-authenticated with passkey; the decision is signed and stored',
        `stored record: { party: ${party.displayName}, share: ${party.shareId}, decision: APPROVED, method: Passkey }`,
        isEmergency
          ? `Shamir share for Recovery Secret authorized for release`
          : `share ${party.shareId} is now authorized for release into this recovery session`,
        `aggregation: ${approvedCount} of ${req.requiredApprovals} required approvals collected`,
      ])
      pushAudit('Party approved', {
        actorId: currentUserId,
        requestId,
        target: party.displayName,
        metadata: {
          progress: `${approvedCount} of ${req.requiredApprovals}`,
          authenticationMethod: 'Passkey',
        },
      })
      if (quorum) {
        trace('INFO', 'Quorum aggregated — enough approvals collected', [
          `${approvedCount} of ${req.requiredApprovals} signed approvals on record`,
          'the authorized shares can now be combined inside a recovery session',
        ])
        pushAudit('Quorum reached', {
          actorId: 'SYSTEM',
          requestId,
          metadata: { approvals: `${approvedCount} of ${req.requiredApprovals}` },
        })
        set({
          notice: {
            tone: 'info',
            text: `Quorum reached for ${requestId}. The recovery session can now begin.`,
          },
        })
      }
    },

    rejectRequest: (requestId) => {
      const { requests, policy, currentUserId } = get()
      const req = requests.find((r) => r.id === requestId)
      const rejectable = [
        'PENDING_OWNER_APPROVAL',
        'PENDING_APPROVAL',
        'QUORUM_REACHED',
      ] as const
      if (!req || !rejectable.includes(req.status as (typeof rejectable)[number])) return
      const party = policy.parties.find(
        (p) => p.status === 'ACTIVE' && p.userId === currentUserId,
      )
      patchRequest(requestId, {
        status: 'REJECTED',
        approvals: [
          ...req.approvals,
          {
            partyId: party?.id ?? currentUserId,
            decision: 'REJECTED',
            signedAt: nowIso(),
            authenticationMethod: 'Passkey',
          },
        ],
      })
      pushAudit('Party rejected', {
        actorId: currentUserId,
        requestId,
        result: 'INFO',
      })
      pushAudit('Recovery request rejected', {
        actorId: currentUserId,
        requestId,
      })
    },

    beginBreakGlassRecovery,

    beginEmergencyRecovery,

    openRecoveryEmailLink: async (requestId) => {
      const { requests, users, currentUserId } = get()
      const req = requests.find((r) => r.id === requestId)
      if (!req || req.type !== 'EMERGENCY_RECOVERY' || req.status !== 'AWAITING_EMAIL_LINK') {
        return false
      }
      const affected = users.find((u) => u.id === req.affectedUserId)
      if (!affected) return false
      if (currentUserId !== affected.id) return false

      if (req.hashKeyExpiresAt && Date.now() > new Date(req.hashKeyExpiresAt).getTime()) {
        vault.recoveryHashKeys.delete(requestId)
        vault.tempVaultKeyEnvelopes.delete(requestId)
        patchRequest(requestId, { status: 'EXPIRED' })
        pushAudit('Temporary Vault Key storage deleted', {
          actorId: 'SYSTEM',
          requestId,
          metadata: { reason: 'one-time link expired' },
          result: 'INFO',
        })
        set({
          notice: {
            tone: 'danger',
            text: 'This one-time recovery link has expired. Submit a new emergency recovery request.',
          },
        })
        return false
      }

      const hashKeyHex = vault.recoveryHashKeys.get(requestId)
      const envelope = vault.tempVaultKeyEnvelopes.get(requestId)
      const originalDek = vault.vaultKeys.get(affected.id)
      if (!hashKeyHex || !envelope || !originalDek) return false

      try {
        const recovered = await unwrapTempHashKeyEnvelope(envelope, hashKeyHex, affected.name)
        if (recovered !== originalDek) {
          throw new Error('Vault Key mismatch after hash key unwrap')
        }
        patchRequest(requestId, { status: 'AWAITING_NEW_PASSWORD' })
        pushAudit('Recovery link opened', {
          actorId: currentUserId,
          requestId,
          target: affected.name,
        })
        set({
          notice: {
            tone: 'success',
            text: 'One-time link verified — the hash key decrypted your Vault Key. Set a new password to complete recovery.',
          },
        })
        return true
      } catch {
        set({
          notice: {
            tone: 'danger',
            text: 'Could not open the recovery link. The hash key failed to decrypt the temporarily stored Vault Key.',
          },
        })
        return false
      }
    },

    setNewPasswordAfterRecovery: async (requestId, password) => {
      const { requests, users, currentUserId } = get()
      const req = requests.find((r) => r.id === requestId)
      if (!req || req.type !== 'EMERGENCY_RECOVERY' || req.status !== 'AWAITING_NEW_PASSWORD') {
        return false
      }
      const affected = users.find((u) => u.id === req.affectedUserId)
      if (!affected) return false
      if (currentUserId !== affected.id) return false
      if (!password || password.length < 8) {
        set({
          notice: {
            tone: 'warning',
            text: 'Password must be at least 8 characters.',
          },
        })
        return false
      }

      const dek = vault.vaultKeys.get(affected.id)
      if (!dek) return false

      try {
        const envelope = await createPasswordEnvelope(dek, password, affected.name)
        vault.passwordEnvelopes.set(affected.id, envelope)
        pushAudit('Password Envelope re-wrapped', {
          actorId: currentUserId,
          requestId,
          target: affected.name,
        })

        // Temporary storage is one-time: destroy the hash key and sealed Vault Key.
        vault.recoveryHashKeys.delete(requestId)
        vault.tempVaultKeyEnvelopes.delete(requestId)
        trace('WIPE', `Temporary Vault Key storage deleted — ${affected.name}`, [
          'hash-key-encrypted Vault Key removed from server',
          'temporary hash key invalidated — the one-time link no longer works',
        ])
        pushAudit('Temporary Vault Key storage deleted', {
          actorId: 'SYSTEM',
          requestId,
          target: affected.name,
          result: 'INFO',
        })
        patchUser(affected.id, {
          keyStatus: 'ACTIVE',
          envelopeVersion: affected.envelopeVersion + 1,
        })
        patchRequest(requestId, {
          status: 'COMPLETED',
          resultSummary: {
            oldKey: userKeyLabel(affected),
            newKey: userKeyLabel(affected),
            dataReencrypted: false,
            sameRecoveryDek: true,
          },
        })
        pushAudit('Recovery session completed', {
          actorId: currentUserId,
          requestId,
          target: affected.name,
          metadata: { phase: 'password envelope stored' },
        })
        set({
          notice: {
            tone: 'success',
            text: `Recovery complete. ${affected.name} can sign in with the new password. The same User Recovery DEK was preserved — no data re-encryption needed.`,
          },
        })
        return true
      } catch {
        set({
          notice: {
            tone: 'danger',
            text: 'Failed to create Password Envelope.',
          },
        })
        return false
      }
    },

    demoLostUserKey: () => {
      const { users } = get()
      const bob = users.find((u) => u.id === 'bob')
      if (!bob) {
        set({
          notice: {
            tone: 'warning',
            text: 'This scenario needs the standard workspace (Bob is not a member here). Switch scenario on the Demo Mode page.',
          },
        })
        return
      }
      get().simulateKeyLoss('bob')
      set({ currentUserId: 'bob' })
      const id = get().createRequest('USER_KEY_RESET', 'bob', 'Lost device')
      if (id) {
        set({
          notice: {
            tone: 'info',
            text: `Bob reported a lost device and submitted ${id}. Switch role to Workspace Owner to review and approve the key reset.`,
          },
        })
      }
    },

    demoLostOwnerKey: () => {
      const { users, policy } = get()
      const owner = users.find((u) => u.role === 'OWNER')
      if (!owner) return
      if (!policy.setupGenerated || policy.mode === 'DISABLED') {
        set({
          notice: {
            tone: 'danger',
            text: 'No break-glass setup exists. Configure recovery parties and generate the recovery setup first — this is exactly the single-owner risk.',
          },
        })
        return
      }
      get().simulateKeyLoss(owner.id)
      const id = get().createRequest('EMERGENCY_RECOVERY', owner.id, 'Lost password and all devices')
      if (id) {
        set({
          notice: {
            tone: 'info',
            text: `${owner.name} lost all credentials. Emergency recovery request ${id} was created — switch roles to each recovery custodian to approve until quorum is reached.`,
          },
        })
      }
    },
  }
})

let bootstrapped = false
export function initDemo(): void {
  if (bootstrapped) return
  bootstrapped = true
  void useAppStore.getState().loadScenario('standard')
}
