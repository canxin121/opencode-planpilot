import { PlanpilotApp } from "../lib/app"
import { AppError, invalidInput } from "../lib/errors"
import {
  loadPlanpilotConfig,
  normalizePlanpilotConfig,
  savePlanpilotConfig,
  type PlanpilotConfig,
} from "../lib/config"
import { openDatabase } from "../lib/db"
import { parseWaitFromComment } from "../lib/util"
import type {
  GoalQuery,
  GoalStatus,
  PlanDetail,
  PlanOrder,
  PlanStatus,
  StepDetail,
  StepExecutor,
  StepOrder,
  StepQuery,
  StepStatus,
} from "../lib/models"

type JsonPrimitive = string | number | boolean | null
type JsonObject = object
type JsonValue = JsonPrimitive | JsonObject | JsonValue[]

type BridgeRequest = {
  action: string
  payload?: unknown
  context?: unknown
  plugin?: unknown
}

type BridgeSuccess = {
  ok: true
  data: JsonValue
}

type BridgeFailure = {
  ok: false
  error: {
    code: string
    message: string
    details: JsonValue | null
  }
}

type BridgeResponse = BridgeSuccess | BridgeFailure

type BridgeRequestContext = {
  sessionId: string
  cwd?: string
}

type ActionHandler = (payload: unknown, context: BridgeRequestContext) => JsonValue

const DEFAULT_SESSION_ID = "studio"

const PLAN_UPDATE_ALLOWED = new Set(["title", "content", "status", "comment"])
const STEP_UPDATE_ALLOWED = new Set(["content", "status", "executor", "comment"])
const GOAL_UPDATE_ALLOWED = new Set(["content", "status", "comment"])

async function main() {
  const response = await runBridge()
  process.stdout.write(JSON.stringify(response))
}

async function runBridge(): Promise<BridgeResponse> {
  try {
    const raw = await readStdinOnce()
    const request = parseRequest(raw)
    const context = resolveRequestContext(request)
    const data = dispatch(request.action, request.payload, context)
    return ok(data)
  } catch (error) {
    return fail(error)
  }
}

function parseRequest(raw: string): BridgeRequest {
  if (!raw.trim()) {
    throw invalidInput("bridge request is empty")
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw invalidInput(`bridge request is not valid JSON: ${message}`)
  }

  const root = asObject(parsed, "bridge request")
  const action = expectString(root.action, "action")
  return {
    action,
    payload: root.payload,
    context: root.context,
    plugin: root.plugin,
  }
}

function resolveRequestContext(request: BridgeRequest): BridgeRequestContext {
  const context = asObjectOptional(request.context)
  const plugin = asObjectOptional(request.plugin)
  const sessionId =
    readNonEmptyString(context?.sessionId) ?? readNonEmptyString(context?.sessionID) ?? DEFAULT_SESSION_ID
  const cwd =
    readNonEmptyString(context?.cwd) ??
    readNonEmptyString(context?.directory) ??
    readNonEmptyString(plugin?.rootPath) ??
    undefined
  return { sessionId, cwd }
}

function createApp(context: BridgeRequestContext): PlanpilotApp {
  return new PlanpilotApp(openDatabase(), context.sessionId, context.cwd)
}

function dispatch(action: string, payload: unknown, context: BridgeRequestContext): JsonValue {
  const handler = ACTIONS[action]
  if (!handler) {
    throw invalidInput(`unknown action: ${action}`)
  }
  return handler(payload, context)
}

const ACTIONS: Record<string, ActionHandler> = {
  "runtime.snapshot": actionRuntimeSnapshot,
  "runtime.next": actionRuntimeNext,
  "runtime.pause": actionRuntimePause,
  "runtime.resume": actionRuntimeResume,
  "events.poll": actionEventsPoll,
  "config.get": actionConfigGet,
  "config.set": actionConfigSet,
  "plan.list": actionPlanList,
  "plan.get": actionPlanGet,
  "plan.createTree": actionPlanAddTree,
  "plan.addTree": actionPlanAddTree,
  "plan.update": actionPlanUpdate,
  "plan.done": actionPlanDone,
  "plan.remove": actionPlanRemove,
  "plan.activate": actionPlanActivate,
  "plan.deactivate": actionPlanDeactivate,
  "plan.active": actionPlanActive,
  "step.list": actionStepList,
  "step.get": actionStepGet,
  "step.add": actionStepAdd,
  "step.addTree": actionStepAddTree,
  "step.update": actionStepUpdate,
  "step.done": actionStepDone,
  "step.remove": actionStepRemove,
  "step.move": actionStepMove,
  "step.wait": actionStepWait,
  "goal.list": actionGoalList,
  "goal.get": actionGoalGet,
  "goal.add": actionGoalAdd,
  "goal.update": actionGoalUpdate,
  "goal.done": actionGoalDone,
  "goal.remove": actionGoalRemove,
}

function actionRuntimeSnapshot(_payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  return buildRuntimeSnapshot(app, loadPlanpilotConfig().config)
}

function actionRuntimeNext(_payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const active = app.getActivePlan()
  if (!active) {
    return {
      activePlan: null,
      nextStep: null,
      cursor: buildRuntimeCursor(app, loadPlanpilotConfig().config),
    }
  }

  const nextStep = app.nextStep(active.plan_id)
  return {
    activePlan: active,
    nextStep: nextStep ? serializeStepDetail(app.getStepDetail(nextStep.id)) : null,
    cursor: buildRuntimeCursor(app, loadPlanpilotConfig().config),
  }
}

function actionRuntimePause(_payload: unknown, context: BridgeRequestContext): JsonValue {
  const loaded = loadPlanpilotConfig()
  const config = normalizePlanpilotConfig(loaded.config)
  config.runtime.paused = true
  savePlanpilotConfig(config)
  const app = createApp(context)
  return buildRuntimeSnapshot(app, config)
}

function actionRuntimeResume(_payload: unknown, context: BridgeRequestContext): JsonValue {
  const loaded = loadPlanpilotConfig()
  const config = normalizePlanpilotConfig(loaded.config)
  config.runtime.paused = false
  savePlanpilotConfig(config)
  const app = createApp(context)
  return buildRuntimeSnapshot(app, config)
}

function actionEventsPoll(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const config = loadPlanpilotConfig().config
  const currentCursor = buildRuntimeCursor(app, config)

  const input = asObjectOptional(payload)
  const previousCursor = readNonEmptyString(input?.cursor) ?? ""
  if (previousCursor === currentCursor) {
    return {
      cursor: currentCursor,
      events: [],
    }
  }

  return {
    cursor: currentCursor,
    events: [
      {
        event: "planpilot.runtime.changed",
        id: currentCursor,
        data: buildRuntimeSnapshot(app, config),
      },
    ],
  }
}

function actionConfigGet(_payload: unknown, _context: BridgeRequestContext): JsonValue {
  const loaded = loadPlanpilotConfig()
  return loaded.config as unknown as JsonValue
}

function actionConfigSet(payload: unknown, _context: BridgeRequestContext): JsonValue {
  const root = asObject(payload, "config.set payload")
  const raw = "config" in root ? root.config : payload
  const normalized = normalizePlanpilotConfig(raw)
  const saved = savePlanpilotConfig(normalized)
  return {
    path: saved.path,
    config: saved.config as unknown as JsonValue,
  }
}

function actionPlanList(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObjectOptional(payload)
  const order = parsePlanOrderOptional(input?.order)
  const desc = readBoolean(input?.desc) ?? true
  const plans = app.listPlans(order, desc)
  return plans as unknown as JsonValue
}

function actionPlanGet(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "plan.get payload")
  const id = expectInt(input.id, "id")
  return serializePlanDetail(app.getPlanDetail(id))
}

function actionPlanAddTree(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "plan.createTree payload")
  const title = expectString(input.title, "title")
  const content = expectString(input.content, "content")
  const stepsInput = expectArray(input.steps, "steps")
  const steps = stepsInput.map((item, index) => {
    const step = asObject(item, `steps[${index}]`)
    return {
      content: expectString(step.content, `steps[${index}].content`),
      executor: parseExecutorOptional(step.executor) ?? "ai",
      goals: readStringArray(step.goals),
    }
  })

  const result = app.addPlanTree({ title, content }, steps)
  return {
    plan: result.plan,
    stepCount: result.stepCount,
    goalCount: result.goalCount,
    detail: serializePlanDetail(app.getPlanDetail(result.plan.id)),
  }
}

function actionPlanUpdate(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "plan.update payload")
  const id = expectInt(input.id, "id")
  assertAllowedKeys(input, PLAN_UPDATE_ALLOWED, "plan.update")
  const result = app.updatePlanWithActiveClear(id, {
    title: readString(input.title),
    content: readString(input.content),
    status: parsePlanStatusOptional(input.status),
    comment: readNullableString(input.comment),
  })
  return {
    plan: result.plan,
    cleared: result.cleared,
  }
}

function actionPlanDone(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "plan.done payload")
  const id = expectInt(input.id, "id")
  return app.updatePlanWithActiveClear(id, { status: "done" }) as unknown as JsonValue
}

function actionPlanRemove(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "plan.remove payload")
  const id = expectInt(input.id, "id")
  app.deletePlan(id)
  return { removed: id }
}

function actionPlanActivate(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "plan.activate payload")
  const id = expectInt(input.id, "id")
  const force = readBoolean(input.force) ?? false
  const plan = app.getPlan(id)
  if (plan.status === "done") {
    throw invalidInput("cannot activate plan; plan is done")
  }
  return app.setActivePlan(id, force) as unknown as JsonValue
}

function actionPlanDeactivate(_payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const active = app.getActivePlan()
  app.clearActivePlan()
  return {
    activePlan: active,
    deactivated: true,
  }
}

function actionPlanActive(_payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const active = app.getActivePlan()
  if (!active) {
    return { activePlan: null, detail: null }
  }
  return {
    activePlan: active,
    detail: serializePlanDetail(app.getPlanDetail(active.plan_id)),
  }
}

function actionStepList(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "step.list payload")
  const planId = expectInt(input.planId, "planId")
  const query: StepQuery = {
    status: parseStepStatusOptional(input.status),
    executor: parseExecutorOptional(input.executor),
    limit: parseIntOptional(input.limit),
    offset: parseIntOptional(input.offset),
    order: parseStepOrderOptional(input.order),
    desc: readBoolean(input.desc),
  }
  const steps = app.listStepsFiltered(planId, query)
  return steps as unknown as JsonValue
}

function actionStepGet(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "step.get payload")
  const id = expectInt(input.id, "id")
  return serializeStepDetail(app.getStepDetail(id))
}

function actionStepAdd(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "step.add payload")
  const planId = expectInt(input.planId, "planId")
  const contents = resolveContents(input, "content", "contents")
  const executor = parseExecutorOptional(input.executor) ?? "ai"
  const at = parseIntOptional(input.at)
  const result = app.addStepsBatch(planId, contents, "todo", executor, at)
  return {
    steps: result.steps,
    changes: result.changes,
  }
}

function actionStepAddTree(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "step.addTree payload")
  const planId = expectInt(input.planId, "planId")
  const content = expectString(input.content, "content")
  const executor = parseExecutorOptional(input.executor) ?? "ai"
  const goals = readStringArray(input.goals)
  return app.addStepTree(planId, content, executor, goals) as unknown as JsonValue
}

function actionStepUpdate(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "step.update payload")
  const id = expectInt(input.id, "id")
  assertAllowedKeys(input, STEP_UPDATE_ALLOWED, "step.update")
  return app.updateStep(id, {
    content: readString(input.content),
    status: parseStepStatusOptional(input.status),
    executor: parseExecutorOptional(input.executor),
    comment: readNullableString(input.comment),
  }) as unknown as JsonValue
}

function actionStepDone(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "step.done payload")
  const id = expectInt(input.id, "id")
  const allGoals = readBoolean(input.allGoals) ?? false
  return app.setStepDoneWithGoals(id, allGoals) as unknown as JsonValue
}

function actionStepRemove(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "step.remove payload")
  const ids = resolveIds(input)
  return app.deleteSteps(ids) as unknown as JsonValue
}

function actionStepMove(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "step.move payload")
  const id = expectInt(input.id, "id")
  const to = expectInt(input.to, "to")
  return app.moveStep(id, to) as unknown as JsonValue
}

function actionStepWait(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "step.wait payload")
  const id = expectInt(input.id, "id")
  const clear = readBoolean(input.clear) ?? false
  if (clear) {
    return app.clearStepWait(id) as unknown as JsonValue
  }

  const delayMs = expectInt(input.delayMs, "delayMs")
  const reason = readString(input.reason)
  return app.setStepWait(id, delayMs, reason) as unknown as JsonValue
}

function actionGoalList(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "goal.list payload")
  const stepId = expectInt(input.stepId, "stepId")
  const query: GoalQuery = {
    status: parseGoalStatusOptional(input.status),
    limit: parseIntOptional(input.limit),
    offset: parseIntOptional(input.offset),
  }
  return app.listGoalsFiltered(stepId, query) as unknown as JsonValue
}

function actionGoalGet(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "goal.get payload")
  const id = expectInt(input.id, "id")
  return app.getGoalDetail(id) as unknown as JsonValue
}

function actionGoalAdd(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "goal.add payload")
  const stepId = expectInt(input.stepId, "stepId")
  const contents = resolveContents(input, "content", "contents")
  return app.addGoalsBatch(stepId, contents, "todo") as unknown as JsonValue
}

function actionGoalUpdate(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "goal.update payload")
  const id = expectInt(input.id, "id")
  assertAllowedKeys(input, GOAL_UPDATE_ALLOWED, "goal.update")
  return app.updateGoal(id, {
    content: readString(input.content),
    status: parseGoalStatusOptional(input.status),
    comment: readNullableString(input.comment),
  }) as unknown as JsonValue
}

function actionGoalDone(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "goal.done payload")
  const ids = resolveIds(input)
  if (ids.length === 1) {
    return app.setGoalStatus(ids[0], "done") as unknown as JsonValue
  }
  return app.setGoalsStatus(ids, "done") as unknown as JsonValue
}

function actionGoalRemove(payload: unknown, context: BridgeRequestContext): JsonValue {
  const app = createApp(context)
  const input = asObject(payload, "goal.remove payload")
  const ids = resolveIds(input)
  return app.deleteGoals(ids) as unknown as JsonValue
}

function resolveContents(input: Record<string, unknown>, contentKey: string, contentsKey: string): string[] {
  const content = readString(input[contentKey])
  const contents = readStringArray(input[contentsKey])
  const out = content ? [content, ...contents] : contents
  if (!out.length) {
    throw invalidInput(`expected ${contentKey} or ${contentsKey}`)
  }
  return out
}

function resolveIds(input: Record<string, unknown>): number[] {
  const fromSingle = parseIntOptional(input.id)
  const fromMany = readIntArray(input.ids)
  const ids = fromSingle !== undefined ? [fromSingle, ...fromMany] : fromMany
  if (!ids.length) {
    throw invalidInput("expected id or ids")
  }
  return Array.from(new Set(ids))
}

function parsePlanOrderOptional(value: unknown): PlanOrder | undefined {
  const raw = readString(value)
  if (!raw) return undefined
  if (raw === "id" || raw === "title" || raw === "created" || raw === "updated") return raw
  throw invalidInput(`invalid plan order '${raw}', expected id|title|created|updated`)
}

function parseStepOrderOptional(value: unknown): StepOrder | undefined {
  const raw = readString(value)
  if (!raw) return undefined
  if (raw === "order" || raw === "id" || raw === "created" || raw === "updated") return raw
  throw invalidInput(`invalid step order '${raw}', expected order|id|created|updated`)
}

function parsePlanStatusOptional(value: unknown): PlanStatus | undefined {
  const raw = readString(value)
  if (!raw) return undefined
  if (raw === "todo" || raw === "done") return raw
  throw invalidInput(`invalid plan status '${raw}', expected todo|done`)
}

function parseStepStatusOptional(value: unknown): StepStatus | undefined {
  const raw = parsePlanStatusOptional(value)
  return raw as StepStatus | undefined
}

function parseGoalStatusOptional(value: unknown): GoalStatus | undefined {
  const raw = parsePlanStatusOptional(value)
  return raw as GoalStatus | undefined
}

function parseExecutorOptional(value: unknown): StepExecutor | undefined {
  const raw = readString(value)
  if (!raw) return undefined
  if (raw === "ai" || raw === "human") return raw
  throw invalidInput(`invalid executor '${raw}', expected ai|human`)
}

function assertAllowedKeys(input: Record<string, unknown>, allowed: Set<string>, action: string) {
  for (const key of Object.keys(input)) {
    if (key === "id") continue
    if (!allowed.has(key)) {
      throw invalidInput(`${action} does not support '${key}'`)
    }
  }
}

function buildRuntimeSnapshot(app: PlanpilotApp, config: PlanpilotConfig): JsonValue {
  const active = app.getActivePlan()
  const next = active ? app.nextStep(active.plan_id) : null
  return {
    paused: config.runtime.paused,
    activePlan: active,
    nextStep: next ? serializeStepDetail(app.getStepDetail(next.id)) : null,
    cursor: buildRuntimeCursor(app, config),
  }
}

function buildRuntimeCursor(app: PlanpilotApp, config: PlanpilotConfig): string {
  const plans = app.listPlans("updated", true)
  const latestPlanUpdated = plans.length ? plans[0].updated_at : 0
  const active = app.getActivePlan()
  const activeUpdated = active?.updated_at ?? 0
  const activePlanId = active?.plan_id ?? 0
  const next = active ? app.nextStep(active.plan_id) : null
  const nextStepId = next?.id ?? 0
  const paused = config.runtime.paused ? 1 : 0
  return [paused, latestPlanUpdated, activeUpdated, activePlanId, nextStepId].join(":")
}

function serializePlanDetail(detail: PlanDetail): JsonValue {
  const goals = detail.steps.map((step) => ({
    stepId: step.id,
    goals: detail.goals.get(step.id) ?? [],
  }))
  return {
    plan: detail.plan,
    steps: detail.steps,
    goals,
  }
}

function serializeStepDetail(detail: StepDetail): JsonValue {
  const wait = parseWaitFromComment(detail.step.comment)
  return {
    step: detail.step,
    goals: detail.goals,
    wait,
  }
}

function ok(data: JsonValue): BridgeSuccess {
  return { ok: true, data }
}

function fail(error: unknown): BridgeFailure {
  if (error instanceof AppError) {
    const code =
      error.kind === "InvalidInput"
        ? "invalid_input"
        : error.kind === "NotFound"
          ? "not_found"
          : error.kind === "Db"
            ? "db_error"
            : error.kind === "Io"
              ? "io_error"
              : "json_error"
    return {
      ok: false,
      error: {
        code,
        message: error.toDisplayString(),
        details: null,
      },
    }
  }

  const message = error instanceof Error ? error.message : String(error)
  return {
    ok: false,
    error: {
      code: "internal_error",
      message,
      details: null,
    },
  }
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidInput(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function asObjectOptional(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined
  }
  return value as Record<string, unknown>
}

function expectString(value: unknown, label: string): string {
  const parsed = readString(value)
  if (!parsed) {
    throw invalidInput(`${label} is required`)
  }
  return parsed
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

function readNullableString(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined
  return readString(value)
}

function readNonEmptyString(value: unknown): string | undefined {
  return readString(value)
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

function expectInt(value: unknown, label: string): number {
  const parsed = parseIntOptional(value)
  if (parsed === undefined) {
    throw invalidInput(`${label} must be an integer`)
  }
  return parsed
}

function parseIntOptional(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return undefined
  }
  return value
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const text = readString(item)
    if (text) out.push(text)
  }
  return out
}

function readIntArray(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  const out: number[] = []
  for (const item of value) {
    const id = parseIntOptional(item)
    if (id !== undefined) out.push(id)
  }
  return out
}

function expectArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw invalidInput(`${label} must be an array`)
  }
  return value
}

async function readStdinOnce(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString("utf8")
}

void main()
