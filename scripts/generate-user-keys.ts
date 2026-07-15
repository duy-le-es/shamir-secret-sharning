/**
 * One-off generator: RSA 2048-bit PEM key pairs for demo users.
 * Run: npx tsx scripts/generate-user-keys.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import forge from 'node-forge'
import { createRandomKey } from '../src/services/crypto.service'
import type { UserKeysFile } from '../src/data/user-keys'

const { pki } = forge

export const generateKeyPair = (): Promise<{ publicKey: string; privateKey: string }> =>
  new Promise((resolve) => {
    try {
      const keypair = pki.rsa.generateKeyPair(2048)
      const publicKeyPem = pki.publicKeyToPem(keypair.publicKey)
      const privateKeyPem = pki.privateKeyToPem(keypair.privateKey)
      resolve({ publicKey: publicKeyPem, privateKey: privateKeyPem })
    } catch (err) {
      throw err
    }
  })

const USERS = [
  { id: 'alice', name: 'Alice Nguyen', email: 'alice@acme.io' },
  { id: 'dave', name: 'Dave Tran', email: 'dave@acme.io' },
  { id: 'carol', name: 'Carol Le', email: 'carol@acme.io' },
  { id: 'bob', name: 'Bob Pham', email: 'bob@acme.io' },
  { id: 'emma', name: 'Emma Vo', email: 'emma@acme.io' },
  { id: 'demo', name: 'Demo User', email: 'demo@acme.io' },
] as const

async function main() {
  const root = dirname(fileURLToPath(import.meta.url))
  const outPath = join(root, '..', 'src', 'data', 'user-keys.json')

  const existing: UserKeysFile | null = existsSync(outPath)
    ? (JSON.parse(readFileSync(outPath, 'utf8')) as UserKeysFile)
    : null

  const users: UserKeysFile['users'] = {}

  for (const user of USERS) {
    const prior = existing?.users[user.id]
    const keys = prior?.publicKey && prior?.privateKey
      ? { publicKey: prior.publicKey, privateKey: prior.privateKey }
      : await generateKeyPair()
    const vaultKey = prior?.vaultKey ?? createRandomKey(256)
    users[user.id] = { ...user, ...keys, vaultKey }
    const dekAction = prior?.vaultKey ? 'kept' : 'generated'
    console.log(`${dekAction} recovery DEK for ${user.name} (${user.id})`)
  }

  const payload: UserKeysFile = {
    algorithm: 'RSA',
    modulusLength: 2048,
    format: 'PEM',
    generatedAt: new Date().toISOString(),
    users,
  }

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
  console.log(`\nWrote ${outPath}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
