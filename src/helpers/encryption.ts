import { generate } from 'random-words'

/** Personal Recovery — 12 random words kept offline by the user. */
export function createBackupKey(): string {
  return (generate(12) as string[]).join(' ')
}
