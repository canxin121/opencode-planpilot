import fs from "fs"
import path from "path"
import { invalidInput } from "./errors"

export function ensureNonEmpty(label: string, value: string) {
  if (value.trim().length === 0) {
    throw invalidInput(`${label} cannot be empty`)
  }
}

export function formatDateTimeUTC(timestamp: number): string {
  const date = new Date(timestamp)
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(date.getUTCDate()).padStart(2, "0")
  const hh = String(date.getUTCHours()).padStart(2, "0")
  const min = String(date.getUTCMinutes()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

export function uniqueIds(ids: number[]): number[] {
  const seen = new Set<number>()
  const unique: number[] = []
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id)
      unique.push(id)
    }
  }
  return unique
}

export function joinIds(ids: number[]): string {
  return ids.map((id) => String(id)).join(", ")
}

export function normalizeCommentEntries(entries: Array<[number, string]>): Array<[number, string]> {
  const seen = new Map<number, number>()
  const ordered: Array<[number, string]> = []
  for (const [id, comment] of entries) {
    const idx = seen.get(id)
    if (idx !== undefined) {
      ordered[idx][1] = comment
    } else {
      seen.set(id, ordered.length)
      ordered.push([id, comment])
    }
  }
  return ordered
}

export function resolveMaybeRealpath(value: string): string {
  try {
    return fs.realpathSync.native(value)
  } catch {
    return value
  }
}

export function normalizePath(value: string): string {
  let resolved = resolveMaybeRealpath(value)
  resolved = path.resolve(resolved)
  if (process.platform === "win32") {
    resolved = resolved.toLowerCase()
  }
  return resolved.replace(/[\\/]+$/, "")
}

export function projectMatchesPath(project: string, current: string): boolean {
  const projectNorm = normalizePath(project)
  const currentNorm = normalizePath(current)
  if (projectNorm === currentNorm) return true
  if (currentNorm.startsWith(projectNorm + path.sep)) return true
  if (projectNorm.startsWith(currentNorm + path.sep)) return true
  return false
}
