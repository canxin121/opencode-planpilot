import fs from "fs"
import path from "path"
import { resolvePlanpilotDir } from "./db"

export type KeywordRule = {
  any: string[]
  all: string[]
  none: string[]
  matchCase: boolean
}

export type EventRule = {
  enabled: boolean
  force: boolean
  keywords: KeywordRule
}

export type SessionErrorRule = EventRule & {
  errorNames: string[]
  statusCodes: number[]
  retryableOnly: boolean
}

export type SessionRetryRule = EventRule & {
  attemptAtLeast: number
}

export type SendRetryConfig = {
  enabled: boolean
  maxAttempts: number
  delaysMs: number[]
}

export type AutoContinueConfig = {
  sendRetry: SendRetryConfig
  onSessionError: SessionErrorRule
  onSessionRetry: SessionRetryRule
  onPermissionAsked: EventRule
  onPermissionRejected: EventRule
  onQuestionAsked: EventRule
  onQuestionRejected: EventRule
}

export type RuntimeConfig = {
  paused: boolean
}

export type PlanpilotConfig = {
  autoContinue: AutoContinueConfig
  runtime: RuntimeConfig
}

export type LoadedPlanpilotConfig = {
  path: string
  loadedFromFile: boolean
  config: PlanpilotConfig
  loadError?: string
}

const DEFAULT_KEYWORDS: KeywordRule = {
  any: [],
  all: [],
  none: [],
  matchCase: false,
}

const DEFAULT_EVENT_RULE: EventRule = {
  enabled: false,
  force: false,
  keywords: DEFAULT_KEYWORDS,
}

const DEFAULT_SESSION_ERROR_RULE: SessionErrorRule = {
  enabled: false,
  force: true,
  keywords: DEFAULT_KEYWORDS,
  errorNames: [],
  statusCodes: [],
  retryableOnly: false,
}

const DEFAULT_SESSION_RETRY_RULE: SessionRetryRule = {
  enabled: false,
  force: false,
  keywords: DEFAULT_KEYWORDS,
  attemptAtLeast: 1,
}

const DEFAULT_SEND_RETRY: SendRetryConfig = {
  enabled: true,
  maxAttempts: 3,
  delaysMs: [1500, 5000, 15000],
}

export const DEFAULT_PLANPILOT_CONFIG: PlanpilotConfig = {
  autoContinue: {
    sendRetry: DEFAULT_SEND_RETRY,
    onSessionError: DEFAULT_SESSION_ERROR_RULE,
    onSessionRetry: DEFAULT_SESSION_RETRY_RULE,
    onPermissionAsked: DEFAULT_EVENT_RULE,
    onPermissionRejected: {
      ...DEFAULT_EVENT_RULE,
      force: true,
    },
    onQuestionAsked: DEFAULT_EVENT_RULE,
    onQuestionRejected: {
      ...DEFAULT_EVENT_RULE,
      force: true,
    },
  },
  runtime: {
    paused: false,
  },
}

export function resolvePlanpilotConfigPath(): string {
  const override = process.env.OPENCODE_PLANPILOT_CONFIG
  if (override && override.trim()) {
    const value = override.trim()
    return path.isAbsolute(value) ? value : path.resolve(value)
  }
  return path.join(resolvePlanpilotDir(), "config.json")
}

type RawKeywordRule = {
  any?: unknown
  all?: unknown
  none?: unknown
  matchCase?: unknown
}

type RawEventRule = {
  enabled?: unknown
  force?: unknown
  keywords?: RawKeywordRule
}

type RawSessionErrorRule = RawEventRule & {
  errorNames?: unknown
  statusCodes?: unknown
  retryableOnly?: unknown
}

type RawSessionRetryRule = RawEventRule & {
  attemptAtLeast?: unknown
}

type RawSendRetryConfig = {
  enabled?: unknown
  maxAttempts?: unknown
  delaysMs?: unknown
}

type RawAutoContinueConfig = {
  sendRetry?: RawSendRetryConfig
  onSessionError?: RawSessionErrorRule
  onSessionRetry?: RawSessionRetryRule
  onPermissionAsked?: RawEventRule
  onPermissionRejected?: RawEventRule
  onQuestionAsked?: RawEventRule
  onQuestionRejected?: RawEventRule
}

type RawRuntimeConfig = {
  paused?: unknown
}

type RawPlanpilotConfig = {
  autoContinue?: RawAutoContinueConfig
  runtime?: RawRuntimeConfig
}

function cloneDefaultConfig(): PlanpilotConfig {
  return {
    autoContinue: {
      sendRetry: {
        enabled: DEFAULT_PLANPILOT_CONFIG.autoContinue.sendRetry.enabled,
        maxAttempts: DEFAULT_PLANPILOT_CONFIG.autoContinue.sendRetry.maxAttempts,
        delaysMs: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.sendRetry.delaysMs],
      },
      onSessionError: {
        enabled: DEFAULT_PLANPILOT_CONFIG.autoContinue.onSessionError.enabled,
        force: DEFAULT_PLANPILOT_CONFIG.autoContinue.onSessionError.force,
        keywords: {
          any: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.onSessionError.keywords.any],
          all: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.onSessionError.keywords.all],
          none: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.onSessionError.keywords.none],
          matchCase: DEFAULT_PLANPILOT_CONFIG.autoContinue.onSessionError.keywords.matchCase,
        },
        errorNames: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.onSessionError.errorNames],
        statusCodes: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.onSessionError.statusCodes],
        retryableOnly: DEFAULT_PLANPILOT_CONFIG.autoContinue.onSessionError.retryableOnly,
      },
      onSessionRetry: {
        enabled: DEFAULT_PLANPILOT_CONFIG.autoContinue.onSessionRetry.enabled,
        force: DEFAULT_PLANPILOT_CONFIG.autoContinue.onSessionRetry.force,
        keywords: {
          any: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.onSessionRetry.keywords.any],
          all: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.onSessionRetry.keywords.all],
          none: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.onSessionRetry.keywords.none],
          matchCase: DEFAULT_PLANPILOT_CONFIG.autoContinue.onSessionRetry.keywords.matchCase,
        },
        attemptAtLeast: DEFAULT_PLANPILOT_CONFIG.autoContinue.onSessionRetry.attemptAtLeast,
      },
      onPermissionAsked: {
        enabled: DEFAULT_PLANPILOT_CONFIG.autoContinue.onPermissionAsked.enabled,
        force: DEFAULT_PLANPILOT_CONFIG.autoContinue.onPermissionAsked.force,
        keywords: {
          any: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.onPermissionAsked.keywords.any],
          all: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.onPermissionAsked.keywords.all],
          none: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.onPermissionAsked.keywords.none],
          matchCase: DEFAULT_PLANPILOT_CONFIG.autoContinue.onPermissionAsked.keywords.matchCase,
        },
      },
      onPermissionRejected: {
        enabled: DEFAULT_PLANPILOT_CONFIG.autoContinue.onPermissionRejected.enabled,
        force: DEFAULT_PLANPILOT_CONFIG.autoContinue.onPermissionRejected.force,
        keywords: {
          any: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.onPermissionRejected.keywords.any],
          all: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.onPermissionRejected.keywords.all],
          none: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.onPermissionRejected.keywords.none],
          matchCase: DEFAULT_PLANPILOT_CONFIG.autoContinue.onPermissionRejected.keywords.matchCase,
        },
      },
      onQuestionAsked: {
        enabled: DEFAULT_PLANPILOT_CONFIG.autoContinue.onQuestionAsked.enabled,
        force: DEFAULT_PLANPILOT_CONFIG.autoContinue.onQuestionAsked.force,
        keywords: {
          any: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.onQuestionAsked.keywords.any],
          all: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.onQuestionAsked.keywords.all],
          none: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.onQuestionAsked.keywords.none],
          matchCase: DEFAULT_PLANPILOT_CONFIG.autoContinue.onQuestionAsked.keywords.matchCase,
        },
      },
      onQuestionRejected: {
        enabled: DEFAULT_PLANPILOT_CONFIG.autoContinue.onQuestionRejected.enabled,
        force: DEFAULT_PLANPILOT_CONFIG.autoContinue.onQuestionRejected.force,
        keywords: {
          any: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.onQuestionRejected.keywords.any],
          all: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.onQuestionRejected.keywords.all],
          none: [...DEFAULT_PLANPILOT_CONFIG.autoContinue.onQuestionRejected.keywords.none],
          matchCase: DEFAULT_PLANPILOT_CONFIG.autoContinue.onQuestionRejected.keywords.matchCase,
        },
      },
    },
    runtime: {
      paused: DEFAULT_PLANPILOT_CONFIG.runtime.paused,
    },
  }
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value
  return fallback
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const parsed = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  return Array.from(new Set(parsed))
}

function parseNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const parsed = value
    .map((item) => (typeof item === "number" ? item : Number.NaN))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.trunc(item))
  return Array.from(new Set(parsed))
}

function parsePositiveInt(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  const parsed = Math.trunc(value)
  return parsed > 0 ? parsed : fallback
}

function parsePositiveNumberArray(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return fallback
  const parsed = value
    .map((item) => (typeof item === "number" ? item : Number.NaN))
    .filter((item) => Number.isFinite(item))
    .map((item) => Math.trunc(item))
    .filter((item) => item > 0)
  if (!parsed.length) return fallback
  return Array.from(new Set(parsed))
}

function parseKeywordRule(value: RawKeywordRule | undefined, fallback: KeywordRule): KeywordRule {
  return {
    any: parseStringArray(value?.any),
    all: parseStringArray(value?.all),
    none: parseStringArray(value?.none),
    matchCase: parseBoolean(value?.matchCase, fallback.matchCase),
  }
}

function parseEventRule(value: RawEventRule | undefined, fallback: EventRule): EventRule {
  return {
    enabled: parseBoolean(value?.enabled, fallback.enabled),
    force: parseBoolean(value?.force, fallback.force),
    keywords: parseKeywordRule(value?.keywords, fallback.keywords),
  }
}

function parseSessionErrorRule(value: RawSessionErrorRule | undefined, fallback: SessionErrorRule): SessionErrorRule {
  const base = parseEventRule(value, fallback)
  return {
    ...base,
    errorNames: parseStringArray(value?.errorNames),
    statusCodes: parseNumberArray(value?.statusCodes),
    retryableOnly: parseBoolean(value?.retryableOnly, fallback.retryableOnly),
  }
}

function parseSessionRetryRule(value: RawSessionRetryRule | undefined, fallback: SessionRetryRule): SessionRetryRule {
  const base = parseEventRule(value, fallback)
  const rawAttempt = typeof value?.attemptAtLeast === "number" ? Math.trunc(value.attemptAtLeast) : fallback.attemptAtLeast
  return {
    ...base,
    attemptAtLeast: rawAttempt > 0 ? rawAttempt : fallback.attemptAtLeast,
  }
}

function parseSendRetryConfig(value: RawSendRetryConfig | undefined, fallback: SendRetryConfig): SendRetryConfig {
  return {
    enabled: parseBoolean(value?.enabled, fallback.enabled),
    maxAttempts: parsePositiveInt(value?.maxAttempts, fallback.maxAttempts),
    delaysMs: parsePositiveNumberArray(value?.delaysMs, fallback.delaysMs),
  }
}

function parseConfig(raw: RawPlanpilotConfig): PlanpilotConfig {
  return {
    autoContinue: {
      sendRetry: parseSendRetryConfig(raw.autoContinue?.sendRetry, DEFAULT_PLANPILOT_CONFIG.autoContinue.sendRetry),
      onSessionError: parseSessionErrorRule(
        raw.autoContinue?.onSessionError,
        DEFAULT_PLANPILOT_CONFIG.autoContinue.onSessionError,
      ),
      onSessionRetry: parseSessionRetryRule(
        raw.autoContinue?.onSessionRetry,
        DEFAULT_PLANPILOT_CONFIG.autoContinue.onSessionRetry,
      ),
      onPermissionAsked: parseEventRule(
        raw.autoContinue?.onPermissionAsked,
        DEFAULT_PLANPILOT_CONFIG.autoContinue.onPermissionAsked,
      ),
      onPermissionRejected: parseEventRule(
        raw.autoContinue?.onPermissionRejected,
        DEFAULT_PLANPILOT_CONFIG.autoContinue.onPermissionRejected,
      ),
      onQuestionAsked: parseEventRule(
        raw.autoContinue?.onQuestionAsked,
        DEFAULT_PLANPILOT_CONFIG.autoContinue.onQuestionAsked,
      ),
      onQuestionRejected: parseEventRule(
        raw.autoContinue?.onQuestionRejected,
        DEFAULT_PLANPILOT_CONFIG.autoContinue.onQuestionRejected,
      ),
    },
    runtime: {
      paused: parseBoolean(raw.runtime?.paused, DEFAULT_PLANPILOT_CONFIG.runtime.paused),
    },
  }
}

export function normalizePlanpilotConfig(raw: unknown): PlanpilotConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return cloneDefaultConfig()
  }
  return parseConfig(raw as RawPlanpilotConfig)
}

export function savePlanpilotConfig(config: PlanpilotConfig): LoadedPlanpilotConfig {
  const filePath = resolvePlanpilotConfigPath()
  const normalized = normalizePlanpilotConfig(config)
  const parentDir = path.dirname(filePath)
  fs.mkdirSync(parentDir, { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8")
  return {
    path: filePath,
    loadedFromFile: true,
    config: normalized,
  }
}

export function loadPlanpilotConfig(): LoadedPlanpilotConfig {
  const filePath = resolvePlanpilotConfigPath()
  try {
    if (!fs.existsSync(filePath)) {
      return {
        path: filePath,
        loadedFromFile: false,
        config: cloneDefaultConfig(),
      }
    }
    const text = fs.readFileSync(filePath, "utf8")
    const parsed = JSON.parse(text) as unknown
    return {
      path: filePath,
      loadedFromFile: true,
      config: normalizePlanpilotConfig(parsed),
    }
  } catch (error) {
    const loadError = error instanceof Error ? error.message : String(error)
    return {
      path: filePath,
      loadedFromFile: false,
      config: cloneDefaultConfig(),
      loadError,
    }
  }
}

export function matchesKeywords(text: string, rule: KeywordRule): boolean {
  const source = rule.matchCase ? text : text.toLowerCase()
  const normalize = (value: string) => (rule.matchCase ? value : value.toLowerCase())
  const any = rule.any.map(normalize)
  const all = rule.all.map(normalize)
  const none = rule.none.map(normalize)

  if (any.length > 0 && !any.some((term) => source.includes(term))) {
    return false
  }
  if (!all.every((term) => source.includes(term))) {
    return false
  }
  if (none.some((term) => source.includes(term))) {
    return false
  }
  return true
}
