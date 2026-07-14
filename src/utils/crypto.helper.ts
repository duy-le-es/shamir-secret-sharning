import forge from 'node-forge'

/**
 * Mã hóa symmetric key (hex string) bằng RSA public key của người nhận.
 * @param keyToEncrypt - Key cần wrap (thường là project key dạng hex 64 ký tự)
 * @param publicKeyPem - Public key PEM của người nhận
 * @returns Ciphertext (base64 string) hoặc "" nếu lỗi
 */
export function encryptKeyWithPublicKey(keyToEncrypt: string, publicKeyPem: string): string {
  try {
    const publicKey = forge.pki.publicKeyFromPem(publicKeyPem)
    const encrypted = publicKey.encrypt(keyToEncrypt, 'RSA-OAEP')
    return forge.util.encode64(encrypted)
  } catch (error) {
    console.error('encryptKeyWithPublicKey failed:', error)
    return ''
  }
}

/**
 * Giải mã key đã wrap bằng RSA private key.
 * @param encryptedKey - Ciphertext base64 từ encryptKeyWithPublicKey
 * @param privateKeyPem - Private key PEM của người nhận
 * @returns Plaintext key hoặc "" nếu lỗi
 */
export function decryptKeyWithPrivateKey(encryptedKey: string, privateKeyPem: string): string {
  try {
    const privateKey = forge.pki.privateKeyFromPem(privateKeyPem)
    const decoded = forge.util.decode64(encryptedKey)
    return privateKey.decrypt(decoded, 'RSA-OAEP')
  } catch (error) {
    console.error('decryptKeyWithPrivateKey failed:', error)
    return ''
  }
}
