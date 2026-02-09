import { tool, type Plugin } from "@opencode-ai/plugin"
import { runCommand, formatCommandError } from "./command"
import { PlanpilotApp } from "./lib/app"
import {
  loadPlanpilotConfig,
  matchesKeywords,
  type EventRule,
  type SendRetryConfig,
  type SessionErrorRule,
  type SessionRetryRule,
} from "./lib/config"
import { openDatabase } from "./lib/db"
import { invalidInput } from "./lib/errors"
import { formatStepDetail } from "./lib/format"
import { parseWaitFromComment } from "./lib/util"
import { PLANPILOT_SYSTEM_INJECTION, PLANPILOT_TOOL_DESCRIPTION, formatPlanpilotAutoContinueMessage } from "./prompt"

export const PlanpilotPlugin: Plugin = async (ctx) => {
  const IDLE_DEBOUNCE_MS = 1000
  const RECENT_SEND_DEDUPE_MS = 1500
  const TRIGGER_TTL_MS = 10 * 60 * 1000

  const inFlight = new Set<string>()
  const skipNextAuto = new Set<string>()
  const lastIdleAt = new Map<string, number>()
  const pendingTrigger = new Map<string, AutoTrigger>()
  const recentSends = new Map<string, { signature: string; at: number }>()
  const sendRetryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const sendRetryState = new Map<string, { signature: string; attempt: number }>()
  const manualStop = new Map<string, { at: number; reason: string }>()
  const waitTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const permissionAsked = new Map<string, { sessionID: string; summary: string }>()
  const questionAsked = new Map<string, { sessionID: string; summary: string }>()
  const runSeq = new Map<string, number>()

  const loadedConfig = loadPlanpilotConfig()
  const autoConfig = loadedConfig.config.autoContinue

  type AutoTrigger = {
    source: string
    force: boolean
    detail?: string
    at: number
  }

  type RetryInput = {
    sessionID: string
    signature: string
    source: string
    force: boolean
    detail?: string
    error: unknown
  }

  const clearWaitTimer = (sessionID: string) => {
    const existing = waitTimers.get(sessionID)
    if (existing) {
      clearTimeout(existing)
      waitTimers.delete(sessionID)
    }
  }

  const log = async (level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, any>) => {
    try {
      await ctx.client.app.log({
        body: {
          service: "opencode-planpilot",
          level,
          message,
          extra,
        },
      })
    } catch {
      // ignore logging failures
    }
  }

  const logDebug = async (message: string, extra?: Record<string, any>) => {
    await log("debug", message, extra)
  }

  const clearSendRetryTimer = (sessionID: string) => {
    const timer = sendRetryTimers.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      sendRetryTimers.delete(sessionID)
    }
  }

  const clearSendRetry = (sessionID: string) => {
    clearSendRetryTimer(sessionID)
    sendRetryState.delete(sessionID)
  }

  const clearManualStop = async (sessionID: string, source: string) => {
    if (!manualStop.has(sessionID)) return
    manualStop.delete(sessionID)
    await logDebug("manual-stop guard cleared", { sessionID, source })
  }

  const setManualStop = async (sessionID: string, reason: string, source: string) => {
    manualStop.set(sessionID, {
      at: Date.now(),
      reason,
    })
    pendingTrigger.delete(sessionID)
    clearSendRetry(sessionID)
    await log("info", "manual-stop guard armed", {
      sessionID,
      source,
      reason,
    })
  }

  const stringifyError = (error: unknown): string => {
    if (error instanceof Error) return error.message
    if (typeof error === "string") return error
    return String(error)
  }

  const isManualStopError = (error: unknown): boolean => {
    const text = stringifyError(error).toLowerCase()
    return text.includes("aborted") || text.includes("cancel") || text.includes("canceled")
  }

  const buildRetryDetail = (baseDetail: string | undefined, attempt: number, max: number, message: string) =>
    toSummary([
      baseDetail,
      `send-retry=${attempt}/${max}`,
      message ? `error=${message}` : undefined,
    ])

  const scheduleSendRetry = async (input: RetryInput) => {
    const cfg: SendRetryConfig = autoConfig.sendRetry
    if (!cfg.enabled) return

    const blocked = manualStop.get(input.sessionID)
    if (blocked) {
      await logDebug("send retry skipped: manual-stop guard active", {
        sessionID: input.sessionID,
        source: input.source,
        reason: blocked.reason,
      })
      return
    }

    const text = stringifyError(input.error)
    if (isManualStopError(input.error)) {
      await logDebug("send retry skipped: manual-stop style error", {
        sessionID: input.sessionID,
        source: input.source,
        error: text,
      })
      return
    }

    const previous = sendRetryState.get(input.sessionID)
    const attempt =
      previous && previous.signature === input.signature
        ? previous.attempt + 1
        : 1
    if (attempt > cfg.maxAttempts) {
      clearSendRetry(input.sessionID)
      await log("warn", "send retry exhausted", {
        sessionID: input.sessionID,
        source: input.source,
        signature: input.signature,
        maxAttempts: cfg.maxAttempts,
        error: text,
      })
      return
    }

    sendRetryState.set(input.sessionID, {
      signature: input.signature,
      attempt,
    })
    clearSendRetryTimer(input.sessionID)

    const index = Math.min(Math.max(attempt - 1, 0), cfg.delaysMs.length - 1)
    const delayMs = cfg.delaysMs[index]
    const retryDetail = buildRetryDetail(input.detail, attempt, cfg.maxAttempts, text)

    const timer = setTimeout(() => {
      sendRetryTimers.delete(input.sessionID)
      queueTrigger(input.sessionID, {
        source: `${input.source}.send_retry`,
        force: input.force,
        detail: retryDetail,
      }).catch((err) => {
        void log("warn", "send retry trigger failed", {
          sessionID: input.sessionID,
          source: input.source,
          error: stringifyError(err),
        })
      })
    }, delayMs)
    sendRetryTimers.set(input.sessionID, timer)

    await log("info", "send retry scheduled", {
      sessionID: input.sessionID,
      source: input.source,
      signature: input.signature,
      attempt,
      maxAttempts: cfg.maxAttempts,
      delayMs,
      error: text,
    })
  }

  const nextRun = (sessionID: string) => {
    const next = (runSeq.get(sessionID) ?? 0) + 1
    runSeq.set(sessionID, next)
    return next
  }

  type SessionMessage = {
    info?: {
      role?: string
      agent?: string
      model?: {
        providerID: string
        modelID: string
      }
      modelID?: string
      providerID?: string
      variant?: string
      time?: {
        created?: number
      }
      error?: {
        name?: string
        data?: {
          message?: string
          statusCode?: number
          isRetryable?: boolean
        }
      }
      finish?: string
    }
  }

  const loadRecentMessages = async (sessionID: string, limit = 200): Promise<SessionMessage[]> => {
    const response = await ctx.client.session.messages({
      path: { id: sessionID },
      query: { limit },
    })
    const data = (response as { data?: unknown }).data ?? response
    if (!Array.isArray(data)) return []
    return data as SessionMessage[]
  }

  const findLastMessage = (messages: SessionMessage[], predicate: (message: SessionMessage) => boolean) => {
    for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
      const message = messages[idx]
      if (predicate(message)) return message
    }
    return undefined
  }

  const findLastMessageByRole = (messages: SessionMessage[], role: "user" | "assistant") =>
    findLastMessage(messages, (message) => message?.info?.role === role)

  const resolveAutoContext = async (sessionID: string) => {
    const messages = await loadRecentMessages(sessionID)
    if (!messages.length) return null

    const sortedMessages = [...messages].sort((left, right) => {
      const leftTime = left?.info?.time?.created ?? 0
      const rightTime = right?.info?.time?.created ?? 0
      return leftTime - rightTime
    })

    const lastUser = findLastMessage(sortedMessages, (message) => message?.info?.role === "user")
    if (!lastUser) return { missingUser: true }

    const lastAssistant = findLastMessageByRole(sortedMessages, "assistant")
    const error = lastAssistant?.info?.error
    const aborted = typeof error === "object" && error?.name === "MessageAbortedError"
    const finish = lastAssistant?.info?.finish
    const ready =
      !lastAssistant || (typeof finish === "string" && finish !== "tool-calls" && finish !== "unknown")

    const model =
      lastUser?.info?.model ??
      (lastUser?.info?.providerID && lastUser?.info?.modelID
        ? { providerID: lastUser.info.providerID, modelID: lastUser.info.modelID }
        : lastAssistant?.info?.providerID && lastAssistant?.info?.modelID
          ? { providerID: lastAssistant.info.providerID, modelID: lastAssistant.info.modelID }
          : undefined)

    return {
      agent: lastUser?.info?.agent ?? lastAssistant?.info?.agent,
      model,
      variant: lastUser?.info?.variant,
      aborted,
      ready,
      missingUser: false,
      assistantFinish: finish,
      assistantErrorName: typeof error === "object" && error ? (error as any).name : undefined,
      assistantErrorMessage:
        typeof error === "object" && error && typeof (error as any).data?.message === "string"
          ? ((error as any).data.message as string)
          : undefined,
      assistantErrorStatusCode:
        typeof error === "object" &&
        error &&
        typeof (error as any).data?.statusCode === "number" &&
        Number.isFinite((error as any).data.statusCode)
          ? Math.trunc((error as any).data.statusCode as number)
          : undefined,
      assistantErrorRetryable:
        typeof error === "object" && error && typeof (error as any).data?.isRetryable === "boolean"
          ? ((error as any).data.isRetryable as boolean)
          : undefined,
    }
  }

  const toSummary = (parts: Array<string | undefined>) =>
    parts
      .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
      .join(" ")
      .trim()

  const toStringArray = (value: unknown) =>
    Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
      : []

  const summarizePermissionEvent = (properties: any): string => {
    const permission = typeof properties?.permission === "string" ? properties.permission.trim() : ""
    const patterns = toStringArray(properties?.patterns)
    return toSummary([permission, patterns.length ? `patterns=${patterns.join(",")}` : undefined])
  }

  const summarizeQuestionEvent = (properties: any): string => {
    const questions = Array.isArray(properties?.questions) ? properties.questions : []
    const pieces = questions
      .map((item: any) =>
        toSummary([
          typeof item?.header === "string" ? item.header.trim() : undefined,
          typeof item?.question === "string" ? item.question.trim() : undefined,
        ]),
      )
      .filter(Boolean)
    return pieces.join(" | ")
  }

  const shouldTriggerEventRule = (rule: EventRule, text: string): boolean => {
    if (!rule.enabled) return false
    return matchesKeywords(text, rule.keywords)
  }

  const shouldTriggerSessionError = (rule: SessionErrorRule, error: any): { matched: boolean; detail: string } => {
    if (!rule.enabled) return { matched: false, detail: "" }
    if (!error || typeof error !== "object") return { matched: false, detail: "" }

    const name = typeof error.name === "string" ? error.name : ""
    const message = typeof error.data?.message === "string" ? error.data.message : ""
    const statusCode =
      typeof error.data?.statusCode === "number" && Number.isFinite(error.data.statusCode)
        ? Math.trunc(error.data.statusCode)
        : undefined
    const retryable = typeof error.data?.isRetryable === "boolean" ? error.data.isRetryable : undefined

    if (rule.errorNames.length > 0 && !rule.errorNames.includes(name)) {
      return { matched: false, detail: "" }
    }
    if (rule.statusCodes.length > 0) {
      if (statusCode === undefined || !rule.statusCodes.includes(statusCode)) {
        return { matched: false, detail: "" }
      }
    }
    if (rule.retryableOnly && retryable !== true) {
      return { matched: false, detail: "" }
    }

    const detail = toSummary([
      name ? `error=${name}` : undefined,
      statusCode !== undefined ? `status=${statusCode}` : undefined,
      retryable !== undefined ? `retryable=${retryable}` : undefined,
      message,
    ])
    if (!matchesKeywords(detail, rule.keywords)) {
      return { matched: false, detail }
    }
    return { matched: true, detail }
  }

  const shouldTriggerSessionRetry = (rule: SessionRetryRule, status: any): { matched: boolean; detail: string } => {
    if (!rule.enabled) return { matched: false, detail: "" }
    if (!status || typeof status !== "object") return { matched: false, detail: "" }
    if (status.type !== "retry") return { matched: false, detail: "" }

    const attempt = typeof status.attempt === "number" && Number.isFinite(status.attempt) ? Math.trunc(status.attempt) : 0
    const message = typeof status.message === "string" ? status.message : ""
    const next = typeof status.next === "number" && Number.isFinite(status.next) ? Math.trunc(status.next) : undefined
    if (attempt < rule.attemptAtLeast) {
      return { matched: false, detail: "" }
    }
    const detail = toSummary([
      `attempt=${attempt}`,
      next !== undefined ? `next=${next}` : undefined,
      message,
    ])
    if (!matchesKeywords(detail, rule.keywords)) {
      return { matched: false, detail }
    }
    return { matched: true, detail }
  }

  const readTrigger = (sessionID: string): AutoTrigger | undefined => {
    const current = pendingTrigger.get(sessionID)
    if (!current) return undefined
    if (Date.now() - current.at > TRIGGER_TTL_MS) {
      pendingTrigger.delete(sessionID)
      return undefined
    }
    return current
  }

  const queueTrigger = async (sessionID: string, trigger: Omit<AutoTrigger, "at">) => {
    if (manualStop.has(sessionID)) {
      await logDebug("auto-continue trigger skipped: manual-stop guard active", {
        sessionID,
        source: trigger.source,
      })
      return
    }
    pendingTrigger.set(sessionID, {
      ...trigger,
      at: Date.now(),
    })
    await logDebug("auto-continue trigger queued", {
      sessionID,
      source: trigger.source,
      force: trigger.force,
      detail: trigger.detail,
    })
    await handleSessionIdle(sessionID, trigger.source)
  }

  const handleSessionIdle = async (sessionID: string, source: string) => {
    const now = Date.now()
    const run = nextRun(sessionID)
    const trigger = readTrigger(sessionID)
    const force = trigger?.force === true
    const idleSource = source === "session.idle" || source === "session.status"

    if (inFlight.has(sessionID)) {
      await logDebug("auto-continue skipped: already in-flight", { sessionID, source, run, trigger: trigger?.source })
      return
    }

    const stopped = manualStop.get(sessionID)
    if (stopped) {
      pendingTrigger.delete(sessionID)
      await logDebug("auto-continue skipped: manual-stop guard active", {
        sessionID,
        source,
        run,
        stopAt: stopped.at,
        stopReason: stopped.reason,
      })
      return
    }

    inFlight.add(sessionID)
    try {
      if (skipNextAuto.has(sessionID)) {
        skipNextAuto.delete(sessionID)
        pendingTrigger.delete(sessionID)
        await logDebug("auto-continue skipped: skipNextAuto", { sessionID, source, run, trigger: trigger?.source })
        return
      }

      if (idleSource && !trigger) {
        const lastIdle = lastIdleAt.get(sessionID)
        if (lastIdle && now - lastIdle < IDLE_DEBOUNCE_MS) {
          await logDebug("auto-continue skipped: idle debounce", {
            sessionID,
            source,
            run,
            lastIdle,
            now,
            deltaMs: now - lastIdle,
          })
          return
        }
      }

      if (idleSource) {
        lastIdleAt.set(sessionID, now)
      }

      const app = new PlanpilotApp(openDatabase(), sessionID)
      const active = app.getActivePlan()
      if (!active) {
        clearWaitTimer(sessionID)
        pendingTrigger.delete(sessionID)
        await logDebug("auto-continue skipped: no active plan", { sessionID, source, run, trigger: trigger?.source })
        return
      }
      const next = app.nextStep(active.plan_id)
      if (!next) {
        clearWaitTimer(sessionID)
        pendingTrigger.delete(sessionID)
        await logDebug("auto-continue skipped: no pending step", {
          sessionID,
          source,
          run,
          planId: active.plan_id,
          trigger: trigger?.source,
        })
        return
      }
      if (next.executor !== "ai") {
        clearWaitTimer(sessionID)
        pendingTrigger.delete(sessionID)
        await logDebug("auto-continue skipped: next executor is not ai", {
          sessionID,
          source,
          run,
          planId: active.plan_id,
          stepId: next.id,
          executor: next.executor,
          trigger: trigger?.source,
        })
        return
      }

      const wait = parseWaitFromComment(next.comment)
      if (wait && wait.until > now) {
        clearWaitTimer(sessionID)
        await log("info", "auto-continue delayed by step wait", {
          sessionID,
          source,
          run,
          planId: active.plan_id,
          stepId: next.id,
          until: wait.until,
          reason: wait.reason,
          trigger: trigger?.source,
        })
        const msUntil = Math.max(0, wait.until - now)
        const timer = setTimeout(() => {
          waitTimers.delete(sessionID)
          handleSessionIdle(sessionID, "wait_timer").catch((err) => {
            void log("warn", "auto-continue retry failed", {
              sessionID,
              error: err instanceof Error ? err.message : String(err),
            })
          })
        }, msUntil)
        waitTimers.set(sessionID, timer)
        return
      }
      if (!wait) {
        clearWaitTimer(sessionID)
      }

      const goals = app.goalsForStep(next.id)
      const detail = formatStepDetail(next, goals)
      if (!detail.trim()) {
        pendingTrigger.delete(sessionID)
        await log("warn", "auto-continue stopped: empty step detail", {
          sessionID,
          source,
          run,
          planId: active.plan_id,
          stepId: next.id,
          trigger: trigger?.source,
        })
        return
      }

      const signature = `${active.plan_id}:${next.id}`
      const retryState = sendRetryState.get(sessionID)
      if (retryState && retryState.signature !== signature) {
        clearSendRetry(sessionID)
      }
      const recent = recentSends.get(sessionID)
      if (recent && recent.signature === signature && now - recent.at < RECENT_SEND_DEDUPE_MS) {
        pendingTrigger.delete(sessionID)
        await logDebug("auto-continue skipped: duplicate send window", {
          sessionID,
          source,
          run,
          planId: active.plan_id,
          stepId: next.id,
          trigger: trigger?.source,
          deltaMs: now - recent.at,
        })
        return
      }

      const autoContext = await resolveAutoContext(sessionID)
      if (autoContext?.missingUser) {
        pendingTrigger.delete(sessionID)
        await log("warn", "auto-continue stopped: missing user context", { sessionID, source, run, trigger: trigger?.source })
        return
      }
      if (!autoContext) {
        pendingTrigger.delete(sessionID)
        await logDebug("auto-continue stopped: missing autoContext (no recent messages?)", {
          sessionID,
          source,
          run,
          planId: active.plan_id,
          stepId: next.id,
          trigger: trigger?.source,
        })
        return
      }
      if (autoContext.aborted && !force) {
        pendingTrigger.delete(sessionID)
        await logDebug("auto-continue skipped: last assistant aborted", {
          sessionID,
          source,
          run,
          planId: active.plan_id,
          stepId: next.id,
          assistantErrorName: autoContext.assistantErrorName,
          assistantErrorMessage: autoContext.assistantErrorMessage,
          assistantFinish: autoContext.assistantFinish,
          trigger: trigger?.source,
        })
        return
      }
      if (autoContext.ready === false && !force) {
        pendingTrigger.delete(sessionID)
        await logDebug("auto-continue skipped: last assistant not ready", {
          sessionID,
          source,
          run,
          planId: active.plan_id,
          stepId: next.id,
          assistantFinish: autoContext.assistantFinish,
          assistantErrorName: autoContext.assistantErrorName,
          assistantErrorMessage: autoContext.assistantErrorMessage,
          trigger: trigger?.source,
        })
        return
      }

      const timestamp = new Date().toISOString()
      const message = formatPlanpilotAutoContinueMessage({
        timestamp,
        stepDetail: detail,
        triggerDetail: trigger?.detail,
      })

      const promptBody: any = {
        agent: autoContext.agent ?? undefined,
        model: autoContext.model ?? undefined,
        parts: [{ type: "text" as const, text: message }],
      }
      if (autoContext.variant) {
        promptBody.variant = autoContext.variant
      }

      await logDebug("auto-continue sending prompt_async", {
        sessionID,
        source,
        run,
        planId: active.plan_id,
        stepId: next.id,
        trigger: trigger?.source,
        force,
        agent: promptBody.agent,
        model: promptBody.model,
        variant: promptBody.variant,
        messageChars: message.length,
      })

      await ctx.client.session.promptAsync({
        path: { id: sessionID },
        body: promptBody,
        // OpenCode server routes requests to the correct instance (project) using this header.
        // Without it, the server falls back to process.cwd(), which breaks when OpenCode is
        // managed by opencode-studio (cwd != active project directory).
        headers: ctx.directory ? { "x-opencode-directory": ctx.directory } : undefined,
      }).catch(async (err) => {
        await scheduleSendRetry({
          sessionID,
          signature,
          source,
          force,
          detail: trigger?.detail,
          error: err,
        })
        throw err
      })

      recentSends.set(sessionID, {
        signature,
        at: Date.now(),
      })
      clearSendRetry(sessionID)
      pendingTrigger.delete(sessionID)

      await log("info", "auto-continue prompt_async accepted", {
        sessionID,
        source,
        run,
        planId: active.plan_id,
        stepId: next.id,
        trigger: trigger?.source,
        force,
      })
    } catch (err) {
      await log("warn", "failed to auto-continue plan", {
        sessionID,
        source,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      })
    } finally {
      inFlight.delete(sessionID)
    }
  }

  if (loadedConfig.loadError) {
    await log("warn", "failed to load planpilot config, falling back to defaults", {
      path: loadedConfig.path,
      error: loadedConfig.loadError,
    })
  }

  await log("info", "planpilot plugin initialized", {
    directory: ctx.directory,
    worktree: ctx.worktree,
    configPath: loadedConfig.path,
    configLoadedFromFile: loadedConfig.loadedFromFile,
  })

  return {
    "experimental.chat.system.transform": async (_input, output) => {
      output.system.push(PLANPILOT_SYSTEM_INJECTION)
    },
    tool: {
      planpilot: tool({
        description: PLANPILOT_TOOL_DESCRIPTION,
        args: {
          argv: tool.schema.array(tool.schema.string()).min(1),
        },
        async execute(args, toolCtx) {
          const argv = Array.isArray(args.argv) ? args.argv : []
          if (!argv.length) {
            return formatCommandError(invalidInput("missing argv"))
          }

          if (containsForbiddenFlags(argv)) {
            return formatCommandError(invalidInput("argv cannot include --cwd or --session-id"))
          }

          const cwd = (ctx.directory ?? "").trim()
          if (!cwd) {
            return formatCommandError(invalidInput("cwd is required"))
          }

          const output: string[] = []
          const io = {
            log: (...parts: any[]) => output.push(parts.map(String).join(" ")),
          }

          try {
            await runCommand(argv, { sessionId: toolCtx.sessionID, cwd }, io)
          } catch (err) {
            return formatCommandError(err)
          }

          return output.join("\n").trimEnd()
        },
      }),
    },
    "experimental.session.compacting": async ({ sessionID }, output) => {
      skipNextAuto.add(sessionID)
      lastIdleAt.set(sessionID, Date.now())

      await logDebug("compaction hook: skip next auto-continue", { sessionID })

      // Compaction runs with tools disabled; inject Planpilot guidance into the continuation summary.
      output.context.push(PLANPILOT_TOOL_DESCRIPTION)
    },
    event: async ({ event }) => {
      const evt = event as any

      if (evt.type === "message.updated") {
        const info = evt.properties?.info
        const sessionID = typeof info?.sessionID === "string" ? info.sessionID : ""
        if (!sessionID) return

        if (info.role === "user") {
          pendingTrigger.delete(sessionID)
          clearSendRetry(sessionID)
          await clearManualStop(sessionID, "message.updated.user")
          return
        }

        if (info.role === "assistant" && info.error?.name === "MessageAbortedError") {
          await setManualStop(sessionID, "assistant message aborted", "message.updated.assistant")
        }
        return
      }

      if (evt.type === "session.idle") {
        await handleSessionIdle(evt.properties.sessionID, "session.idle")
        return
      }
      if (evt.type === "session.status") {
        if (evt.properties.status.type === "idle") {
          await handleSessionIdle(evt.properties.sessionID, "session.status")
          return
        }
        const retryResult = shouldTriggerSessionRetry(autoConfig.onSessionRetry, evt.properties.status)
        if (!retryResult.matched) return
        await queueTrigger(evt.properties.sessionID, {
          source: "session.status.retry",
          force: autoConfig.onSessionRetry.force,
          detail: retryResult.detail || "session status retry",
        })
        return
      }

      if (evt.type === "session.error") {
        const sessionID = typeof evt.properties?.sessionID === "string" ? evt.properties.sessionID : ""
        if (!sessionID) return
        if (evt.properties?.error?.name === "MessageAbortedError") {
          await setManualStop(sessionID, "session aborted", "session.error")
          return
        }
        const errorResult = shouldTriggerSessionError(autoConfig.onSessionError, evt.properties?.error)
        if (!errorResult.matched) return
        await queueTrigger(sessionID, {
          source: "session.error",
          force: autoConfig.onSessionError.force,
          detail: errorResult.detail || "session error",
        })
        return
      }

      if (evt.type === "permission.asked") {
        const sessionID = typeof evt.properties?.sessionID === "string" ? evt.properties.sessionID : ""
        if (!sessionID) return
        const requestID = typeof evt.properties?.id === "string" ? evt.properties.id : ""
        const summary = summarizePermissionEvent(evt.properties)
        if (requestID) {
          permissionAsked.set(requestID, {
            sessionID,
            summary,
          })
        }
        if (!shouldTriggerEventRule(autoConfig.onPermissionAsked, summary || "permission asked")) return
        await queueTrigger(sessionID, {
          source: "permission.asked",
          force: autoConfig.onPermissionAsked.force,
          detail: summary || "permission asked",
        })
        return
      }

      if (evt.type === "permission.replied") {
        const sessionID = typeof evt.properties?.sessionID === "string" ? evt.properties.sessionID : ""
        if (!sessionID) return
        const requestID =
          typeof evt.properties?.requestID === "string"
            ? evt.properties.requestID
            : typeof evt.properties?.permissionID === "string"
              ? evt.properties.permissionID
              : ""
        const reply =
          typeof evt.properties?.reply === "string"
            ? evt.properties.reply
            : typeof evt.properties?.response === "string"
              ? evt.properties.response
              : ""
        const asked = requestID ? permissionAsked.get(requestID) : undefined
        if (requestID) {
          permissionAsked.delete(requestID)
        }
        if (reply !== "reject") return
        const summary = toSummary([
          asked?.summary,
          requestID ? `request=${requestID}` : undefined,
          "reply=reject",
        ])
        if (!shouldTriggerEventRule(autoConfig.onPermissionRejected, summary || "permission rejected")) return
        await queueTrigger(sessionID, {
          source: "permission.replied.reject",
          force: autoConfig.onPermissionRejected.force,
          detail: summary || "permission rejected",
        })
        return
      }

      if (evt.type === "question.asked") {
        const sessionID = typeof evt.properties?.sessionID === "string" ? evt.properties.sessionID : ""
        if (!sessionID) return
        const requestID = typeof evt.properties?.id === "string" ? evt.properties.id : ""
        const summary = summarizeQuestionEvent(evt.properties)
        if (requestID) {
          questionAsked.set(requestID, {
            sessionID,
            summary,
          })
        }
        if (!shouldTriggerEventRule(autoConfig.onQuestionAsked, summary || "question asked")) return
        await queueTrigger(sessionID, {
          source: "question.asked",
          force: autoConfig.onQuestionAsked.force,
          detail: summary || "question asked",
        })
        return
      }

      if (evt.type === "question.replied") {
        const requestID = typeof evt.properties?.requestID === "string" ? evt.properties.requestID : ""
        if (!requestID) return
        questionAsked.delete(requestID)
        return
      }

      if (evt.type === "question.rejected") {
        const sessionID = typeof evt.properties?.sessionID === "string" ? evt.properties.sessionID : ""
        if (!sessionID) return
        const requestID = typeof evt.properties?.requestID === "string" ? evt.properties.requestID : ""
        const asked = requestID ? questionAsked.get(requestID) : undefined
        if (requestID) {
          questionAsked.delete(requestID)
        }
        const summary = toSummary([
          asked?.summary,
          requestID ? `request=${requestID}` : undefined,
          "question=rejected",
        ])
        if (!shouldTriggerEventRule(autoConfig.onQuestionRejected, summary || "question rejected")) return
        await queueTrigger(sessionID, {
          source: "question.rejected",
          force: autoConfig.onQuestionRejected.force,
          detail: summary || "question rejected",
        })
      }
    },
  }
}

export default PlanpilotPlugin

function containsForbiddenFlags(argv: string[]): boolean {
  return argv.some((token) => {
    if (token === "--cwd" || token === "--session-id") return true
    if (token.startsWith("--cwd=") || token.startsWith("--session-id=")) return true
    return false
  })
}
