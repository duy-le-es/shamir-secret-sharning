// Thin wrapper over the audited `shamir-secret-sharing` package (GF(256)
// implementation, browser-native). We never hand-roll the math.
import { split as ssSplit, combine as ssCombine } from 'shamir-secret-sharing'
import { sha256hex } from './crypto.service'
import { trace } from './trace'

// The library requires threshold >= 2 and shares >= 2. For degenerate demo
// policies (1-of-1, 1-of-n) each "share" is simply a copy of the secret —
// which is exactly the weakness the UI warns about.
export async function splitSecret(
  secret: Uint8Array,
  totalShares: number,
  threshold: number,
  shareLabels?: string[],
): Promise<Uint8Array[]> {
  let shares: Uint8Array[]
  let degenerate = false
  if (threshold <= 1 || totalShares <= 1) {
    degenerate = true
    shares = Array.from({ length: Math.max(totalShares, 1) }, () => secret.slice())
  } else {
    shares = await ssSplit(secret, totalShares, threshold)
  }
  if (shareLabels) {
    const lines = [
      degenerate
        ? `WARNING: threshold ${threshold} — each share is a full copy of the secret (1-of-1 risk)`
        : `${threshold}-of-${totalShares} threshold: ${threshold} shares required to reconstruct`,
    ]
    for (let i = 0; i < shares.length; i++) {
      lines.push(
        `${shareLabels[i] ?? `share ${i + 1}`} — SHA-256: ${await sha256hex(shares[i])}`,
      )
    }
    trace('SHAMIR', `Recovery Secret split into ${shares.length} shares`, lines)
  }
  return shares
}

export async function combineShares(
  shares: Uint8Array[],
  threshold: number,
  _label?: string,
): Promise<Uint8Array> {
  if (shares.length === 0) throw new Error('No recovery shares provided')
  let secret: Uint8Array
  if (threshold <= 1) {
    secret = shares[0].slice()
  } else {
    if (shares.length < threshold) {
      throw new Error(
        `Quorum not met: ${shares.length} of ${threshold} required shares`,
      )
    }
    secret = await ssCombine(shares.slice(0, Math.max(threshold, 2)))
  }
  // Callers emit human-readable Shamir logs — avoid dumping raw share hashes here.
  return secret
}
