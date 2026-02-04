import { tool, type Plugin } from "@opencode-ai/plugin"
import { runCommand, formatCommandError } from "./command"
import { PlanpilotApp } from "./lib/app"
import { openDatabase } from "./lib/db"
import { invalidInput } from "./lib/errors"
import { formatStepDetail } from "./lib/format"
import { parseWaitFromComment } from "./lib/util"
import { PLANPILOT_SYSTEM_INJECTION, PLANPILOT_TOOL_DESCRIPTION, formatPlanpilotAutoContinueMessage } from "./prompt"

export const PlanpilotPlugin: Plugin = async (ctx) => {
  const inFlight = new Set<string>()
  const skipNextAuto = new Set<string>()
  const lastIdleAt = new Map<string, number>()
  const waitTimers = new Map<string, ReturnType<typeof setTimeout>>()

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
    }
  }

  const handleSessionIdle = async (sessionID: string) => {
    if (inFlight.has(sessionID)) return
    if (skipNextAuto.has(sessionID)) {
      skipNextAuto.delete(sessionID)
      return
    }
    const lastIdle = lastIdleAt.get(sessionID)
    const now = Date.now()
    if (lastIdle && now - lastIdle < 1000) return
    lastIdleAt.set(sessionID, now)
    inFlight.add(sessionID)
    try {
      const app = new PlanpilotApp(openDatabase(), sessionID)
      const active = app.getActivePlan()
      if (!active) return
      const next = app.nextStep(active.plan_id)
      if (!next) return
      if (next.executor !== "ai") return
      const wait = parseWaitFromComment(next.comment)
      if (wait && wait.until > now) {
        clearWaitTimer(sessionID)
        await log("info", "auto-continue delayed by step wait", {
          sessionID,
          stepId: next.id,
          until: wait.until,
          reason: wait.reason,
        })
        const msUntil = Math.max(0, wait.until - now)
        const timer = setTimeout(() => {
          waitTimers.delete(sessionID)
          handleSessionIdle(sessionID).catch((err) => {
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
      if (!detail.trim()) return

      const autoContext = await resolveAutoContext(sessionID)
      if (autoContext?.missingUser) {
        await log("warn", "auto-continue stopped: missing user context", { sessionID })
        return
      }
      if (autoContext?.aborted || autoContext?.ready === false) return

      const timestamp = new Date().toISOString()
      const message = formatPlanpilotAutoContinueMessage({
        timestamp,
        stepDetail: detail,
      })

      const promptBody: any = {
        agent: autoContext?.agent ?? undefined,
        model: autoContext?.model ?? undefined,
        parts: [{ type: "text" as const, text: message }],
      }
      if (autoContext?.variant) {
        promptBody.variant = autoContext.variant
      }

      await ctx.client.session.promptAsync({
        path: { id: sessionID },
        body: promptBody,
      })
    } catch (err) {
      await log("warn", "failed to auto-continue plan", { error: err instanceof Error ? err.message : String(err) })
    } finally {
      inFlight.delete(sessionID)
    }
  }

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

      // Compaction runs with tools disabled; inject Planpilot guidance into the continuation summary.
      output.context.push(PLANPILOT_TOOL_DESCRIPTION)
    },
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await handleSessionIdle(event.properties.sessionID)
        return
      }
      if (event.type === "session.status" && event.properties.status.type === "idle") {
        await handleSessionIdle(event.properties.sessionID)
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
