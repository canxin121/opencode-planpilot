/// <reference lib="dom" />

type JsonPrimitive = string | number | boolean | null
type JsonObject = { [k: string]: JsonValue }
type JsonValue = JsonPrimitive | JsonObject | JsonValue[]

type HostApi = {
  invokeAction: (action: string, payload?: JsonValue, context?: JsonValue) => Promise<JsonValue>
  subscribeEvents: (handlers: {
    onEvent?: (evt: { type: string; data: JsonValue; lastEventId?: string }) => void
    onError?: (err: Event) => void
  }) => () => void
}

type LayoutApi = {
  setReservePx: (px: number) => void
}

export type StudioMountOptions = {
  pluginId: string
  surface: string
  title?: string
  context: Record<string, string>
  host: HostApi
  layout?: LayoutApi
}

type PlanStatus = "todo" | "done"
type StepStatus = "todo" | "done"
type GoalStatus = "todo" | "done"

type PlanRow = {
  id: number
  title: string
  content: string
  status: PlanStatus
  comment: string | null
  last_session_id: string | null
  updated_at: number
}

type StepRow = {
  id: number
  plan_id: number
  content: string
  status: StepStatus
  executor: "ai" | "human"
  sort_order: number
  comment: string | null
}

type GoalRow = {
  id: number
  step_id: number
  content: string
  status: GoalStatus
}

type RuntimeStepDetail = {
  step: StepRow
  goals: GoalRow[]
  wait?: { until: number; reason?: string } | null
}

type RuntimeSnapshot = {
  paused: boolean
  activePlan: { plan_id: number } | null
  nextStep: RuntimeStepDetail | null
}

type PlanDetail = {
  plan: PlanRow
  steps: StepRow[]
  goals: Array<{ stepId: number; goals: GoalRow[] }>
}

type State = {
  sessionId: string
  loading: boolean
  busy: boolean
  error: string | null
  showOtherPlans: boolean
  collapsed: boolean
  viewedPlanId: number
  goalsExpandedByStepId: Record<string, boolean>
  runtime: RuntimeSnapshot | null
  activePlanDetail: PlanDetail | null
  sessionPlans: PlanRow[]
}

function asObject(value: JsonValue | undefined | null): Record<string, JsonValue> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {}
  return value as Record<string, JsonValue>
}

function asArray(value: JsonValue | undefined | null): JsonValue[] {
  return Array.isArray(value) ? value : []
}

function toNumber(value: JsonValue | undefined, fallback = 0): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.trunc(value)
}

function toStringValue(value: JsonValue | undefined, fallback = ""): string {
  if (typeof value !== "string") return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

function parseGoal(value: JsonValue): GoalRow | null {
  const obj = asObject(value)
  const id = toNumber(obj.id)
  const stepId = toNumber(obj.step_id)
  const content = toStringValue(obj.content)
  if (!id || !stepId || !content) return null
  return {
    id,
    step_id: stepId,
    content,
    status: toStringValue(obj.status) === "done" ? "done" : "todo",
  }
}

function parseStep(value: JsonValue): StepRow | null {
  const obj = asObject(value)
  const id = toNumber(obj.id)
  const planId = toNumber(obj.plan_id)
  const content = toStringValue(obj.content)
  if (!id || !planId || !content) return null
  return {
    id,
    plan_id: planId,
    content,
    status: toStringValue(obj.status) === "done" ? "done" : "todo",
    executor: toStringValue(obj.executor) === "human" ? "human" : "ai",
    sort_order: toNumber(obj.sort_order),
    comment: typeof obj.comment === "string" ? obj.comment : null,
  }
}

function parsePlan(value: JsonValue): PlanRow | null {
  const obj = asObject(value)
  const id = toNumber(obj.id)
  const title = toStringValue(obj.title)
  if (!id || !title) return null
  return {
    id,
    title,
    content: toStringValue(obj.content),
    status: toStringValue(obj.status) === "done" ? "done" : "todo",
    comment: typeof obj.comment === "string" ? obj.comment : null,
    last_session_id: typeof obj.last_session_id === "string" ? obj.last_session_id : null,
    updated_at: toNumber(obj.updated_at),
  }
}

function parseRuntime(value: JsonValue): RuntimeSnapshot | null {
  const obj = asObject(value)
  const activeObj = asObject(obj.activePlan)
  const nextObj = asObject(obj.nextStep)
  const nextStepRow = parseStep(nextObj.step as JsonValue)
  const nextGoals = asArray(nextObj.goals)
    .map(parseGoal)
    .filter((goal): goal is GoalRow => !!goal)
  const waitObj = asObject(nextObj.wait)

  const nextStepDetail: RuntimeStepDetail | null = nextStepRow
    ? {
        step: nextStepRow,
        goals: nextGoals,
        wait: waitObj.until
          ? {
              until: toNumber(waitObj.until),
              reason: toStringValue(waitObj.reason) || undefined,
            }
          : null,
      }
    : null

  return {
    paused: obj.paused === true,
    activePlan: activeObj.plan_id ? { plan_id: toNumber(activeObj.plan_id) } : null,
    nextStep: nextStepDetail,
  }
}

function parsePlanDetail(value: JsonValue): PlanDetail | null {
  const obj = asObject(value)
  const plan = parsePlan(obj.plan as JsonValue)
  if (!plan) return null

  const steps = asArray(obj.steps)
    .map(parseStep)
    .filter((step): step is StepRow => !!step)
  const goals = asArray(obj.goals)
    .map((entry) => {
      const e = asObject(entry)
      const stepId = toNumber(e.stepId)
      if (!stepId) return null
      const list = asArray(e.goals)
        .map(parseGoal)
        .filter((goal): goal is GoalRow => !!goal)
      return { stepId, goals: list }
    })
    .filter((entry): entry is { stepId: number; goals: GoalRow[] } => !!entry)

  return { plan, steps, goals }
}

function formattedWait(stepDetail: RuntimeStepDetail | null): string {
  const wait = stepDetail?.wait
  if (!wait?.until) return ""
  const when = new Date(wait.until)
  if (Number.isNaN(when.getTime())) return ""
  const time = when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  return wait.reason ? `${time} (${wait.reason})` : time
}

function summarizePlanContent(content: string): string {
  const normalized = String(content || "").replace(/\s+/g, " ").trim()
  if (!normalized) return ""
  if (normalized.length <= 92) return normalized
  return `${normalized.slice(0, 92)}...`
}

function htmlEscape(value: string): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function iconSvg(name: string, className: string): string {
  // Minimal inline icons (keep bundle tiny; exact glyph parity is not required).
  const common = `class="${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"`
  if (name === "check") {
    return `<svg ${common}><path d="M20 6 9 17l-5-5"/></svg>`
  }
  if (name === "chev") {
    return `<svg ${common}><path d="m6 9 6 6 6-6"/></svg>`
  }
  if (name === "refresh") {
    return `<svg ${common}><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/></svg>`
  }
  if (name === "list") {
    return `<svg ${common}><path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/></svg>`
  }
  if (name === "hide") {
    return `<svg ${common}><path d="M3 3l18 18"/><path d="M10.58 10.58A3 3 0 0 0 12 15a3 3 0 0 0 2.42-4.42"/><path d="M9.88 5.09A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a18 18 0 0 1-3.2 4.2"/><path d="M6.1 6.1A18.5 18.5 0 0 0 2 12s3 7 10 7a10.7 10.7 0 0 0 3.1-.4"/></svg>`
  }
  if (name === "clock") {
    return `<svg ${common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>`
  }
  if (name === "stack") {
    return `<svg ${common}><path d="M12 2 2 7l10 5 10-5-10-5Z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/></svg>`
  }
  return ""
}

export function mount(el: HTMLElement, opts: StudioMountOptions) {
  const sessionId = String(opts.context?.sessionId || "").trim()

  const state: State = {
    sessionId,
    loading: false,
    busy: false,
    error: null,
    showOtherPlans: false,
    collapsed: true,
    viewedPlanId: 0,
    goalsExpandedByStepId: {},
    runtime: null,
    activePlanDetail: null,
    sessionPlans: [],
  }

  let refreshTimer: number | null = null
  let stopEvents: (() => void) | null = null
  let reserveObserver: ResizeObserver | null = null
  let reserveRaf = 0

  function setReservePx(px: number) {
    if (!opts.layout) return
    opts.layout.setReservePx(px)
  }

  function computeReserve(): number {
    const rect = el.getBoundingClientRect()
    if (!Number.isFinite(rect.height) || rect.height <= 0) return 0
    // Chat host positions the overlay with `bottom-2`.
    const bottomGap = 8
    return Math.max(0, Math.ceil(rect.height + bottomGap))
  }

  function scheduleReserveUpdate() {
    if (!opts.layout) return
    if (reserveRaf) return
    reserveRaf = window.requestAnimationFrame(() => {
      reserveRaf = 0
      if (!state.sessionId) {
        setReservePx(0)
        return
      }
      setReservePx(computeReserve())
    })
  }

  function isVisible(): boolean {
    return Boolean(state.sessionId)
  }

  function activePlan(): PlanRow | null {
    return state.activePlanDetail?.plan ?? null
  }

  function activeRuntimePlanId(): number {
    return state.runtime?.activePlan?.plan_id ?? 0
  }

  function activePlanId(): number {
    return activePlan()?.id ?? 0
  }

  function orderedSteps(detail: PlanDetail): StepRow[] {
    return [...detail.steps].sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
      return a.id - b.id
    })
  }

  function goalsForStepId(detail: PlanDetail, stepId: number): GoalRow[] {
    const entry = detail.goals.find((g) => g.stepId === stepId)
    const list = entry?.goals ?? []
    return [...list].sort((a, b) => a.id - b.id)
  }

  function isGoalsExpanded(stepId: number): boolean {
    return state.goalsExpandedByStepId[String(stepId)] === true
  }

  function toggleGoalsExpanded(stepId: number) {
    const stepsScrollEl = el.querySelector<HTMLElement>("[data-pp-scroll=\"steps\"]")
    const prevStepsScrollTop = stepsScrollEl ? stepsScrollEl.scrollTop : null

    const key = String(stepId)
    state.goalsExpandedByStepId = {
      ...state.goalsExpandedByStepId,
      [key]: !(state.goalsExpandedByStepId[key] === true),
    }
    render()

    if (prevStepsScrollTop !== null) {
      const restore = () => {
        const nextStepsScrollEl = el.querySelector<HTMLElement>("[data-pp-scroll=\"steps\"]")
        if (nextStepsScrollEl) nextStepsScrollEl.scrollTop = prevStepsScrollTop
      }
      restore()
      window.requestAnimationFrame(restore)
    }

    scheduleReserveUpdate()
  }

  function headerLabel(): string {
    const plan = activePlan()
    if (plan) return `#${plan.id} ${plan.title}`
    if (state.activePlanDetail?.plan) {
      const p = state.activePlanDetail.plan
      return `#${p.id} ${p.title} (viewing)`
    }
    if (state.loading) return "Loading..."
    return "No plans"
  }

  function planContent(): string {
    const content = state.activePlanDetail?.plan.content
    return String(content || "").trim()
  }

  function fallbackStatusMessage(): string {
    if (state.loading && !state.activePlanDetail) return "Checking plan status..."
    if (!state.activePlanDetail) {
      if (state.sessionPlans.length === 0) {
        return "No plans found for this session yet."
      }
      return "No plan is selected right now. Open Plan List to review a recent plan."
    }
    return ""
  }

  async function invoke(action: string, payload: JsonValue = null): Promise<JsonValue> {
    return await opts.host.invokeAction(action, payload, null)
  }

  async function refreshAll() {
    if (!isVisible()) {
      state.runtime = null
      state.activePlanDetail = null
      state.sessionPlans = []
      state.error = null
      state.loading = false
      render()
      setReservePx(0)
      return
    }

    state.loading = true
    state.error = null
    render()
    scheduleReserveUpdate()

    try {
      const [runtimeRaw, activeRaw, plansRaw] = await Promise.all([
        invoke("runtime.snapshot"),
        invoke("plan.active"),
        invoke("plan.list", {}),
      ])

      state.runtime = parseRuntime(runtimeRaw)

      const activeObj = asObject(activeRaw)
      const activeDetail = parsePlanDetail(activeObj.detail as JsonValue)

      const parsedPlans = asArray(plansRaw)
        .map(parsePlan)
        .filter((plan): plan is PlanRow => !!plan)
        .filter((plan) => plan.last_session_id === state.sessionId)
        .sort((a, b) => {
          if (a.updated_at !== b.updated_at) return b.updated_at - a.updated_at
          return b.id - a.id
        })
      state.sessionPlans = parsedPlans

      const planIdSet = new Set(parsedPlans.map((p) => p.id))
      if (state.viewedPlanId > 0 && !planIdSet.has(state.viewedPlanId)) {
        state.viewedPlanId = 0
      }

      const fallbackRecentPlanId = parsedPlans[0]?.id ?? 0
      const targetPlanId =
        state.viewedPlanId > 0
          ? state.viewedPlanId
          : (activeDetail?.plan?.id ?? 0) || fallbackRecentPlanId

      if (!targetPlanId) {
        state.activePlanDetail = null
      } else if (activeDetail && activeDetail.plan.id === targetPlanId) {
        state.activePlanDetail = activeDetail
      } else {
        const detailRaw = await invoke("plan.get", { id: targetPlanId } as unknown as JsonValue)
        state.activePlanDetail = parsePlanDetail(detailRaw)
      }
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error)
      state.runtime = null
      state.activePlanDetail = null
      state.sessionPlans = []
    } finally {
      state.loading = false
      render()
      scheduleReserveUpdate()
    }
  }

  function scheduleRefresh(delayMs = 120) {
    if (refreshTimer) window.clearTimeout(refreshTimer)
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null
      void refreshAll()
    }, Math.max(0, Math.floor(delayMs)))
  }

  function toggleCollapsed() {
    state.collapsed = !state.collapsed
    if (state.collapsed) {
      state.showOtherPlans = false
      render()
      scheduleReserveUpdate()
    } else {
      void refreshAll()
    }
  }

  async function openPlan(planId: number) {
    if (!planId || state.busy) return
    state.busy = true
    state.error = null
    render()
    scheduleReserveUpdate()
    try {
      state.showOtherPlans = false
      const detailRaw = await invoke("plan.get", { id: planId } as unknown as JsonValue)
      const detail = parsePlanDetail(detailRaw)
      if (!detail) throw new Error("Plan detail is unavailable")
      state.viewedPlanId = planId
      state.activePlanDetail = detail
    } catch (error) {
      state.error = error instanceof Error ? error.message : String(error)
    } finally {
      state.busy = false
      render()
      scheduleReserveUpdate()
    }
  }

  function renderCollapsedButton(): string {
    return `
      <div class="pointer-events-auto p-1">
        <button
          type="button"
          data-pp-action="toggle"
          class="h-9 w-9 rounded-full shadow-md border border-border/50 bg-background/80 backdrop-blur hover:bg-background transition-all inline-flex items-center justify-center"
          aria-label="Show plan"
          title="Show plan"
          ${state.busy ? "disabled" : ""}
        >
          ${iconSvg("list", "h-5 w-5 text-muted-foreground")}
        </button>
      </div>
    `
  }

  function renderPlanList(): string {
    if (state.sessionPlans.length === 0) {
      return `<div class="px-2 py-2 text-center text-xs text-muted-foreground">No plans in this session.</div>`
    }

    const activeId = activePlanId()
    const runtimeActiveId = activeRuntimePlanId()
    const rows = state.sessionPlans
      .map((plan) => {
        const isActive = plan.id === activeId
        const isRuntimeActive = plan.id === runtimeActiveId
        const title = summarizePlanContent(plan.content) || `#${plan.id} ${plan.title}`
        const badge = isRuntimeActive
          ? '<span class="shrink-0 text-[10px] px-1 rounded bg-emerald-500/15 text-emerald-700">Active</span>'
          : ""
        const statusIcon =
          plan.status === "done"
            ? iconSvg("check", "h-4 w-4 shrink-0 text-emerald-700/70")
            : iconSvg("stack", "h-4 w-4 shrink-0 text-muted-foreground/70")

        return `
          <button
            type="button"
            data-pp-plan-open="${plan.id}"
            class="w-full h-8 text-left flex items-center gap-2 rounded-md border border-transparent px-2 transition-colors ${
              isActive ? "bg-primary/5 border-primary/15" : "hover:bg-muted/30"
            }"
            ${state.busy ? "disabled" : ""}
            title="${htmlEscape(title)}"
          >
            <div class="min-w-0 flex-1 flex items-center gap-1.5">
              <span class="min-w-0 text-xs font-medium truncate">#${plan.id} ${htmlEscape(plan.title)}</span>
              ${badge}
            </div>
            ${statusIcon}
          </button>
        `
      })
      .join("")

    return `<div class="overflow-y-auto overscroll-contain flex-1 min-h-0" style="max-height: 170px"><div class="flex flex-col gap-[2px]">${rows}</div></div>`
  }

  function renderSteps(detail: PlanDetail): string {
    const steps = orderedSteps(detail)
    if (!steps.length) {
      return `<div class="py-2 text-center text-xs text-muted-foreground italic leading-relaxed">This plan has no steps yet.</div>`
    }

    const runtimeNextStepId =
      state.runtime?.activePlan?.plan_id === detail.plan.id ? state.runtime?.nextStep?.step.id ?? 0 : 0
    const derivedNextStepId = runtimeNextStepId
      ? 0
      : steps
          .filter((step) => step.status !== "done")
          .sort((a, b) => {
            if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
            return a.id - b.id
          })[0]?.id ?? 0
    const nextStepId = runtimeNextStepId || derivedNextStepId
    const nextWaitLabel = runtimeNextStepId ? formattedWait(state.runtime?.nextStep ?? null) : ""

    const items = steps
      .map((step) => {
        const goals = goalsForStepId(detail, step.id)
        const isNext = step.id === nextStepId
        const rowClass = isNext
          ? "bg-primary/5 border-primary/15"
          : step.status === "done"
            ? "bg-muted/20 border-border/30 hover:bg-muted/25"
            : "hover:bg-muted/30"

        const waitIcon =
          isNext && nextWaitLabel
            ? `<span title="Waiting: ${htmlEscape(nextWaitLabel)}" aria-label="Waiting">${iconSvg(
                "clock",
                "h-4 w-4 text-amber-600/70",
              )}</span>`
            : ""
        const doneIcon =
          step.status === "done" ? iconSvg("check", "h-4 w-4 text-emerald-700/70") : ""
        const arrow = goals.length
          ? `<span class="${isGoalsExpanded(step.id) ? "" : "-rotate-90"} transition-transform">${iconSvg(
              "chev",
              "h-4 w-4 text-muted-foreground/60",
            )}</span>`
          : ""

        const goalsBlock =
          goals.length && isGoalsExpanded(step.id)
            ? `
              <div class="pb-1 pl-7 pr-1.5">
                <div class="space-y-0.5">
                  ${goals
                    .map((goal) => {
                      const line = goal.status === "done" ? "bg-emerald-600/40" : "bg-muted-foreground/35"
                      const goalDone =
                        goal.status === "done" ? iconSvg("check", "mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700/70") : ""
                      return `
                        <div class="flex items-start gap-2">
                          <span class="mt-2 h-px w-2 shrink-0 ${line}" aria-hidden="true"></span>
                          <span class="min-w-0 flex-1 text-[11px] text-muted-foreground leading-snug break-words whitespace-pre-wrap ${
                            goal.status === "done" ? "opacity-75" : ""
                          }">${htmlEscape(goal.content)}</span>
                          ${goalDone}
                        </div>
                      `
                    })
                    .join("")}
                </div>
              </div>
            `
            : ""

        const clickableAttrs = goals.length
          ? `data-pp-step-toggle="${step.id}" role="button" tabindex="0" aria-expanded="${isGoalsExpanded(step.id)}"`
          : ""

        return `
          <li class="rounded-md border border-transparent transition-colors ${rowClass}">
            <div
              class="flex items-center gap-2 h-9 px-1.5 ${goals.length ? "cursor-pointer" : ""}"
              ${clickableAttrs}
              title="${htmlEscape(step.content)}"
            >
              <div class="min-w-0 flex-1">
                <div class="text-[13px] leading-[1.1] truncate ${step.status === "done" ? "text-muted-foreground opacity-75" : "text-foreground"}">
                  ${htmlEscape(step.content)}
                </div>
              </div>
              <div class="flex items-center gap-1 shrink-0">
                ${waitIcon}
                ${doneIcon}
                ${arrow}
              </div>
            </div>
            ${goalsBlock}
          </li>
        `
      })
      .join("")

    return `<div data-pp-scroll="steps" class="overflow-y-auto overscroll-contain flex-1 min-h-0" style="max-height: 200px"><ol class="flex flex-col gap-[2px]">${items}</ol></div>`
  }

  function renderExpandedPanel(): string {
    const detail = state.activePlanDetail
    const content = planContent()
    const paused = state.runtime?.paused === true

    const main =
      detail === null
        ? `<div class="py-2 text-center text-xs text-muted-foreground italic leading-relaxed">${htmlEscape(
            fallbackStatusMessage(),
          )}</div>`
        : state.showOtherPlans
          ? `
              <div class="flex flex-col gap-1 min-h-0">
                ${renderPlanList()}
              </div>
            `
          : `
              <div class="flex flex-col gap-1.5 min-h-0">
                ${
                  content
                    ? `<div class="text-[10px] text-muted-foreground leading-snug whitespace-pre-wrap break-words max-h-12 overflow-hidden" title="${htmlEscape(
                        content,
                      )}">${htmlEscape(content)}</div>`
                    : ""
                }
                ${paused ? `<div class="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground"><span class="inline-flex items-center rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Paused</span></div>` : ""}
                ${renderSteps(detail)}
              </div>
            `

    const errorBlock = state.error
      ? `<div class="rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive flex items-start gap-2"><span class="font-bold">Error:</span> ${htmlEscape(
          state.error,
        )}</div>`
      : ""

    const header = `
      <div class="flex items-center border-b border-border/30 bg-muted/20 gap-2 px-2 py-1">
        <div class="flex items-center gap-1.5 min-w-0 flex-1">
          <span class="truncate text-[11px] font-semibold text-foreground/90 select-none cursor-default" title="${htmlEscape(
            headerLabel(),
          )}">${htmlEscape(headerLabel())}</span>
          ${detail && detail.plan.status === "done" ? iconSvg("check", "h-3.5 w-3.5 shrink-0 text-emerald-700/70") : ""}
          ${state.loading ? '<span class="animate-pulse text-[10px] text-muted-foreground">Updating...</span>' : ""}
        </div>
        <div class="flex items-center gap-0.5">
          <button
            type="button"
            data-pp-action="refresh"
            class="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted/40"
            title="Refresh"
            aria-label="Refresh"
            ${state.busy ? "disabled" : ""}
          >
            ${iconSvg("refresh", "h-3.5 w-3.5 text-muted-foreground/70")}
          </button>
          <button
            type="button"
            data-pp-action="toggleList"
            class="h-7 w-7 inline-flex items-center justify-center rounded ${state.showOtherPlans ? "bg-muted/40" : "hover:bg-muted/40"}"
            title="Plan List"
            aria-label="Plan List"
            aria-pressed="${state.showOtherPlans}"
          >
            ${iconSvg("list", "h-3.5 w-3.5")}
          </button>
          <div class="mx-1 h-3 w-px bg-border/50"></div>
          <button
            type="button"
            data-pp-action="toggle"
            class="h-7 w-7 inline-flex items-center justify-center rounded hover:bg-muted/40"
            title="Collapse"
            aria-label="Collapse"
          >
            ${iconSvg("hide", "h-3.5 w-3.5 text-muted-foreground/70")}
          </button>
        </div>
      </div>
    `

    return `
      <section class="pointer-events-auto w-full rounded-lg border border-border/60 bg-background/95 shadow-xl backdrop-blur-md overflow-hidden transition-all duration-300 ease-in-out flex flex-col max-h-[50vh]">
        ${header}
        <div class="overflow-hidden flex-1 min-h-0 flex flex-col p-1.5 gap-1.5">
          ${main}
          ${errorBlock}
        </div>
      </section>
    `
  }

  function render() {
    if (!isVisible()) {
      el.innerHTML = ""
      setReservePx(0)
      return
    }

    const body = state.collapsed ? renderCollapsedButton() : renderExpandedPanel()
    el.innerHTML = `<div class="pointer-events-none w-full flex justify-end">${body}</div>`
  }

  function handleClick(event: MouseEvent) {
    const target = event.target as Element | null
    if (!target) return

    const actionEl = target.closest<HTMLElement>("[data-pp-action]")
    if (actionEl) {
      const action = String(actionEl.dataset.ppAction || "").trim()
      if (action === "toggle") {
        toggleCollapsed()
        return
      }
      if (action === "toggleList") {
        state.showOtherPlans = !state.showOtherPlans
        render()
        scheduleReserveUpdate()
        return
      }
      if (action === "refresh") {
        scheduleRefresh(0)
        return
      }
      return
    }

    const planEl = target.closest<HTMLElement>("[data-pp-plan-open]")
    if (planEl) {
      const id = Number(planEl.dataset.ppPlanOpen)
      if (Number.isFinite(id) && id > 0) {
        void openPlan(Math.trunc(id))
      }
      return
    }

    const stepEl = target.closest<HTMLElement>("[data-pp-step-toggle]")
    if (stepEl) {
      const id = Number(stepEl.dataset.ppStepToggle)
      if (Number.isFinite(id) && id > 0) {
        toggleGoalsExpanded(Math.trunc(id))
      }
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    const target = event.target as Element | null
    if (!target) return
    if (event.key !== "Enter" && event.key !== " ") return
    const stepEl = target.closest<HTMLElement>("[data-pp-step-toggle]")
    if (!stepEl) return
    event.preventDefault()
    const id = Number(stepEl.dataset.ppStepToggle)
    if (Number.isFinite(id) && id > 0) {
      toggleGoalsExpanded(Math.trunc(id))
    }
  }

  function startEvents() {
    stopEvents?.()
    stopEvents = opts.host.subscribeEvents({
      onEvent: () => scheduleRefresh(90),
      onError: () => {
        // Keep UI stable; host SSE will reconnect.
      },
    })
  }

  // Mount lifecycle.
  el.addEventListener("click", handleClick)
  el.addEventListener("keydown", handleKeydown)

  if (typeof ResizeObserver !== "undefined" && opts.layout) {
    reserveObserver = new ResizeObserver(() => scheduleReserveUpdate())
    reserveObserver.observe(el)
  }

  render()
  scheduleReserveUpdate()
  startEvents()
  void refreshAll()

  return {
    unmount() {
      stopEvents?.()
      stopEvents = null
      if (refreshTimer) {
        window.clearTimeout(refreshTimer)
        refreshTimer = null
      }
      reserveObserver?.disconnect()
      reserveObserver = null
      if (reserveRaf) {
        window.cancelAnimationFrame(reserveRaf)
        reserveRaf = 0
      }
      el.removeEventListener("click", handleClick)
      el.removeEventListener("keydown", handleKeydown)
      el.innerHTML = ""
      setReservePx(0)
    },
  }
}
