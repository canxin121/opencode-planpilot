import fs from "fs"
import { openDatabase, resolvePlanMarkdownPath, ensureParentDir } from "./lib/db"
import { PlanpilotApp } from "./lib/app"
import {
  createEmptyStatusChanges,
  statusChangesEmpty,
  type GoalStatus,
  type PlanOrder,
  type PlanStatus,
  type StepExecutor,
  type StepStatus,
} from "./lib/models"
import { AppError, invalidInput } from "./lib/errors"
import { ensureNonEmpty, projectMatchesPath, resolveMaybeRealpath } from "./lib/util"
import { formatGoalDetail, formatPlanDetail, formatPlanMarkdown, formatStepDetail } from "./lib/format"
import { PLANPILOT_HELP_TEXT } from "./prompt"

const DEFAULT_PAGE = 1
const DEFAULT_LIMIT = 20

export type CommandIO = {
  log: (...args: any[]) => void
}

export type CommandContext = {
  sessionId: string
  cwd: string
}

const noopIO: CommandIO = {
  log: () => {},
}

let currentIO: CommandIO = noopIO

function log(...args: any[]) {
  currentIO.log(...args)
}

async function withIO<T>(io: CommandIO, fn: () => Promise<T> | T): Promise<T> {
  const prev = currentIO
  currentIO = io
  try {
    return await fn()
  } finally {
    currentIO = prev
  }
}

export function formatCommandError(err: unknown): string {
  if (err instanceof AppError) {
    return `Error: ${err.toDisplayString()}`
  }
  if (err instanceof Error) {
    return `Error: ${err.message}`
  }
  return `Error: ${String(err)}`
}

export async function runCommand(argv: string[], context: CommandContext, io: CommandIO = noopIO) {
  return withIO(io, async () => {
    if (!argv.length) {
      throw invalidInput("missing argv")
    }

    const [section, subcommand, ...args] = argv

    const db = openDatabase()
    const resolvedCwd = resolveMaybeRealpath(context.cwd)
    const app = new PlanpilotApp(db, context.sessionId, resolvedCwd)

    let planIds: number[] = []
    let shouldSync = false

    switch (section) {
      case "help": {
        if (subcommand !== undefined || args.length) {
          const rest = [subcommand, ...args].filter((x) => x !== undefined)
          throw invalidInput(`help unexpected argument: ${rest.join(" ")}`)
        }
        log(PLANPILOT_HELP_TEXT)
        return
      }
      case "plan": {
        const result = await handlePlan(app, subcommand, args, { cwd: context.cwd })
        planIds = result.planIds
        shouldSync = result.shouldSync
        break
      }
      case "step": {
        const result = await handleStep(app, subcommand, args)
        planIds = result.planIds
        shouldSync = result.shouldSync
        break
      }
      case "goal": {
        const result = await handleGoal(app, subcommand, args)
        planIds = result.planIds
        shouldSync = result.shouldSync
        break
      }
      default:
        throw invalidInput(`unknown command: ${section}`)
    }

    if (shouldSync) {
      syncPlanMarkdown(app, planIds)
    }
  })
}

function requireCwd(cwd: string | undefined): string {
  if (!cwd || !cwd.trim()) {
    throw invalidInput("cwd is required")
  }
  return cwd
}

export type { CommandContext as PlanpilotCommandContext, CommandIO as PlanpilotCommandIO }

async function handlePlan(
  app: PlanpilotApp,
  subcommand: string | undefined,
  args: string[],
  context: { cwd: string | undefined },
) {
  switch (subcommand) {
    case "add-tree":
      return { planIds: handlePlanAddTree(app, args), shouldSync: true }
    case "list":
      return { planIds: handlePlanList(app, args, context), shouldSync: false }
    case "count":
      return { planIds: handlePlanCount(app, args, context), shouldSync: false }
    case "search":
      return { planIds: handlePlanSearch(app, args, context), shouldSync: false }
    case "show":
      return { planIds: handlePlanShow(app, args), shouldSync: false }
    case "export":
      return { planIds: handlePlanExport(app, args), shouldSync: false }
    case "comment":
      return { planIds: handlePlanComment(app, args), shouldSync: true }
    case "update":
      return { planIds: handlePlanUpdate(app, args), shouldSync: true }
    case "done":
      return { planIds: handlePlanDone(app, args), shouldSync: true }
    case "remove":
      return { planIds: handlePlanRemove(app, args), shouldSync: true }
    case "activate":
      return { planIds: handlePlanActivate(app, args), shouldSync: true }
    case "show-active":
      return { planIds: handlePlanActive(app), shouldSync: false }
    case "deactivate":
      return { planIds: handlePlanDeactivate(app), shouldSync: true }
    default:
      throw invalidInput(`unknown plan command: ${subcommand ?? ""}`)
  }
}

async function handleStep(app: PlanpilotApp, subcommand: string | undefined, args: string[]) {
  switch (subcommand) {
    case "add":
      return { planIds: handleStepAdd(app, args), shouldSync: true }
    case "add-tree":
      return { planIds: handleStepAddTree(app, args), shouldSync: true }
    case "list":
      return { planIds: handleStepList(app, args), shouldSync: false }
    case "count":
      return { planIds: handleStepCount(app, args), shouldSync: false }
    case "show":
      return { planIds: handleStepShow(app, args), shouldSync: false }
    case "show-next":
      return { planIds: handleStepShowNext(app), shouldSync: false }
    case "wait":
      return { planIds: handleStepWait(app, args), shouldSync: true }
    case "comment":
      return { planIds: handleStepComment(app, args), shouldSync: true }
    case "update":
      return { planIds: handleStepUpdate(app, args), shouldSync: true }
    case "done":
      return { planIds: handleStepDone(app, args), shouldSync: true }
    case "move":
      return { planIds: handleStepMove(app, args), shouldSync: true }
    case "remove":
      return { planIds: handleStepRemove(app, args), shouldSync: true }
    default:
      throw invalidInput(`unknown step command: ${subcommand ?? ""}`)
  }
}

async function handleGoal(app: PlanpilotApp, subcommand: string | undefined, args: string[]) {
  switch (subcommand) {
    case "add":
      return { planIds: handleGoalAdd(app, args), shouldSync: true }
    case "list":
      return { planIds: handleGoalList(app, args), shouldSync: false }
    case "count":
      return { planIds: handleGoalCount(app, args), shouldSync: false }
    case "show":
      return { planIds: handleGoalShow(app, args), shouldSync: false }
    case "comment":
      return { planIds: handleGoalComment(app, args), shouldSync: true }
    case "update":
      return { planIds: handleGoalUpdate(app, args), shouldSync: true }
    case "done":
      return { planIds: handleGoalDone(app, args), shouldSync: true }
    case "remove":
      return { planIds: handleGoalRemove(app, args), shouldSync: true }
    default:
      throw invalidInput(`unknown goal command: ${subcommand ?? ""}`)
  }
}

function handlePlanAddTree(app: PlanpilotApp, args: string[]): number[] {
  const [title, content, ...rest] = args
  if (!title || content === undefined) {
    throw invalidInput("plan add-tree requires <title> <content> and at least one --step")
  }
  ensureNonEmpty("plan title", title)
  ensureNonEmpty("plan content", content)
  const specs = parsePlanAddTreeSteps(rest)
  if (!specs.length) {
    throw invalidInput("plan add-tree requires at least one --step")
  }
  const steps = specs.map((spec) => ({
    content: spec.content,
    executor: spec.executor ?? "ai",
    goals: spec.goals ?? [],
  }))
  const result = app.addPlanTree({ title, content }, steps)
  log(`Created plan ID: ${result.plan.id}: ${result.plan.title} (steps: ${result.stepCount}, goals: ${result.goalCount})`)
  app.setActivePlan(result.plan.id, false)
  log(`Active plan set to ${result.plan.id}: ${result.plan.title}`)

  // Print full detail so the AI can reference plan/step/goal IDs immediately.
  const detail = app.getPlanDetail(result.plan.id)
  log("")
  log(formatPlanDetail(detail.plan, detail.steps, detail.goals))
  return [result.plan.id]
}

function handlePlanList(
  app: PlanpilotApp,
  args: string[],
  context: { cwd: string | undefined },
): number[] {
  const { options, positionals } = parseOptions(args)
  if (positionals.length) {
    throw invalidInput(`plan list unexpected argument: ${positionals.join(" ")}`)
  }
  if (options.search && options.search.length) {
    throw invalidInput("plan list does not accept --search")
  }
  const allowed = new Set(["scope", "status", "limit", "page", "order", "desc", "search"])
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      throw invalidInput(`plan list does not support --${key}`)
    }
  }

  const desiredStatus: PlanStatus | null = parsePlanStatusFilter(options.status)
  const cwd = requireCwd(context.cwd)

  const order = options.order ? parsePlanOrder(options.order) : "updated"
  const desc = options.desc ?? true
  let plans = app.listPlans(order, desc)
  if (!plans.length) {
    log("No plans found.")
    return []
  }
  plans = plans.filter((plan) => (desiredStatus ? plan.status === desiredStatus : true))
  const scope = parseScope(options.scope)
  if (scope === "project") {
    const cwdValue = resolveMaybeRealpath(cwd)
    plans = plans.filter((plan) => plan.last_cwd && projectMatchesPath(plan.last_cwd, cwdValue))
  }
  if (!plans.length) {
    log("No plans found.")
    return []
  }
  const pagination = resolvePagination(options, { limit: DEFAULT_LIMIT, page: DEFAULT_PAGE })
  const total = plans.length
  if (total === 0) {
    log("No plans found.")
    return []
  }
  const totalPages = Math.ceil(total / pagination.limit)
  if (pagination.page > totalPages) {
    log(`Page ${pagination.page} exceeds total pages ${totalPages}.`)
    return []
  }
  const start = pagination.offset
  const end = start + pagination.limit
  plans = plans.slice(start, end)
  const details = app.getPlanDetails(plans)
  printPlanList(details)
  logPageFooter(pagination.page, pagination.limit)
  return []
}

function handlePlanCount(
  app: PlanpilotApp,
  args: string[],
  context: { cwd: string | undefined },
): number[] {
  const { options, positionals } = parseOptions(args)
  if (positionals.length) {
    throw invalidInput(`plan count unexpected argument: ${positionals.join(" ")}`)
  }
  if (options.search && options.search.length) {
    throw invalidInput("plan count does not accept --search")
  }
  const allowed = new Set(["scope", "status", "search"])
  for (const key of Object.keys(options)) {
    if (!allowed.has(key)) {
      throw invalidInput(`plan count does not support --${key}`)
    }
  }

  const desiredStatus: PlanStatus | null = parsePlanStatusFilter(options.status)
  const cwd = requireCwd(context.cwd)

  let plans = app.listPlans()
  if (!plans.length) {
    log("Total: 0")
    return []
  }
  plans = plans.filter((plan) => (desiredStatus ? plan.status === desiredStatus : true))
  const scope = parseScope(options.scope)
  if (scope === "project") {
    const cwdValue = resolveMaybeRealpath(cwd)
    plans = plans.filter((plan) => plan.last_cwd && projectMatchesPath(plan.last_cwd, cwdValue))
  }
  log(`Total: ${plans.length}`)
  return []
}

function handlePlanSearch(
  app: PlanpilotApp,
  args: string[],
  context: { cwd: string | undefined },
): number[] {
  const { options, positionals } = parseOptions(args)
  if (positionals.length) {
    throw invalidInput(`plan search unexpected argument: ${positionals.join(" ")}`)
  }
  if (options.search && !options.search.length) {
    throw invalidInput("plan search requires at least one --search")
  }
  const desiredStatus: PlanStatus | null = parsePlanStatusFilter(options.status)
  const cwd = requireCwd(context.cwd)

  const order = options.order ? parsePlanOrder(options.order) : "updated"
  const desc = options.desc ?? true
  let plans = app.listPlans(order, desc)
  if (!plans.length) {
    log("No plans found.")
    return []
  }
  plans = plans.filter((plan) => (desiredStatus ? plan.status === desiredStatus : true))
  const scope = parseScope(options.scope)
  if (scope === "project") {
    const cwdValue = resolveMaybeRealpath(cwd)
    plans = plans.filter((plan) => plan.last_cwd && projectMatchesPath(plan.last_cwd, cwdValue))
  }
  if (!plans.length) {
    log("No plans found.")
    return []
  }

  const details = app.getPlanDetails(plans)
  const query = new PlanSearchQuery(options.search, options.searchMode, options.searchField, options.matchCase)
  const filtered = details.filter((detail) => planMatchesSearch(detail, query))
  if (!filtered.length) {
    log("No plans found.")
    return []
  }
  const pagination = resolvePagination(options, { limit: DEFAULT_LIMIT, page: DEFAULT_PAGE })
  const totalPages = Math.ceil(filtered.length / pagination.limit)
  if (pagination.page > totalPages) {
    log(`Page ${pagination.page} exceeds total pages ${totalPages}.`)
    return []
  }
  const start = pagination.offset
  const end = start + pagination.limit
  const paged = filtered.slice(start, end)
  printPlanList(paged)
  logPageFooter(pagination.page, pagination.limit)
  return []
}

function handlePlanShow(app: PlanpilotApp, args: string[]): number[] {
  const id = parseIdArg(args, "plan show")
  const detail = app.getPlanDetail(id)
  log(formatPlanDetail(detail.plan, detail.steps, detail.goals))
  return []
}

function handlePlanExport(app: PlanpilotApp, args: string[]): number[] {
  if (args.length < 2) {
    throw invalidInput("plan export requires <id> <path>")
  }
  const id = parseNumber(args[0], "plan id")
  const filePath = args[1]
  const detail = app.getPlanDetail(id)
  const active = app.getActivePlan()
  const isActive = active?.plan_id === detail.plan.id
  const activatedAt = isActive ? active?.updated_at ?? null : null
  ensureParentDir(filePath)
  const markdown = formatPlanMarkdown(isActive, activatedAt ?? null, detail.plan, detail.steps, detail.goals)
  fs.writeFileSync(filePath, markdown, "utf8")
  log(`Exported plan ID: ${detail.plan.id} to ${filePath}`)
  return []
}

function handlePlanComment(app: PlanpilotApp, args: string[]): number[] {
  const entries = parseCommentPairs("plan", args)
  const planIds = app.commentPlans(entries)
  if (planIds.length === 1) {
    log(`Updated plan comment for plan ID: ${planIds[0]}.`)
  } else {
    log(`Updated plan comments for ${planIds.length} plans.`)
  }
  return planIds
}

function handlePlanUpdate(app: PlanpilotApp, args: string[]): number[] {
  if (!args.length) {
    throw invalidInput("plan update requires <id>")
  }
  const id = parseNumber(args[0], "plan id")
  const { options } = parseOptions(args.slice(1))
  if (options.content !== undefined) {
    ensureNonEmpty("plan content", options.content)
  }
  const changes = {
    title: options.title,
    content: options.content,
    status: options.status ? parsePlanStatus(options.status) : undefined,
    comment: options.comment,
  }
  const result = app.updatePlanWithActiveClear(id, changes)
  log(`Updated plan ID: ${result.plan.id}: ${result.plan.title}`)
  if (result.cleared) {
    log("Active plan deactivated because plan is done.")
  }
  if (result.plan.status === "done") {
    notifyPlanCompleted(result.plan.id)
  }
  return [result.plan.id]
}

function handlePlanDone(app: PlanpilotApp, args: string[]): number[] {
  const id = parseIdArg(args, "plan done")
  const result = app.updatePlanWithActiveClear(id, { status: "done" })
  log(`Plan ID: ${result.plan.id} marked done.`)
  if (result.cleared) {
    log("Active plan deactivated because plan is done.")
  }
  if (result.plan.status === "done") {
    notifyPlanCompleted(result.plan.id)
  }
  return [result.plan.id]
}

function handlePlanRemove(app: PlanpilotApp, args: string[]): number[] {
  const id = parseIdArg(args, "plan remove")
  app.deletePlan(id)
  log(`Plan ID: ${id} removed.`)
  return []
}

function handlePlanActivate(app: PlanpilotApp, args: string[]): number[] {
  if (!args.length) {
    throw invalidInput("plan activate requires <id>")
  }
  const id = parseNumber(args[0], "plan id")
  const force = args.slice(1).includes("--force")
  const plan = app.getPlan(id)
  if (plan.status === "done") {
    throw invalidInput("cannot activate plan; plan is done")
  }
  app.setActivePlan(id, force)
  log(`Active plan set to ${plan.id}: ${plan.title}`)
  return [plan.id]
}

function handlePlanActive(app: PlanpilotApp): number[] {
  const active = app.getActivePlan()
  if (!active) {
    log("No active plan.")
    return []
  }
  try {
    const detail = app.getPlanDetail(active.plan_id)
    log(formatPlanDetail(detail.plan, detail.steps, detail.goals))
    return []
  } catch (err) {
    if (err instanceof AppError && err.kind === "NotFound") {
      app.clearActivePlan()
      log(`Active plan ID: ${active.plan_id} not found.`)
      return []
    }
    throw err
  }
}

function handlePlanDeactivate(app: PlanpilotApp): number[] {
  const active = app.getActivePlan()
  app.clearActivePlan()
  log("Active plan deactivated.")
  return active ? [active.plan_id] : []
}

function handleStepAdd(app: PlanpilotApp, args: string[]): number[] {
  if (args.length < 2) {
    throw invalidInput("step add requires <plan_id> <content...>")
  }
  const planId = parseNumber(args[0], "plan id")
  const parsed = parseStepAddArgs(args.slice(1))
  if (!parsed.contents.length) {
    throw invalidInput("no contents provided")
  }
  if (parsed.at !== undefined && parsed.at === 0) {
    throw invalidInput("position starts at 1")
  }
  parsed.contents.forEach((content) => ensureNonEmpty("step content", content))

  const result = app.addStepsBatch(planId, parsed.contents, "todo", parsed.executor ?? "ai", parsed.at)
  if (result.steps.length === 1) {
    log(`Created step ID: ${result.steps[0].id} for plan ID: ${result.steps[0].plan_id}`)
  } else {
    log(`Created ${result.steps.length} steps for plan ID: ${planId}`)
  }
  printStatusChanges(result.changes)
  return [planId]
}

function handleStepAddTree(app: PlanpilotApp, args: string[]): number[] {
  if (args.length < 2) {
    throw invalidInput("step add-tree requires <plan_id> <content>")
  }
  const planId = parseNumber(args[0], "plan id")
  const content = args[1]
  const parsed = parseStepAddTreeArgs(args.slice(2))
  ensureNonEmpty("step content", content)
  parsed.goals.forEach((goal) => ensureNonEmpty("goal content", goal))
  const executor = parsed.executor ?? "ai"

  const result = app.addStepTree(planId, content, executor, parsed.goals)
  log(`Created step ID: ${result.step.id} for plan ID: ${result.step.plan_id} (goals: ${result.goals.length})`)
  printStatusChanges(result.changes)
  notifyAfterStepChanges(app, result.changes)
  notifyPlansCompleted(app, result.changes)
  return [planId]
}

function handleStepList(app: PlanpilotApp, args: string[]): number[] {
  if (!args.length) {
    throw invalidInput("step list requires <plan_id>")
  }
  const planId = parseNumber(args[0], "plan id")
  const { options } = parseOptions(args.slice(1))
  const allowed = new Set(["status", "executor", "limit", "page"])
  for (const key of Object.keys(options)) {
    if (key === "search" && Array.isArray(options.search) && options.search.length === 0) continue
    if (!allowed.has(key)) {
      throw invalidInput(`step list does not support --${key}`)
    }
  }
  const status = parseStepStatusFilter(options.status)
  const pagination = resolvePagination(options, { limit: DEFAULT_LIMIT, page: DEFAULT_PAGE })
  const countQuery = {
    status,
    executor: options.executor ? parseStepExecutor(options.executor) : undefined,
    limit: undefined,
    offset: undefined,
    order: undefined,
    desc: undefined,
  }
  const total = app.countSteps(planId, countQuery)
  if (total === 0) {
    log(`No steps found for plan ID: ${planId}.`)
    return []
  }
  const totalPages = Math.ceil(total / pagination.limit)
  if (pagination.page > totalPages) {
    log(`Page ${pagination.page} exceeds total pages ${totalPages} for plan ID: ${planId}.`)
    return []
  }

  const query = {
    status,
    executor: options.executor ? parseStepExecutor(options.executor) : undefined,
    limit: pagination.limit,
    offset: pagination.offset,
    order: "order" as const,
    desc: false,
  }

  const steps = app.listStepsFiltered(planId, query)
  const details = app.getStepsDetail(steps)
  printStepList(details)
  logPageFooter(pagination.page, pagination.limit)
  return []
}

function handleStepCount(app: PlanpilotApp, args: string[]): number[] {
  if (!args.length) {
    throw invalidInput("step count requires <plan_id>")
  }
  const planId = parseNumber(args[0], "plan id")
  const { options } = parseOptions(args.slice(1))
  const allowed = new Set(["status", "executor"])
  for (const key of Object.keys(options)) {
    if (key === "search" && Array.isArray(options.search) && options.search.length === 0) continue
    if (!allowed.has(key)) {
      throw invalidInput(`step count does not support --${key}`)
    }
  }
  const status = parseStepStatusFilter(options.status)
  const query = {
    status,
    executor: options.executor ? parseStepExecutor(options.executor) : undefined,
    limit: undefined,
    offset: undefined,
    order: undefined,
    desc: undefined,
  }
  const total = app.countSteps(planId, query)
  log(`Total: ${total}`)
  return []
}

function handleStepShow(app: PlanpilotApp, args: string[]): number[] {
  const id = parseIdArg(args, "step show")
  const detail = app.getStepDetail(id)
  log(formatStepDetail(detail.step, detail.goals))
  return []
}

function handleStepShowNext(app: PlanpilotApp): number[] {
  const active = app.getActivePlan()
  if (!active) {
    log("No active plan.")
    return []
  }
  const next = app.nextStep(active.plan_id)
  if (!next) {
    log("No pending step.")
    return []
  }
  const goals = app.goalsForStep(next.id)
  log(formatStepDetail(next, goals))
  return []
}

function handleStepWait(app: PlanpilotApp, args: string[]): number[] {
  if (!args.length) {
    throw invalidInput("step wait requires <id>")
  }
  const stepId = parseNumber(args[0], "step id")
  const options = parseOptions(args.slice(1)).options
  if (options.clear) {
    const result = app.clearStepWait(stepId)
    log(`Step ID: ${result.step.id} wait cleared.`)
    return [result.step.plan_id]
  }
  if (options.delay === undefined) {
    throw invalidInput("step wait requires --delay <ms> or --clear")
  }
  const delayMs = parseNumber(options.delay, "delay")
  if (delayMs < 0) {
    throw invalidInput("delay must be >= 0")
  }
  const reason = options.reason ? String(options.reason) : undefined
  const result = app.setStepWait(stepId, delayMs, reason)
  log(`Step ID: ${result.step.id} waiting until ${result.until}.`)
  return [result.step.plan_id]
}

function handleStepUpdate(app: PlanpilotApp, args: string[]): number[] {
  if (!args.length) {
    throw invalidInput("step update requires <id>")
  }
  const id = parseNumber(args[0], "step id")
  const { options } = parseOptions(args.slice(1))
  if (options.content !== undefined) {
    ensureNonEmpty("step content", options.content)
  }
  const status = options.status ? parseStepStatus(options.status) : undefined
  const result = app.updateStep(id, {
    content: options.content,
    status,
    executor: options.executor ? parseStepExecutor(options.executor) : undefined,
    comment: options.comment,
  })
  log(`Updated step ID: ${result.step.id}.`)
  printStatusChanges(result.changes)
  if (status === "done" && result.step.status === "done") {
    notifyNextStepForPlan(app, result.step.plan_id)
  }
  notifyPlansCompleted(app, result.changes)
  return [result.step.plan_id]
}

function handleStepComment(app: PlanpilotApp, args: string[]): number[] {
  const entries = parseCommentPairs("step", args)
  const planIds = app.commentSteps(entries)
  if (planIds.length === 1) {
    log(`Updated step comments for plan ID: ${planIds[0]}.`)
  } else {
    log(`Updated step comments for ${planIds.length} plans.`)
  }
  return planIds
}

function handleStepDone(app: PlanpilotApp, args: string[]): number[] {
  if (!args.length) {
    throw invalidInput("step done requires <id>")
  }
  const id = parseNumber(args[0], "step id")
  const allGoals = args.slice(1).includes("--all-goals")
  const result = app.setStepDoneWithGoals(id, allGoals)
  log(`Step ID: ${result.step.id} marked done.`)
  printStatusChanges(result.changes)
  notifyNextStepForPlan(app, result.step.plan_id)
  notifyPlansCompleted(app, result.changes)
  return [result.step.plan_id]
}

function handleStepMove(app: PlanpilotApp, args: string[]): number[] {
  if (!args.length) {
    throw invalidInput("step move requires <id> --to <pos>")
  }
  const id = parseNumber(args[0], "step id")
  const toIndex = args.indexOf("--to")
  if (toIndex === -1 || toIndex === args.length - 1) {
    throw invalidInput("step move requires --to <pos>")
  }
  const to = parseNumber(args[toIndex + 1], "position")
  if (to === 0) {
    throw invalidInput("position starts at 1")
  }
  const steps = app.moveStep(id, to)
  log(`Reordered steps for plan ID: ${steps[0].plan_id}:`)
  const details = app.getStepsDetail(steps)
  printStepList(details)
  return [steps[0].plan_id]
}

function handleStepRemove(app: PlanpilotApp, args: string[]): number[] {
  if (!args.length) {
    throw invalidInput("no step ids provided")
  }
  const ids = args.map((arg) => parseNumber(arg, "step id"))
  const planIds = app.planIdsForSteps(ids)
  const result = app.deleteSteps(ids)
  if (ids.length === 1) {
    log(`Step ID: ${ids[0]} removed.`)
  } else {
    log(`Removed ${result.deleted} steps.`)
  }
  printStatusChanges(result.changes)
  return planIds
}

function handleGoalAdd(app: PlanpilotApp, args: string[]): number[] {
  if (args.length < 2) {
    throw invalidInput("goal add requires <step_id> <content...>")
  }
  const stepId = parseNumber(args[0], "step id")
  const contents = args.slice(1)
  if (!contents.length) {
    throw invalidInput("no contents provided")
  }
  contents.forEach((content) => ensureNonEmpty("goal content", content))
  const result = app.addGoalsBatch(stepId, contents, "todo")
  if (result.goals.length === 1) {
    log(`Created goal ID: ${result.goals[0].id} for step ID: ${result.goals[0].step_id}`)
  } else {
    log(`Created ${result.goals.length} goals for step ID: ${stepId}`)
  }
  printStatusChanges(result.changes)
  notifyAfterStepChanges(app, result.changes)
  notifyPlansCompleted(app, result.changes)
  const step = app.getStep(stepId)
  return [step.plan_id]
}

function handleGoalList(app: PlanpilotApp, args: string[]): number[] {
  if (!args.length) {
    throw invalidInput("goal list requires <step_id>")
  }
  const stepId = parseNumber(args[0], "step id")
  const { options } = parseOptions(args.slice(1))
  const status = parseGoalStatusFilter(options.status)
  const pagination = resolvePagination(options, { limit: DEFAULT_LIMIT, page: DEFAULT_PAGE })
  const countQuery = {
    status,
    limit: undefined,
    offset: undefined,
  }
  const total = app.countGoals(stepId, countQuery)
  if (total === 0) {
    log(`No goals found for step ID: ${stepId}.`)
    return []
  }
  const totalPages = Math.ceil(total / pagination.limit)
  if (pagination.page > totalPages) {
    log(`Page ${pagination.page} exceeds total pages ${totalPages} for step ID: ${stepId}.`)
    return []
  }

  const query = {
    status,
    limit: pagination.limit,
    offset: pagination.offset,
  }

  const goals = app.listGoalsFiltered(stepId, query)
  printGoalList(goals)
  logPageFooter(pagination.page, pagination.limit)
  return []
}

function handleGoalCount(app: PlanpilotApp, args: string[]): number[] {
  if (!args.length) {
    throw invalidInput("goal count requires <step_id>")
  }
  const stepId = parseNumber(args[0], "step id")
  const { options } = parseOptions(args.slice(1))
  const status = parseGoalStatusFilter(options.status)
  const query = {
    status,
    limit: undefined,
    offset: undefined,
  }
  const total = app.countGoals(stepId, query)
  log(`Total: ${total}`)
  return []
}

function handleGoalShow(app: PlanpilotApp, args: string[]): number[] {
  const id = parseIdArg(args, "goal show")
  const detail = app.getGoalDetail(id)
  log(formatGoalDetail(detail.goal, detail.step))
  return []
}

function handleGoalComment(app: PlanpilotApp, args: string[]): number[] {
  const entries = parseCommentPairs("goal", args)
  const planIds = app.commentGoals(entries)
  if (planIds.length === 1) {
    log(`Updated goal comments for plan ID: ${planIds[0]}.`)
  } else {
    log(`Updated goal comments for ${planIds.length} plans.`)
  }
  return planIds
}

function handleGoalUpdate(app: PlanpilotApp, args: string[]): number[] {
  if (!args.length) {
    throw invalidInput("goal update requires <id>")
  }
  const id = parseNumber(args[0], "goal id")
  const { options } = parseOptions(args.slice(1))
  if (options.content !== undefined) {
    ensureNonEmpty("goal content", options.content)
  }
  const result = app.updateGoal(id, {
    content: options.content,
    status: options.status ? parseGoalStatus(options.status) : undefined,
    comment: options.comment,
  })
  log(`Updated goal ${result.goal.id}.`)
  printStatusChanges(result.changes)
  notifyAfterStepChanges(app, result.changes)
  notifyPlansCompleted(app, result.changes)
  const step = app.getStep(result.goal.step_id)
  return [step.plan_id]
}

function handleGoalDone(app: PlanpilotApp, args: string[]): number[] {
  if (!args.length) {
    throw invalidInput("goal done requires <id>")
  }
  const ids = args.map((arg) => parseNumber(arg, "goal id"))
  if (ids.length === 1) {
    const result = app.setGoalStatus(ids[0], "done")
    log(`Goal ID: ${result.goal.id} marked done.`)
    printStatusChanges(result.changes)
    notifyAfterStepChanges(app, result.changes)
    notifyPlansCompleted(app, result.changes)
    const step = app.getStep(result.goal.step_id)
    return [step.plan_id]
  }
  const planIds = app.planIdsForGoals(ids)
  const result = app.setGoalsStatus(ids, "done")
  log(`Goals marked done: ${result.updated}.`)
  printStatusChanges(result.changes)
  notifyAfterStepChanges(app, result.changes)
  notifyPlansCompleted(app, result.changes)
  return planIds
}

function handleGoalRemove(app: PlanpilotApp, args: string[]): number[] {
  if (!args.length) {
    throw invalidInput("no goal ids provided")
  }
  const ids = args.map((arg) => parseNumber(arg, "goal id"))
  const planIds = app.planIdsForGoals(ids)
  const result = app.deleteGoals(ids)
  if (ids.length === 1) {
    log(`Goal ID: ${ids[0]} removed.`)
  } else {
    log(`Removed ${result.deleted} goals.`)
  }
  printStatusChanges(result.changes)
  notifyAfterStepChanges(app, result.changes)
  notifyPlansCompleted(app, result.changes)
  return planIds
}

function parseIdArg(args: string[], label: string): number {
  if (!args.length) {
    throw invalidInput(`${label} requires <id>`) 
  }
  return parseNumber(args[0], "id")
}

function parseNumber(value: string, label: string): number {
  const num = Number(value)
  if (!Number.isFinite(num) || !Number.isInteger(num)) {
    throw invalidInput(`${label} '${value}' is invalid`)
  }
  return num
}

function parseOptions(args: string[]) {
  const options: Record<string, any> = { search: [] }
  const positionals: string[] = []
  let i = 0
  while (i < args.length) {
    const token = args[i]
    if (!token.startsWith("--")) {
      positionals.push(token)
      i += 1
      continue
    }
    switch (token) {
      case "--scope":
        options.scope = expectValue(args, i, token)
        i += 2
        break
      case "--match-case":
        options.matchCase = true
        i += 1
        break
      case "--desc":
        options.desc = true
        i += 1
        break
      case "--all-goals":
        options.allGoals = true
        i += 1
        break
      case "--force":
        options.force = true
        i += 1
        break
      case "--search":
        options.search.push(expectValue(args, i, token))
        i += 2
        break
      case "--search-mode":
        options.searchMode = expectValue(args, i, token)
        i += 2
        break
      case "--search-field":
        options.searchField = expectValue(args, i, token)
        i += 2
        break
      case "--title":
        options.title = expectValue(args, i, token)
        i += 2
        break
      case "--content":
        options.content = expectValue(args, i, token)
        i += 2
        break
      case "--status":
        options.status = expectValue(args, i, token)
        i += 2
        break
      case "--comment":
        options.comment = expectValue(args, i, token)
        i += 2
        break
      case "--executor":
        options.executor = expectValue(args, i, token)
        i += 2
        break
      case "--limit":
        options.limit = expectValue(args, i, token)
        i += 2
        break
      case "--page":
        options.page = expectValue(args, i, token)
        i += 2
        break
      case "--order":
        options.order = expectValue(args, i, token)
        i += 2
        break
    case "--to":
      options.to = expectValue(args, i, token)
      i += 2
      break
    case "--delay":
      options.delay = expectValue(args, i, token)
      i += 2
      break
    case "--reason":
      options.reason = expectValue(args, i, token)
      i += 2
      break
    case "--clear":
      options.clear = true
      i += 1
      break
    case "--goal":
      if (!options.goals) options.goals = []
      options.goals.push(expectValue(args, i, token))
      i += 2
      break
    default:
      throw invalidInput(`unexpected argument: ${token}`)
  }

  }
  return { options, positionals }
}

function expectValue(args: string[], index: number, token: string): string {
  const value = args[index + 1]
  if (value === undefined) {
    throw invalidInput(`${token} requires a value`)
  }
  return value
}

function parsePlanStatus(value: string): PlanStatus {
  const normalized = value.trim().toLowerCase()
  if (normalized === "todo" || normalized === "done") return normalized
  throw invalidInput(`invalid status '${value}', expected todo|done`)
}

function parsePlanStatusFilter(value?: string): PlanStatus | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (normalized === "all") return null
  return parsePlanStatus(normalized)
}

function parseStepStatus(value: string): StepStatus {
  return parsePlanStatus(value) as StepStatus
}

function parseGoalStatus(value: string): GoalStatus {
  return parsePlanStatus(value) as GoalStatus
}

function parseStepStatusFilter(value?: string): StepStatus | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (normalized === "all") return null
  return parseStepStatus(normalized)
}

function parseGoalStatusFilter(value?: string): GoalStatus | null {
  if (!value) return null
  const normalized = value.trim().toLowerCase()
  if (normalized === "all") return null
  return parseGoalStatus(normalized)
}

function parseScope(value?: string): "project" | "all" {
  if (!value) return "project"
  const normalized = value.trim().toLowerCase()
  if (normalized === "project" || normalized === "all") return normalized as "project" | "all"
  throw invalidInput(`invalid scope '${value}', expected project|all`)
}

function parsePlanOrder(value: string): PlanOrder {
  const normalized = value.trim().toLowerCase()
  if (normalized === "id" || normalized === "title" || normalized === "created" || normalized === "updated") {
    return normalized as PlanOrder
  }
  throw invalidInput(`invalid order '${value}', expected id|title|created|updated`)
}

function parseStepExecutor(value: string): StepExecutor {
  const normalized = value.trim().toLowerCase()
  if (normalized === "ai" || normalized === "human") return normalized
  throw invalidInput(`invalid executor '${value}', expected ai|human`)
}

function resolvePagination(
  options: Record<string, any>,
  defaults: { limit: number; page: number },
): { limit: number; page: number; offset: number } {
  if (defaults.limit <= 0 || defaults.page < 1) {
    throw invalidInput("invalid default pagination configuration")
  }

  const limit = options.limit !== undefined ? parseNumber(options.limit, "limit") : defaults.limit
  if (limit <= 0) {
    throw invalidInput("limit must be >= 1")
  }

  const page = options.page !== undefined ? parseNumber(options.page, "page") : defaults.page
  if (page < 1) {
    throw invalidInput("page must be >= 1")
  }

  return { limit, page, offset: (page - 1) * limit }
}

type PlanSearchMode = "any" | "all"
type PlanSearchField = "plan" | "title" | "content" | "comment" | "steps" | "goals" | "all"

class PlanSearchQuery {
  terms: string[]
  mode: PlanSearchMode
  field: PlanSearchField
  matchCase: boolean

  constructor(rawTerms: string[] = [], searchMode?: string, searchField?: string, matchCase?: boolean) {
    let terms = rawTerms.map((term) => term.trim()).filter((term) => term.length > 0)
    const caseSensitive = !!matchCase
    if (!caseSensitive) {
      terms = terms.map((term) => term.toLowerCase())
    }
    this.terms = terms
    this.mode = parseSearchMode(searchMode)
    this.field = parseSearchField(searchField)
    this.matchCase = caseSensitive
  }

  hasTerms() {
    return this.terms.length > 0
  }
}

function parseSearchMode(value?: string): PlanSearchMode {
  if (!value) return "all"
  const normalized = value.trim().toLowerCase()
  if (normalized === "any" || normalized === "all") return normalized
  throw invalidInput(`invalid search mode '${value}', expected any|all`)
}

function parseSearchField(value?: string): PlanSearchField {
  if (!value) return "plan"
  const normalized = value.trim().toLowerCase()
  if (["plan", "title", "content", "comment", "steps", "goals", "all"].includes(normalized)) {
    return normalized as PlanSearchField
  }
  throw invalidInput(
    `invalid search field '${value}', expected plan|title|content|comment|steps|goals|all`
  )
}

function planMatchesSearch(detail: ReturnType<PlanpilotApp["getPlanDetail"]>, search: PlanSearchQuery): boolean {
  const haystacks: string[] = []
  const addValue = (value: string) => {
    haystacks.push(search.matchCase ? value : value.toLowerCase())
  }

  const includePlan = search.field === "plan" || search.field === "all"
  const includeTitle = search.field === "title" || includePlan || search.field === "all"
  const includeContent = search.field === "content" || includePlan || search.field === "all"
  const includeComment = search.field === "comment" || includePlan || search.field === "all"
  const includeSteps = search.field === "steps" || search.field === "all"
  const includeGoals = search.field === "goals" || search.field === "all"

  if (includePlan || includeTitle) addValue(detail.plan.title)
  if (includePlan || includeContent) addValue(detail.plan.content)
  if (includePlan || includeComment) {
    if (detail.plan.comment) addValue(detail.plan.comment)
  }
  if (includeSteps) {
    detail.steps.forEach((step) => addValue(step.content))
  }
  if (includeGoals) {
    detail.goals.forEach((goalList) => goalList.forEach((goal) => addValue(goal.content)))
  }

  if (!haystacks.length) return false
  if (search.mode === "any") {
    return search.terms.some((term) => haystacks.some((value) => value.includes(term)))
  }
  return search.terms.every((term) => haystacks.some((value) => value.includes(term)))
}

function parsePlanAddTreeSteps(args: string[]) {
  if (!args.length) {
    throw invalidInput("plan add-tree requires at least one --step")
  }

  const steps: Array<{ content: string; executor?: StepExecutor; goals?: string[] }> = []
  let current: { content: string; executor?: StepExecutor; goals: string[] } | null = null
  let i = 0
  while (i < args.length) {
    const token = args[i]
    if (token === "--") {
      i += 1
      continue
    }
    if (token === "--step") {
      const value = args[i + 1]
      if (value === undefined) {
        throw invalidInput("plan add-tree --step requires a value")
      }
      if (!value.trim()) {
        throw invalidInput("plan add-tree --step cannot be empty")
      }
      if (current) {
        steps.push({ content: current.content, executor: current.executor, goals: current.goals.length ? current.goals : undefined })
      }
      current = { content: value, goals: [] }
      i += 2
      continue
    }
    if (token === "--executor") {
      const value = args[i + 1]
      if (value === undefined) {
        throw invalidInput("plan add-tree --executor requires a value")
      }
      if (!current) {
        throw invalidInput("plan add-tree --executor must follow a --step")
      }
      current.executor = parseStepExecutor(value)
      i += 2
      continue
    }
    if (token === "--goal") {
      const value = args[i + 1]
      if (value === undefined) {
        throw invalidInput("plan add-tree --goal requires a value")
      }
      if (!current) {
        throw invalidInput("plan add-tree --goal must follow a --step")
      }
      current.goals.push(value)
      i += 2
      continue
    }
    throw invalidInput(`plan add-tree unexpected argument: ${token}`)
  }

  if (current) {
    steps.push({ content: current.content, executor: current.executor, goals: current.goals.length ? current.goals : undefined })
  }

  if (!steps.length) {
    throw invalidInput("plan add-tree requires at least one --step")
  }
  return steps
}

function parseCommentPairs(kind: string, pairs: string[]): Array<[number, string]> {
  if (!pairs.length) {
    throw invalidInput(`${kind} comment requires <id> <comment> pairs`)
  }
  if (pairs.length % 2 !== 0) {
    throw invalidInput(`${kind} comment expects <id> <comment> pairs`)
  }
  const entries: Array<[number, string]> = []
  for (let i = 0; i < pairs.length; i += 2) {
    const idValue = pairs[i]
    const comment = pairs[i + 1]
    const id = parseNumber(idValue, `${kind} comment id`)
    ensureNonEmpty("comment", comment)
    entries.push([id, comment])
  }
  return entries
}

function parseStepAddArgs(args: string[]) {
  const contents: string[] = []
  let executor: StepExecutor | undefined
  let at: number | undefined
  let i = 0
  while (i < args.length) {
    const token = args[i]
    if (token === "--executor") {
      const value = expectValue(args, i, token)
      executor = parseStepExecutor(value)
      i += 2
      continue
    }
    if (token === "--at") {
      const value = expectValue(args, i, token)
      at = parseNumber(value, "position")
      i += 2
      continue
    }
    if (token.startsWith("--")) {
      throw invalidInput(`unexpected argument: ${token}`)
    }
    contents.push(token)
    i += 1
  }
  return { contents, executor, at }
}

function parseStepAddTreeArgs(args: string[]) {
  let executor: StepExecutor | undefined
  const goals: string[] = []
  let i = 0
  while (i < args.length) {
    const token = args[i]
    if (token === "--executor") {
      const value = expectValue(args, i, token)
      executor = parseStepExecutor(value)
      i += 2
      continue
    }
    if (token === "--goal") {
      const value = expectValue(args, i, token)
      goals.push(value)
      i += 2
      continue
    }
    throw invalidInput(`unexpected argument: ${token}`)
  }
  return { executor, goals }
}

function printStatusChanges(changes: ReturnType<typeof createEmptyStatusChanges>) {
  if (statusChangesEmpty(changes)) return
  log("Auto status updates:")
  changes.steps.forEach((change) => {
    log(`- Step ID: ${change.step_id} status auto-updated from ${change.from} to ${change.to} (${change.reason}).`)
  })
  changes.plans.forEach((change) => {
    log(`- Plan ID: ${change.plan_id} status auto-updated from ${change.from} to ${change.to} (${change.reason}).`)
  })
  changes.active_plans_cleared.forEach((change) => {
    log(`- Active plan deactivated for plan ID: ${change.plan_id} (${change.reason}).`)
  })
}

function notifyAfterStepChanges(app: PlanpilotApp, changes: ReturnType<typeof createEmptyStatusChanges>) {
  const planIds = new Set<number>()
  changes.steps.forEach((change) => {
    if (change.to === "done") {
      const step = app.getStep(change.step_id)
      planIds.add(step.plan_id)
    }
  })
  planIds.forEach((planId) => notifyNextStepForPlan(app, planId))
}

function notifyPlansCompleted(app: PlanpilotApp, changes: ReturnType<typeof createEmptyStatusChanges>) {
  const planIds = new Set<number>()
  changes.plans.forEach((change) => {
    if (change.to === "done") planIds.add(change.plan_id)
  })
  planIds.forEach((planId) => {
    const plan = app.getPlan(planId)
    if (plan.status === "done") {
      notifyPlanCompleted(plan.id)
    }
  })
}

function notifyPlanCompleted(planId: number) {
  log(`Plan ID: ${planId} is complete. Summarize the completed results to the user, then end this turn.`)
}

function notifyNextStepForPlan(app: PlanpilotApp, planId: number) {
  const next = app.nextStep(planId)
  if (!next) return
  if (next.executor === "ai") {
    log(`Next step is assigned to ai (step ID: ${next.id}). Please end this turn so Planpilot can surface it.`)
    return
  }
  const goals = app.goalsForStep(next.id)
  log("Next step requires human action:")
  log(formatStepDetail(next, goals))
  log(
    "Tell the user to complete the above step and goals. Confirm each goal when done, then end this turn."
  )
}

const COL_ID = 6
const COL_STAT = 6
const COL_STEPS = 9
const COL_ORDER = 5
const COL_EXEC = 6
const COL_GOALS = 9
const COL_TEXT = 30

function printPlanList(details: ReturnType<PlanpilotApp["getPlanDetails"]>) {
  log(`${pad("ID", COL_ID)} ${pad("STAT", COL_STAT)} ${pad("STEPS", COL_STEPS)} ${pad("TITLE", COL_TEXT)} COMMENT`)
  details.forEach((detail) => {
    const total = detail.steps.length
    const done = detail.steps.filter((step) => step.status === "done").length
    log(
      `${pad(String(detail.plan.id), COL_ID)} ${pad(detail.plan.status, COL_STAT)} ${pad(`${done}/${total}`, COL_STEPS)} ${pad(detail.plan.title, COL_TEXT)} ${detail.plan.comment ?? ""}`
    )
  })
}

function printStepList(details: ReturnType<PlanpilotApp["getStepsDetail"]>) {
  log(
    `${pad("ID", COL_ID)} ${pad("STAT", COL_STAT)} ${pad("ORD", COL_ORDER)} ${pad("EXEC", COL_EXEC)} ${pad("GOALS", COL_GOALS)} ${pad("CONTENT", COL_TEXT)} COMMENT`
  )
  details.forEach((detail) => {
    const total = detail.goals.length
    const done = detail.goals.filter((goal) => goal.status === "done").length
    log(
      `${pad(String(detail.step.id), COL_ID)} ${pad(detail.step.status, COL_STAT)} ${pad(String(detail.step.sort_order), COL_ORDER)} ${pad(detail.step.executor, COL_EXEC)} ${pad(`${done}/${total}`, COL_GOALS)} ${pad(detail.step.content, COL_TEXT)} ${detail.step.comment ?? ""}`
    )
  })
}

function printGoalList(goals: ReturnType<PlanpilotApp["listGoalsFiltered"]>) {
  log(`${pad("ID", COL_ID)} ${pad("STAT", COL_STAT)} ${pad("CONTENT", COL_TEXT)} COMMENT`)
  goals.forEach((goal) => {
    log(`${pad(String(goal.id), COL_ID)} ${pad(goal.status, COL_STAT)} ${pad(goal.content, COL_TEXT)} ${goal.comment ?? ""}`)
  })
}

function logPageFooter(page: number, limit: number) {
  log(`Page ${page} / Limit ${limit}`)
}

function pad(value: string, width: number) {
  if (value.length >= width) return value
  return value.padEnd(width, " ")
}

function syncPlanMarkdown(app: PlanpilotApp, planIds: number[]) {
  if (!planIds.length) return
  const unique = Array.from(new Set(planIds))
  const active = app.getActivePlan()
  const activeId = active?.plan_id
  const activeUpdated = active?.updated_at ?? null

  unique.forEach((planId) => {
    let detail
    try {
      detail = app.getPlanDetail(planId)
    } catch (err) {
      if (err instanceof AppError && err.kind === "NotFound") return
      throw err
    }
    const isActive = activeId === planId
    const activatedAt = isActive ? activeUpdated : null
    const mdPath = resolvePlanMarkdownPath(planId)
    ensureParentDir(mdPath)
    const markdown = formatPlanMarkdown(isActive, activatedAt, detail.plan, detail.steps, detail.goals)
    fs.writeFileSync(mdPath, markdown, "utf8")
  })
}
