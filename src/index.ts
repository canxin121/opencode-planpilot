import { tool, type Plugin } from "@opencode-ai/plugin"
import { runCLI, formatCliError } from "./cli"
import { PlanpilotApp } from "./lib/app"
import { parseCommandArgs } from "./lib/argv"
import { openDatabase } from "./lib/db"
import { invalidInput } from "./lib/errors"
import { formatStepDetail } from "./lib/format"
import { loadPlanpilotInstructions } from "./lib/instructions"

export const PlanpilotPlugin: Plugin = async (ctx) => {
  const inFlight = new Set<string>()
  const skipNextAuto = new Set<string>()
  const lastIdleAt = new Map<string, number>()

  const PLANPILOT_GUIDANCE = [
    "Planpilot guidance:",
    "- Do not read plan files from disk or follow plan file placeholders.",
    "- Use the planpilot tool for plan/step/goal info (plan show-active, step show-next, goal list <step_id>).",
  ].join("\n")

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
      const goals = app.goalsForStep(next.id)
      const detail = formatStepDetail(next, goals)
      if (!detail.trim()) return

      const message =
        "Planpilot (auto):\n" +
        "Before acting, think through the next step and its goals. Record implementation details using Planpilot comments (plan/step/goal --comment or comment commands). Continue with the next step (executor: ai). Do not ask for confirmation; proceed and report results.\n\n" +
        PLANPILOT_GUIDANCE +
        "\n\n" +
        detail.trimEnd()

      await ctx.client.session.promptAsync({
        path: { id: sessionID },
        body: {
          parts: [{ type: "text", text: message }],
        },
      })
    } catch (err) {
      await log("warn", "failed to auto-continue plan", { error: err instanceof Error ? err.message : String(err) })
    } finally {
      inFlight.delete(sessionID)
    }
  }

  return {
    tool: {
      planpilot: tool({
        description:
          "Planpilot planner. Use for all plan/step/goal operations. Provide either argv (array) or command (string). " +
          "Do not include --session-id/--cwd; they are injected automatically from the current session.",
        args: {
          argv: tool.schema.array(tool.schema.string()).optional(),
          command: tool.schema.string().min(1),
        },
        async execute(args, toolCtx) {
          let argv: string[] = []
          if (Array.isArray(args.argv) && args.argv.length) {
            argv = args.argv
          } else if (typeof args.command === "string" && args.command.trim()) {
            argv = parseCommandArgs(args.command)
          } else {
            return formatCliError(invalidInput("missing command"))
          }

          const cwd = (ctx.directory ?? "").trim()
          if (!cwd) {
            return formatCliError(invalidInput(`${"--cwd"} is required`))
          }

          if (containsForbiddenFlags(argv)) {
            return formatCliError(invalidInput("do not pass --cwd or --session-id"))
          }

          const finalArgv = [...argv]
          if (!finalArgv.includes("--cwd")) {
            finalArgv.unshift("--cwd", cwd)
          }
          if (!finalArgv.includes("--session-id")) {
            finalArgv.unshift("--session-id", toolCtx.sessionID)
          }

          const output: string[] = []
          const io = {
            log: (...parts: any[]) => output.push(parts.map(String).join(" ")),
            error: (...parts: any[]) => output.push(parts.map(String).join(" ")),
          }

          try {
            await runCLI(finalArgv, io)
          } catch (err) {
            return formatCliError(err)
          }

          return output.join("\n").trimEnd()
        },
      }),
    },
    "experimental.chat.system.transform": async (_input, output) => {
      const instructions = loadPlanpilotInstructions().trim()
      const alreadyInjected = output.system.some((entry) => entry.includes("Planpilot (OpenCode Tool)"))
      if (instructions && !alreadyInjected) {
        output.system.push(instructions)
      }
      const guidanceInjected = output.system.some((entry) => entry.includes("Planpilot guidance:"))
      if (!guidanceInjected) {
        output.system.push(PLANPILOT_GUIDANCE)
      }
    },
    "experimental.session.compacting": async ({ sessionID }, output) => {
      const hasGuidance = output.context.some((entry) => entry.includes("Planpilot guidance:"))
      if (!hasGuidance) {
        output.context.push(PLANPILOT_GUIDANCE)
      }
      skipNextAuto.add(sessionID)
      lastIdleAt.set(sessionID, Date.now())
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
