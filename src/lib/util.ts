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

const WAIT_UNTIL_PREFIX = "@wait-until="
const WAIT_REASON_PREFIX = "@wait-reason="

export type WaitComment = {
  until: number
  reason?: string
}

export function parseWaitFromComment(comment?: string | null): WaitComment | null {
  if (!comment) return null
  let until: number | null = null
  let reason: string | undefined
  for (const line of comment.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed.startsWith(WAIT_UNTIL_PREFIX)) {
      const raw = trimmed.slice(WAIT_UNTIL_PREFIX.length).trim()
      const value = Number(raw)
      if (Number.isFinite(value)) {
        until = value
      }
      continue
    }
    if (trimmed.startsWith(WAIT_REASON_PREFIX)) {
      const raw = trimmed.slice(WAIT_REASON_PREFIX.length).trim()
      if (raw) reason = raw
    }
  }
  if (until === null) return null
  return { until, reason }
}

function isWaitLine(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith(WAIT_UNTIL_PREFIX) || trimmed.startsWith(WAIT_REASON_PREFIX)
}

export function upsertWaitInComment(comment: string | null, until: number, reason?: string): string {
  const lines = comment ? comment.split(/\r?\n/) : []
  const filtered = lines.filter((line) => !isWaitLine(line))
  const waitLines = [`${WAIT_UNTIL_PREFIX}${Math.trunc(until)}`]
  const reasonValue = reason?.trim()
  if (reasonValue) {
    waitLines.push(`${WAIT_REASON_PREFIX}${reasonValue}`)
  }
  return [...waitLines, ...filtered].join("\n").trimEnd()
}

export function removeWaitFromComment(comment?: string | null): string | null {
  if (!comment) return null
  const lines = comment.split(/\r?\n/).filter((line) => !isWaitLine(line))
  const cleaned = lines.join("\n").trimEnd()
  return cleaned.length ? cleaned : null
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
