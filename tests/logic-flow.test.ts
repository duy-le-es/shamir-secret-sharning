// Logic end-to-end: drives the real Zustand store (real Web Crypto + Shamir)
// through all three scenarios, no browser needed.
// Run: npm run test:logic
import { useAppStore } from '../src/store/store'
import { vault } from '../src/services/vault'

const S = () => useAppStore.getState()
let failures = 0
const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    failures++
    console.error('  FAIL:', msg)
  } else {
    console.log('  OK:', msg)
  }
}
const waitFor = async (pred: () => boolean, msg: string, ms = 30000) => {
  const start = Date.now()
  while (!pred()) {
    if (Date.now() - start > ms) {
      failures++
      console.error('  TIMEOUT:', msg)
      return
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  console.log('  OK:', msg)
}

async function main() {
  console.log('\n[1] Bootstrap & recovery test')
  await S().loadScenario('standard')
  assert(S().ready, 'standard scenario bootstrapped')
  assert(!S().policy.setupGenerated, 'no recovery setup at bootstrap — creation is a demo step')
  assert(S().policy.parties.length === 3, '3 recovery parties (2-of-3 default)')
  assert(S().policy.threshold === 2 && S().policy.totalParties === 3, 'default quorum is 2-of-3')
  assert(S().users.some((u) => u.role === 'DEMO_USER'), 'demo user account exists')

  console.log('\n[1b] Demo user login gate')
  S().setRole('demo')
  assert(S().currentUserId === 'demo' && !S().demoAuthenticated, 'selecting demo user requires sign-in')
  S().loginDemo()
  assert(S().demoAuthenticated, 'demo user signed in')
  S().setRole('alice')
  assert(!S().demoAuthenticated, 'switching away resets the demo session')

  await S().generateRecoverySetup()
  assert(S().policy.setupGenerated, 'recovery setup generated')
  assert(vault.shares.size === 3, '3 Shamir shares in vault')
  assert(vault.userEmergencyShares.size >= 1, 'per-user emergency recovery shares created')
  assert(!!vault.secretHash, 'recovery secret commitment stored')
  await S().runRecoveryTest()
  assert(S().policy.lastTest?.ok === true, 'recovery test healthy (real Shamir reconstruct)')

  console.log('\n[2] Scenario A — user key reset')
  S().demoLostUserKey()
  const bob0 = S().users.find((u) => u.id === 'bob')!
  assert(bob0.keyStatus === 'LOST', 'Bob key marked LOST')
  const reqA = S().requests[0]
  assert(reqA.type === 'USER_KEY_RESET', 'user key reset request created')
  S().setRole('alice')
  await S().approveKeyReset(reqA.id)
  const bob1 = S().users.find((u) => u.id === 'bob')!
  assert(S().requests.find((r) => r.id === reqA.id)!.status === 'COMPLETED', 'key reset COMPLETED')
  assert(bob1.keyVersion === 2 && bob1.keyStatus === 'ACTIVE', 'Bob has UK-Bob-v2 ACTIVE')
  assert(bob1.fingerprint !== bob0.fingerprint, 'new key fingerprint differs (real new RSA keypair)')

  console.log('\n[3] Scenario B — emergency recovery 2-of-3')
  S().demoLostOwnerKey()
  const reqB = S().requests[0]
  assert(reqB.type === 'EMERGENCY_RECOVERY' && reqB.requiredApprovals === 2, 'emergency recovery request 2-of-3')
  assert(reqB.status === 'PENDING_APPROVAL', 'owner affected — skips owner approval gate')
  S().setRole('demo')
  S().approveBreakGlass(reqB.id)
  assert(S().requests[0].approvals.length === 0, 'non-party approval ignored')
  S().setRole('dave')
  S().approveBreakGlass(reqB.id)
  assert(S().requests[0].status === 'PENDING_APPROVAL', '1 of 2: still pending')
  S().setRole('carol')
  S().approveBreakGlass(reqB.id)
  assert(S().requests[0].status === 'QUORUM_REACHED', '2 of 2: quorum reached')

  const aliceBefore = S().users.find((u) => u.id === 'alice')!
  const dekBefore = vault.vaultKeys.get('alice')!
  await S().beginEmergencyRecovery(reqB.id)
  await waitFor(
    () => S().requests.find((r) => r.id === reqB.id)!.status === 'AWAITING_USER_CONFIRMATION',
    'emergency recovery session → awaiting user confirmation',
  )
  const pendingCode = vault.pendingPersonalRecoveryCodes.get(reqB.id)!
  assert(!!pendingCode, 'new Personal Recovery Code issued')
  S().setRole('alice')
  const confirmed = await S().confirmPersonalRecoveryCode(reqB.id, pendingCode)
  assert(confirmed, 'Personal Recovery Code confirmed')
  assert(
    S().requests.find((r) => r.id === reqB.id)!.status === 'AWAITING_NEW_PASSWORD',
    'awaiting new password',
  )
  const passwordSet = await S().setNewPasswordAfterRecovery(reqB.id, 'new-secure-password')
  assert(passwordSet, 'Password Envelope stored')
  await waitFor(
    () => S().requests.find((r) => r.id === reqB.id)!.status === 'COMPLETED',
    'emergency recovery COMPLETED',
  )
  const aliceAfter = S().users.find((u) => u.id === 'alice')!
  assert(aliceAfter.keyVersion === aliceBefore.keyVersion, 'same user key version (DEK recovered, not re-issued)')
  assert(aliceAfter.keyStatus === 'ACTIVE', 'owner ACTIVE again')
  assert(vault.vaultKeys.get('alice') === dekBefore, 'same User Recovery DEK preserved')
  assert(vault.tempEmergencyKey === null, 'temporary emergency key destroyed')
  assert(S().requests.find((r) => r.id === reqB.id)!.secretCleared === true, 'secretCleared flag set')

  const auditTypes = S().audit.map((e) => e.eventType)
  for (const t of [
    'Recovery request created',
    'Party approved',
    'Quorum reached',
    'Recovery secret reconstructed',
    'Vault Key recovered',
    'Personal Recovery Envelope re-wrapped',
    'Recovery secret destroyed',
    'Personal Recovery confirmed',
    'Password Envelope re-wrapped',
    'Recovery session completed',
  ]) {
    assert(auditTypes.includes(t), `audit contains "${t}"`)
  }

  console.log('\n[4] Scenario C — single-owner risk & hybrid 2-of-2')
  await S().loadScenario('single-owner')
  assert(S().policy.mode === 'DISABLED' && S().policy.parties.length === 0, 'single-owner starts with recovery disabled')
  S().demoLostOwnerKey()
  assert(S().requests.length === 0, 'break-glass impossible without setup (risk demonstrated)')
  assert(S().notice?.tone === 'danger', 'danger notice shown for single-owner risk')

  await S().loadScenario('single-owner')
  S().addExternalParty('alice.backup@gmail.com')
  S().addTraceliumParty()
  assert(S().policy.mode === 'HYBRID', 'adding Tracelium admin switches to HYBRID')
  S().setThreshold(2)
  await S().generateRecoverySetup()
  assert(S().policy.setupGenerated && vault.shares.size === 2, '2-of-2 hybrid setup generated')

  S().demoLostOwnerKey()
  const reqC = S().requests[0]
  S().setRole('tracelium-admin')
  S().approveBreakGlass(reqC.id)
  assert(S().requests[0].status === 'PENDING_APPROVAL', 'Tracelium admin alone cannot reach quorum')
  const ext = S().users.find((u) => u.role === 'RECOVERY_CONTACT')!
  S().setRole(ext.id)
  S().approveBreakGlass(reqC.id)
  assert(S().requests[0].status === 'QUORUM_REACHED', 'secondary identity + admin reach 2-of-2 quorum')
  await S().beginEmergencyRecovery(reqC.id)
  await waitFor(
    () => S().requests.find((r) => r.id === reqC.id)!.status === 'AWAITING_USER_CONFIRMATION',
    'hybrid emergency recovery → awaiting user confirmation',
  )
  const codeC = vault.pendingPersonalRecoveryCodes.get(reqC.id)!
  S().setRole('alice')
  await S().confirmPersonalRecoveryCode(reqC.id, codeC)
  await S().setNewPasswordAfterRecovery(reqC.id, 'hybrid-recovery-pw')
  await waitFor(
    () => S().requests.find((r) => r.id === reqC.id)!.status === 'COMPLETED',
    'hybrid emergency recovery COMPLETED',
  )

  console.log('\n[5] Party add — reshare approvals then RS-v2')
  await S().loadScenario('standard')
  S().setRole('alice')
  await S().generateRecoverySetup()
  assert(S().policy.secretVersion === 1 && S().policy.setupGenerated, 'RS-v1 live')

  // Adding Emma while slots are full proposes expand + reshare (does not mutate parties yet)
  S().addMemberParty('emma')
  const prop = S().reshareProposal
  assert(!!prop && prop.status === 'PENDING_APPROVAL', 'reshare proposal created')
  assert(prop!.kind === 'ADD_PARTY' && prop!.pendingParty?.userId === 'emma', 'pending add is Emma')
  assert(
    S().policy.parties.filter((p) => p.status === 'ACTIVE').length === 3,
    'parties unchanged until reshare completes',
  )
  assert(S().policy.setupGenerated, 'setup stays live until upgrade')

  S().setRole('dave')
  S().approveReshare()
  assert(S().reshareProposal!.status === 'PENDING_APPROVAL', '1 of 2: still pending')
  S().setRole('carol')
  S().approveReshare()
  assert(S().reshareProposal!.status === 'QUORUM_REACHED', '2 of 2: reshare quorum reached')

  S().setRole('alice')
  await S().completeReshareAndUpgrade()
  assert(S().reshareProposal === null, 'proposal cleared after upgrade')
  assert(
    S().policy.setupGenerated && S().policy.secretVersion === 2,
    'RS-v2 generated after approved add',
  )
  assert(S().policy.totalParties === 4, 'N expanded to 4')
  assert(
    S().policy.parties.filter((p) => p.status === 'ACTIVE').length === 4,
    'Emma added as 4th custodian',
  )
  assert(vault.shares.size === 4, 'fresh shares issued to all 4 current parties')

  S().demoLostOwnerKey()
  const reqD = S().requests[0]
  S().setRole('emma')
  S().approveBreakGlass(reqD.id)
  assert(S().requests[0].approvals.length === 1, 'new custodian can approve with RS-v2 share')
  S().setRole('dave')
  S().approveBreakGlass(reqD.id)
  assert(S().requests[0].status === 'QUORUM_REACHED', 'new set reaches quorum with v2 shares')

  if (failures > 0) {
    console.error(`\n${failures} CHECK(S) FAILED`)
    process.exit(1)
  }
  console.log('\nALL CHECKS PASSED')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
