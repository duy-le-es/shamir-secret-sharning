// Real Web Crypto operations. All key material is created client-side and
// held only in the in-memory vault (see recovery.service.ts). The app state
// (Zustand) only ever stores fingerprints and version labels — never keys.
import forge from 'node-forge'
import { trace } from './trace'

const RSA_OAEP_PARAMS: RsaHashedImportParams = {
  name: 'RSA-OAEP',
  hash: 'SHA-256',
}

function binaryStringToArrayBuffer(bin: string): ArrayBuffer {
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer as ArrayBuffer
}

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  return Array.from(view)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function hexPreview(buf: ArrayBuffer | Uint8Array, n = 12): string {
  const view = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  const head = toHex(view.slice(0, n))
  return `${head}… (${view.byteLength} bytes)`
}

export async function sha256hex(bytes: Uint8Array | ArrayBuffer): Promise<string> {
  const buf =
    bytes instanceof Uint8Array ? (bytes.slice().buffer as ArrayBuffer) : bytes
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return toHex(digest)
}

// `label` makes the operation show up in the Crypto Trace console.
export async function generateUserKeyPair(label?: string): Promise<CryptoKeyPair> {
  const pair = await crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['wrapKey', 'unwrapKey'],
  )
  if (label) {
    const spki = await crypto.subtle.exportKey('spki', pair.publicKey)
    trace('KEYGEN', `New user key created — ${label}`, [
      `RSA-2048 key pair generated on user device`,
      `public key SHA-256: ${await sha256hex(spki)}`,
      `private key retained on user device only`,
    ])
  }
  return pair
}

/** Import RSA-OAEP 2048 PEM keys (node-forge format) into Web Crypto. */
export async function importUserKeyPairFromPem(
  publicKeyPem: string,
  privateKeyPem: string,
  label?: string,
): Promise<CryptoKeyPair> {
  const { pki, asn1 } = forge
  const publicKey = pki.publicKeyFromPem(publicKeyPem)
  const privateKey = pki.privateKeyFromPem(privateKeyPem)
  const publicDer = binaryStringToArrayBuffer(
    asn1.toDer(pki.publicKeyToAsn1(publicKey)).getBytes(),
  )
  const privatePkcs8 = binaryStringToArrayBuffer(
    asn1.toDer(pki.wrapRsaPrivateKey(pki.privateKeyToAsn1(privateKey))).getBytes(),
  )
  const publicKeyCrypto = await crypto.subtle.importKey(
    'spki',
    publicDer,
    RSA_OAEP_PARAMS,
    true,
    ['wrapKey'],
  )
  const privateKeyCrypto = await crypto.subtle.importKey(
    'pkcs8',
    privatePkcs8,
    RSA_OAEP_PARAMS,
    true,
    ['unwrapKey'],
  )
  if (label) {
    const spki = await crypto.subtle.exportKey('spki', publicKeyCrypto)
    trace('KEYGEN', `User key loaded — ${label}`, [
      `RSA-2048 PEM key pair imported`,
      `public key SHA-256: ${await sha256hex(spki)}`,
      `private key retained on user device only`,
    ])
  }
  return { publicKey: publicKeyCrypto, privateKey: privateKeyCrypto }
}

export function randomSecret(bytes = 32): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(bytes))
}

/** 256-bit random key as a 64-character hex string (User Recovery DEK). */
export function createRandomKey(bits = 256): string {
  const byteLength = bits / 8
  const randomBytes = new Uint8Array(byteLength)
  crypto.getRandomValues(randomBytes)
  return Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export async function fingerprintPublicKey(key: CryptoKey): Promise<string> {
  const spki = await crypto.subtle.exportKey('spki', key)
  const digest = await crypto.subtle.digest('SHA-256', spki)
  return toHex(new Uint8Array(digest).slice(0, 6))
}

export async function fingerprintBytes(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes.slice().buffer as ArrayBuffer,
  )
  return toHex(new Uint8Array(digest).slice(0, 6))
}

export function wipe(bytes: Uint8Array | null | undefined): void {
  if (bytes) bytes.fill(0)
}
