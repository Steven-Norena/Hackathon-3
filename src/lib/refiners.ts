import type { Refiner } from './types'

// Versión más nueva vista por expediente: una versión vieja nunca pisa a una nueva.
const seen = new Map<number, number>()
export function isStale(id: number, version?: number): boolean {
  if (version === undefined) return false
  const cur = seen.get(id)
  return cur !== undefined && version < cur
}
export function noteVersion(id: number, version?: number) {
  if (version === undefined) return
  const cur = seen.get(id)
  if (cur === undefined || version > cur) seen.set(id, version)
}
export function mergeRefiner(prev: Refiner, patch: Partial<Refiner>): Refiner {
  if (isStale(prev.id, patch.version as number | undefined)) return prev
  noteVersion(prev.id, patch.version as number | undefined)
  return { ...prev, ...patch }
}
