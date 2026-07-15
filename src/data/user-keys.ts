export interface UserKeySeed {
  id: string
  name: string
  email: string
  /** User Identity Public Key (RSA-2048 PEM) */
  publicKey: string
  /** User Identity Private Key (RSA-2048 PEM) */
  privateKey: string
  /** Vault key — 256-bit random key (64-char hex) */
  vaultKey: string
  /** Demo password used to create the initial Password Envelope at bootstrap */
  demoPassword?: string
}

export interface UserKeysFile {
  algorithm: string
  modulusLength: number
  format: string
  generatedAt: string
  users: Record<string, UserKeySeed>
}
