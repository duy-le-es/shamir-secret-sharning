// In-memory key vault. In production each piece lives on a different
// trust boundary (user devices, party custody, server ciphertext).
import type { EnvelopeBlob } from './envelope.service'

export interface KeyVault {
  userKeys: Map<string, CryptoKeyPair> // userId -> identity keypair ("trusted client")
  vaultKeys: Map<string, string> // userId -> vault key (hex, client-only)
  /** Per-user User Emergency Recovery Key (32 bytes) — Shamir-split at setup time */
  emergencyRecoveryKeys: Map<string, Uint8Array>
  emergencyRecoveryKeyHashes: Map<string, string> // userId -> SHA-256 commitment
  /** Server-stored envelopes (ciphertext only) */
  emergencyRecoveryEnvelopes: Map<string, EnvelopeBlob>
  passwordEnvelopes: Map<string, EnvelopeBlob>
  /** Vault Key wrapped by Recovery Secret RS-vN — server-stored ciphertext */
  recoverySecretEnvelopes: Map<string, EnvelopeBlob>
  /** userId -> partyId -> Shamir share of User Emergency Recovery Key */
  userEmergencyShares: Map<string, Map<string, Uint8Array>>
  shares: Map<string, Uint8Array> // partyId -> workspace Shamir share (break-glass legacy)
  tempSecret: Uint8Array | null // workspace recovery secret during break-glass session
  tempEmergencyKey: Uint8Array | null // per-user emergency key during recovery session
  // Public commitment recorded at setup time so recovery can PROVE reconstruction.
  secretHash: string | null
  /** requestId -> restored Vault Key sealed with the temporary hash key (temporary server storage) */
  tempVaultKeyEnvelopes: Map<string, EnvelopeBlob>
  /** requestId -> temporary hash key (hex) — delivered only inside the one-time email link */
  recoveryHashKeys: Map<string, string>
}

export const vault: KeyVault = {
  userKeys: new Map(),
  vaultKeys: new Map(),
  emergencyRecoveryKeys: new Map(),
  emergencyRecoveryKeyHashes: new Map(),
  emergencyRecoveryEnvelopes: new Map(),
  passwordEnvelopes: new Map(),
  recoverySecretEnvelopes: new Map(),
  userEmergencyShares: new Map(),
  shares: new Map(),
  tempSecret: null,
  tempEmergencyKey: null,
  secretHash: null,
  tempVaultKeyEnvelopes: new Map(),
  recoveryHashKeys: new Map(),
}

export function resetVault(): void {
  vault.userKeys.clear()
  vault.vaultKeys.clear()
  vault.emergencyRecoveryKeys.forEach((k) => k.fill(0))
  vault.emergencyRecoveryKeys.clear()
  vault.emergencyRecoveryKeyHashes.clear()
  vault.emergencyRecoveryEnvelopes.clear()
  vault.passwordEnvelopes.clear()
  vault.recoverySecretEnvelopes.clear()
  vault.userEmergencyShares.forEach((m) => {
    m.forEach((s) => s.fill(0))
    m.clear()
  })
  vault.userEmergencyShares.clear()
  vault.shares.forEach((s) => s.fill(0))
  vault.shares.clear()
  if (vault.tempSecret) vault.tempSecret.fill(0)
  vault.tempSecret = null
  if (vault.tempEmergencyKey) vault.tempEmergencyKey.fill(0)
  vault.tempEmergencyKey = null
  vault.secretHash = null
  vault.tempVaultKeyEnvelopes.clear()
  vault.recoveryHashKeys.clear()
}
