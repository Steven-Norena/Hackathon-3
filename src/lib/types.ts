export interface Me {
  user?: { id: number; email: string; displayName: string }
  team: { code: string; name: string }
  role: { code: string; name: string }
  permissions: string[]
  clearance: { granted: boolean; grantedAt: string | null }
}
export interface Page<T> { items: T[]; page: number; pageSize: number; total: number; totalPages?: number }
export interface FileSummary {
  id: number; name: string; status: string; rows: number; cols: number
  tileSize?: number; progress?: Progress
}
export interface Progress { total?: number; refined?: number; percent?: number; bins?: Record<string, { total: number; refined: number }>; [k: string]: unknown }
export interface FileDetail extends FileSummary { tileSize: number; mistakes?: number }
export interface Rules {
  tremorThreshold: number; connectivity: 4 | 8; minGroupSize: number; maxGroupSize: number
  binning: { strategy: 'DIGIT_SUM_MOD' | 'MAX_DIGIT_MOD'; order: string[] }
}
export interface Tile {
  tileRow: number; tileCol: number; originRow: number; originCol: number
  rows: number; cols: number; values: string; tremor: string; bins: string; version: number
}
export interface Refiner {
  id: number; displayName?: string; name?: string; email?: string; title?: string; bio?: string
  departmentId?: number; department?: string; badgeMediaId?: number | null; badgeUrl?: string | null; version?: number
  [k: string]: unknown
}
export interface Department { id: number; name: string }
export interface Incident { id: number; title: string; description: string; photos?: { mediaId: number; url: string }[]; createdAt?: string }
