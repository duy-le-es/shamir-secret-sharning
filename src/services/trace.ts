// Live technical trace of every real crypto operation the demo performs.
// This is the "proof console": it shows algorithm parameters, ciphertext
// previews and hash comparisons — but NEVER plaintext secrets, share values
// or private keys (only SHA-256 fingerprints of them).
import { create } from 'zustand'

export type TraceKind =
  | 'KEYGEN'
  | 'WRAP'
  | 'SHAMIR'
  | 'ENVELOPE'
  | 'VERIFY'
  | 'WIPE'
  | 'INFO'

export interface TraceEntry {
  id: number
  timestamp: string
  kind: TraceKind
  title: string
  lines: string[]
}

interface TraceState {
  entries: TraceEntry[]
  open: boolean
  setOpen: (open: boolean) => void
  clear: () => void
}

let seq = 0

export const useTraceStore = create<TraceState>((set) => ({
  entries: [],
  open: false,
  setOpen: (open) => set({ open }),
  clear: () => set({ entries: [] }),
}))

export function trace(kind: TraceKind, title: string, lines: string[] = []): void {
  const entry: TraceEntry = {
    id: ++seq,
    timestamp: new Date().toISOString(),
    kind,
    title,
    lines,
  }
  useTraceStore.setState((s) => ({ entries: [...s.entries, entry] }))
}

export function clearTrace(): void {
  useTraceStore.getState().clear()
}
