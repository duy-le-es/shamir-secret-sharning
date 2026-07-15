// AES-GCM envelopes for User Recovery DEK — Password, Emergency Recovery, and
// temporary hash-key paths. Server stores ciphertext only; KEKs never leave the client.
import { hexPreview, sha256hex, toHex } from './crypto.service'
import { trace } from './trace'

export interface EnvelopeBlob {
  salt: string // hex — PBKDF2 salt (empty for raw-key emergency envelopes)
  iv: string // hex — AES-GCM IV
  ciphertext: string // hex
  version: number
}

const PBKDF2_ITERATIONS = 210_000

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

async function deriveAesKey(
  material: string,
  salt: Uint8Array,
  label: string,
  log = true,
): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(material),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  if (log) {
    trace('KEYGEN', `${label} derived (PBKDF2)`, [
      `iterations: ${PBKDF2_ITERATIONS}`,
      `salt SHA-256: ${await sha256hex(salt)}`,
      'AES-256-GCM key derived client-side only',
    ])
  }
  return key
}

export async function derivePasswordKek(password: string, salt: Uint8Array): Promise<CryptoKey> {
  return deriveAesKey(password, salt, 'Password KEK', false)
}

async function importRawAesKey(rawKey: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', rawKey.buffer as ArrayBuffer, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ])
}

async function wrapBytes(
  plaintext: Uint8Array,
  key: CryptoKey,
  traceTitle?: string,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      plaintext.buffer as ArrayBuffer,
    ),
  )
  if (traceTitle) {
    trace('WRAP', traceTitle, [
      `IV: ${toHex(iv)}`,
      `ciphertext preview: ${hexPreview(ciphertext)}`,
      'auth tag included in AES-GCM output',
    ])
  }
  return { iv, ciphertext }
}

async function unwrapBytes(
  iv: Uint8Array,
  ciphertext: Uint8Array,
  key: CryptoKey,
  traceTitle: string,
): Promise<Uint8Array> {
  const plain = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
      key,
      ciphertext.buffer as ArrayBuffer,
    ),
  )
  trace('ENVELOPE', traceTitle, [
    `IV: ${toHex(iv)}`,
    `recovered material SHA-256: ${await sha256hex(plain)}`,
    'AES-GCM auth tag verified',
  ])
  return plain
}

export async function wrapDekWithKek(
  dekHex: string,
  kek: CryptoKey,
  traceTitle?: string,
): Promise<{ iv: Uint8Array; ciphertext: Uint8Array }> {
  return wrapBytes(hexToBytes(dekHex), kek, traceTitle)
}

export async function unwrapDekWithKek(
  envelope: EnvelopeBlob,
  kek: CryptoKey,
  traceTitle: string,
): Promise<string> {
  const plain = await unwrapBytes(hexToBytes(envelope.iv), hexToBytes(envelope.ciphertext), kek, traceTitle)
  return toHex(plain)
}

/** Seal the restored Vault Key with the time-limited hash key for temporary server storage. */
export async function createTempHashKeyEnvelope(
  dekHex: string,
  hashKeyHex: string,
  userLabel: string,
): Promise<EnvelopeBlob> {
  const kek = await importRawAesKey(hexToBytes(hashKeyHex))
  const { iv, ciphertext } = await wrapDekWithKek(
    dekHex,
    kek,
    `Vault Key encrypted with temporary hash key — ${userLabel}`,
  )
  return { salt: '', iv: toHex(iv), ciphertext: toHex(ciphertext), version: 1 }
}

export async function createPasswordEnvelope(
  dekHex: string,
  password: string,
  _userLabel: string,
): Promise<EnvelopeBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const kek = await derivePasswordKek(password, salt)
  const { iv, ciphertext } = await wrapDekWithKek(dekHex, kek)
  return { salt: toHex(salt), iv: toHex(iv), ciphertext: toHex(ciphertext), version: 1 }
}

export async function createEmergencyRecoveryEnvelope(
  dekHex: string,
  emergencyRecoveryKey: Uint8Array,
  _userLabel: string,
): Promise<EnvelopeBlob> {
  const kek = await importRawAesKey(emergencyRecoveryKey)
  const { iv, ciphertext } = await wrapDekWithKek(dekHex, kek)
  return { salt: '', iv: toHex(iv), ciphertext: toHex(ciphertext), version: 1 }
}

/** Open the temporarily stored Vault Key using the hash key from the one-time email link. */
export async function unwrapTempHashKeyEnvelope(
  envelope: EnvelopeBlob,
  hashKeyHex: string,
  userLabel: string,
): Promise<string> {
  const kek = await importRawAesKey(hexToBytes(hashKeyHex))
  return unwrapDekWithKek(
    envelope,
    kek,
    `Temporary Vault Key storage opened with hash key — ${userLabel}`,
  )
}

export async function unwrapPasswordEnvelope(
  envelope: EnvelopeBlob,
  password: string,
  userLabel: string,
): Promise<string> {
  const kek = await derivePasswordKek(password, hexToBytes(envelope.salt))
  return unwrapDekWithKek(envelope, kek, `Password Envelope opened — ${userLabel}`)
}

export async function unwrapEmergencyRecoveryEnvelope(
  envelope: EnvelopeBlob,
  emergencyRecoveryKey: Uint8Array,
  userLabel: string,
): Promise<string> {
  const kek = await importRawAesKey(emergencyRecoveryKey)
  return unwrapDekWithKek(
    envelope,
    kek,
    `Vault Key envelope opened — ${userLabel}`,
  )
}
