/// <reference lib="dom" />

type PlanStatus = "todo" | "done"
type StepStatus = "todo" | "done"
type GoalStatus = "todo" | "done"

type PlanRow = {
  id: number
  title: string
  content: string
  status: PlanStatus
  comment: string | null
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

type ActivePlan = {
  plan_id: number
}

type StepDetail = {
  step: StepRow
  goals: GoalRow[]
  wait?: { until: number; reason?: string } | null
}

type RuntimeSnapshot = {
  paused: boolean
  activePlan: ActivePlan | null
  nextStep: StepDetail | null
}

type PlanDetail = {
  plan: PlanRow
  steps: StepRow[]
  goals: Array<{ stepId: number; goals: GoalRow[] }>
}

type ActionError = {
  code?: string
  message?: string
}

type ActionEnvelope<T> = {
  ok: boolean
  data?: T
  error?: ActionError
}

type AppState = {
  pluginId: string
  context: Record<string, string>
  plans: PlanRow[]
  runtime: RuntimeSnapshot | null
  selectedPlanId: number | null
  selectedPlan: PlanDetail | null
  loading: boolean
  busyAction: string | null
  message: string
  eventStatus: string
}

const FALLBACK_PLUGIN_ID = "opencode-planpilot"
const REFRESH_DEBOUNCE_MS = 200

type UiLocale = "en-US" | "zh-CN"

type UiStrings = {
  unknown: string
  waitingUntil: (time: string, reason: string) => string
  stepsDone: (done: number, total: number) => string
  runtimePaused: string
  runtimeActive: string
  none: string
  runtimeStatus: string
  state: string
  activePlan: string
  nextStep: string
  refresh: string
  resume: string
  pause: string
  deactivate: string
  events: string
  noPlansCreateOne: string
  activeBadge: string
  planDetail: string
  selectPlanHint: string
  noGoals: string
  done: string
  executor: string
  addGoalPlaceholder: string
  addGoal: string
  title: string
  status: string
  progress: string
  goals: string
  reactivate: string
  activate: string
  markPlanDone: string
  steps: string
  newStepContentPlaceholder: string
  optionalGoalsPlaceholder: string
  addStep: string
  noStepsYet: string
  createPlanTree: string
  planTitlePlaceholder: string
  planSummaryPlaceholder: string
  inlineStepsPlaceholder: string
  createTree: string
  loading: string
  sidebarTitle: string
  planList: string
  connecting: string
  live: string
  reconnecting: string
  eventError: string
  invalidActionResponse: (action: string) => string
  actionFailed: (action: string, detail: string) => string
  runtimePausedMessage: string
  runtimeResumedMessage: string
  planDeactivatedMessage: string
  planActivatedMessage: (id: number) => string
  planDoneMessage: (id: number) => string
  stepDoneMessage: (id: number) => string
  goalDoneMessage: (id: number) => string
  planTreeRequiredError: string
  planTreeCreatedMessage: string
  stepContentRequiredError: string
  stepAddedMessage: string
  goalContentRequiredError: string
  goalAddedMessage: string
}

const UI_STRINGS: Record<UiLocale, UiStrings> = {
  "en-US": {
    unknown: "unknown",
    waitingUntil: (time, reason) => `Waiting until ${time}${reason}`,
    stepsDone: (done, total) => `${done}/${total} steps done`,
    runtimePaused: "Paused",
    runtimeActive: "Active",
    none: "None",
    runtimeStatus: "Runtime status",
    state: "State",
    activePlan: "Active plan",
    nextStep: "Next step",
    refresh: "Refresh",
    resume: "Resume",
    pause: "Pause",
    deactivate: "Deactivate",
    events: "Events",
    noPlansCreateOne: "No plans yet. Create one below.",
    activeBadge: "active",
    planDetail: "Plan detail",
    selectPlanHint: "Select a plan to inspect details.",
    noGoals: "No goals",
    done: "Done",
    executor: "executor",
    addGoalPlaceholder: "Add goal",
    addGoal: "Add goal",
    title: "Title",
    status: "Status",
    progress: "Progress",
    goals: "Goals",
    reactivate: "Re-activate",
    activate: "Activate",
    markPlanDone: "Mark plan done",
    steps: "Steps",
    newStepContentPlaceholder: "New step content",
    optionalGoalsPlaceholder: "Optional goals, one per line",
    addStep: "Add step",
    noStepsYet: "No steps yet.",
    createPlanTree: "Create plan tree",
    planTitlePlaceholder: "Plan title",
    planSummaryPlaceholder: "Plan summary",
    inlineStepsPlaceholder: "One step per line. Use :: goal A | goal B for inline goals",
    createTree: "Create tree",
    loading: "Loading...",
    sidebarTitle: "Planpilot sidebar",
    planList: "Plan list",
    connecting: "connecting",
    live: "live",
    reconnecting: "reconnecting",
    eventError: "Plugin event error",
    invalidActionResponse: (action) => `Invalid action response for '${action}'`,
    actionFailed: (action, detail) => `Action '${action}' failed: ${detail}`,
    runtimePausedMessage: "Runtime paused",
    runtimeResumedMessage: "Runtime resumed",
    planDeactivatedMessage: "Plan deactivated",
    planActivatedMessage: (id) => `Plan ${id} activated`,
    planDoneMessage: (id) => `Plan ${id} marked done`,
    stepDoneMessage: (id) => `Step ${id} marked done`,
    goalDoneMessage: (id) => `Goal ${id} marked done`,
    planTreeRequiredError: "Plan title, content, and at least one step are required",
    planTreeCreatedMessage: "Plan tree created",
    stepContentRequiredError: "Step content is required",
    stepAddedMessage: "Step added",
    goalContentRequiredError: "Goal content is required",
    goalAddedMessage: "Goal added",
  },
  "zh-CN": {
    unknown: "未知",
    waitingUntil: (time, reason) => `等待至 ${time}${reason}`,
    stepsDone: (done, total) => `已完成步骤 ${done}/${total}`,
    runtimePaused: "已暂停",
    runtimeActive: "运行中",
    none: "无",
    runtimeStatus: "运行时状态",
    state: "状态",
    activePlan: "当前计划",
    nextStep: "下一步",
    refresh: "刷新",
    resume: "继续",
    pause: "暂停",
    deactivate: "取消激活",
    events: "事件",
    noPlansCreateOne: "还没有计划。请在下方创建。",
    activeBadge: "进行中",
    planDetail: "计划详情",
    selectPlanHint: "选择一个计划以查看详情。",
    noGoals: "无目标",
    done: "完成",
    executor: "执行者",
    addGoalPlaceholder: "添加目标",
    addGoal: "添加目标",
    title: "标题",
    status: "状态",
    progress: "进度",
    goals: "目标数",
    reactivate: "重新激活",
    activate: "激活",
    markPlanDone: "标记计划完成",
    steps: "步骤",
    newStepContentPlaceholder: "新步骤内容",
    optionalGoalsPlaceholder: "可选目标，每行一个",
    addStep: "添加步骤",
    noStepsYet: "暂无步骤。",
    createPlanTree: "创建计划树",
    planTitlePlaceholder: "计划标题",
    planSummaryPlaceholder: "计划摘要",
    inlineStepsPlaceholder: "每行一个步骤。使用 :: 目标A | 目标B 添加内联目标",
    createTree: "创建计划树",
    loading: "加载中...",
    sidebarTitle: "Planpilot 侧边栏",
    planList: "计划列表",
    connecting: "连接中",
    live: "已连接",
    reconnecting: "重连中",
    eventError: "插件事件错误",
    invalidActionResponse: (action) => `动作 '${action}' 的响应无效`,
    actionFailed: (action, detail) => `动作 '${action}' 失败: ${detail}`,
    runtimePausedMessage: "运行时已暂停",
    runtimeResumedMessage: "运行时已继续",
    planDeactivatedMessage: "计划已取消激活",
    planActivatedMessage: (id) => `计划 ${id} 已激活`,
    planDoneMessage: (id) => `计划 ${id} 已标记完成`,
    stepDoneMessage: (id) => `步骤 ${id} 已标记完成`,
    goalDoneMessage: (id) => `目标 ${id} 已标记完成`,
    planTreeRequiredError: "计划标题、内容以及至少一个步骤为必填项",
    planTreeCreatedMessage: "计划树已创建",
    stepContentRequiredError: "步骤内容为必填项",
    stepAddedMessage: "步骤已添加",
    goalContentRequiredError: "目标内容为必填项",
    goalAddedMessage: "目标已添加",
  },
}

function normalizeLocale(value: string | null | undefined): UiLocale {
  const normalized = String(value || "").trim().toLowerCase()
  if (normalized.startsWith("zh")) return "zh-CN"
  return "en-US"
}

function detectLocale(): UiLocale {
  const params = new URLSearchParams(window.location.search)
  return normalizeLocale(params.get("locale") || params.get("lang"))
}

const locale = detectLocale()
const t = UI_STRINGS[locale]

const state: AppState = {
  pluginId: detectPluginId(),
  context: detectContext(),
  plans: [],
  runtime: null,
  selectedPlanId: null,
  selectedPlan: null,
  loading: true,
  busyAction: null,
  message: "",
  eventStatus: t.connecting,
}

let refreshTimer = 0

function detectPluginId(): string {
  const fromSearch = new URLSearchParams(window.location.search).get("pluginId")
  if (fromSearch && fromSearch.trim()) return fromSearch.trim()

  const match = window.location.pathname.match(/\/api\/plugins\/([^/]+)\/assets\//)
  if (match && match[1]) {
    try {
      return decodeURIComponent(match[1])
    } catch {
      return match[1]
    }
  }
  return FALLBACK_PLUGIN_ID
}

function detectContext(): Record<string, string> {
  const params = new URLSearchParams(window.location.search)
  const context: Record<string, string> = {}
  const sessionId = params.get("sessionId") || params.get("sessionID")
  const cwd = params.get("cwd") || params.get("directory")
  if (sessionId && sessionId.trim()) context.sessionId = sessionId.trim()
  if (cwd && cwd.trim()) context.cwd = cwd.trim()
  return context
}

function goalsForStep(detail: PlanDetail, stepId: number): GoalRow[] {
  const found = detail.goals.find((entry) => entry.stepId === stepId)
  return found ? found.goals : []
}

function statusTag(status: PlanStatus | StepStatus | GoalStatus): string {
  return status === "done" ? "done" : "todo"
}

function statusLabel(status: PlanStatus | StepStatus | GoalStatus): string {
  if (status === "done") return t.done
  return locale === "zh-CN" ? "待办" : "todo"
}

function activePlanId(): number | null {
  return state.runtime?.activePlan?.plan_id ?? null
}

function planById(id: number | null): PlanRow | undefined {
  if (id === null) return undefined
  return state.plans.find((plan) => plan.id === id)
}

function formatWait(wait: StepDetail["wait"]): string {
  if (!wait || typeof wait.until !== "number") return ""
  const date = new Date(wait.until)
  const time = Number.isNaN(date.getTime()) ? t.unknown : date.toLocaleString(locale)
  const reason = wait.reason ? ` - ${escapeHtml(wait.reason)}` : ""
  return t.waitingUntil(escapeHtml(time), reason)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function selectedPlanGoalCount(detail: PlanDetail): number {
  return detail.goals.reduce((count, entry) => count + entry.goals.length, 0)
}

function planProgressLabel(detail: PlanDetail): string {
  const doneSteps = detail.steps.filter((step) => step.status === "done").length
  return t.stepsDone(doneSteps, detail.steps.length)
}

function parseTreeSteps(input: string): Array<{ content: string; executor: "ai" | "human"; goals: string[] }> {
  const lines = input
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  const steps: Array<{ content: string; executor: "ai" | "human"; goals: string[] }> = []
  for (const line of lines) {
    const parts = line.split("::")
    const content = parts[0]?.trim() ?? ""
    if (!content) continue
    const rawGoals = (parts[1] ?? "")
      .split("|")
      .map((goal) => goal.trim())
      .filter((goal) => goal.length > 0)
    steps.push({ content, executor: "ai", goals: rawGoals })
  }
  return steps
}

async function invokeAction<T>(action: string, payload: unknown = null): Promise<T> {
  const response = await fetch(`/api/plugins/${encodeURIComponent(state.pluginId)}/action`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      action,
      payload,
      context: state.context,
    }),
  })

  let envelope: ActionEnvelope<T>
  try {
    envelope = (await response.json()) as ActionEnvelope<T>
  } catch {
    throw new Error(t.invalidActionResponse(action))
  }

  if (!response.ok || !envelope.ok) {
    const detail = envelope.error?.message || envelope.error?.code || `HTTP ${response.status}`
    throw new Error(t.actionFailed(action, detail))
  }

  return envelope.data as T
}

async function loadBaseState(): Promise<void> {
  const [runtime, plans] = await Promise.all([
    invokeAction<RuntimeSnapshot>("runtime.snapshot"),
    invokeAction<PlanRow[]>("plan.list"),
  ])
  state.runtime = runtime
  state.plans = plans

  const activeId = runtime.activePlan?.plan_id ?? null
  if (state.selectedPlanId === null) {
    state.selectedPlanId = activeId ?? (plans[0]?.id ?? null)
  } else if (!plans.some((plan) => plan.id === state.selectedPlanId)) {
    state.selectedPlanId = activeId ?? (plans[0]?.id ?? null)
  }
}

async function loadSelectedPlan(): Promise<void> {
  if (state.selectedPlanId === null) {
    state.selectedPlan = null
    return
  }
  state.selectedPlan = await invokeAction<PlanDetail>("plan.get", { id: state.selectedPlanId })
}

async function refreshAll(): Promise<void> {
  state.loading = true
  render()
  try {
    await loadBaseState()
    await loadSelectedPlan()
    state.message = ""
  } catch (error) {
    state.message = error instanceof Error ? error.message : String(error)
  } finally {
    state.loading = false
    render()
  }
}

function scheduleRefresh(): void {
  if (refreshTimer) window.clearTimeout(refreshTimer)
  refreshTimer = window.setTimeout(() => {
    refreshTimer = 0
    void refreshAll()
  }, REFRESH_DEBOUNCE_MS)
}

async function runAction(action: string, payload: unknown, successMessage: string): Promise<void> {
  state.busyAction = action
  state.message = ""
  render()
  try {
    await invokeAction<unknown>(action, payload)
    state.message = successMessage
    await refreshAll()
  } catch (error) {
    state.message = error instanceof Error ? error.message : String(error)
    render()
  } finally {
    state.busyAction = null
    render()
  }
}

function bindUiHandlers(root: HTMLElement): void {
  root.querySelectorAll<HTMLButtonElement>("[data-plan-select]").forEach((button) => {
    button.addEventListener("click", () => {
      const planId = Number(button.dataset.planSelect)
      if (!Number.isFinite(planId)) return
      state.selectedPlanId = planId
      void loadSelectedPlan().then(render).catch((error) => {
        state.message = error instanceof Error ? error.message : String(error)
        render()
      })
    })
  })

  const refreshBtn = root.querySelector<HTMLButtonElement>("[data-action='refresh']")
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      void refreshAll()
    })
  }

  const pauseBtn = root.querySelector<HTMLButtonElement>("[data-action='pause']")
  if (pauseBtn) {
    pauseBtn.addEventListener("click", () => {
      void runAction("runtime.pause", null, t.runtimePausedMessage)
    })
  }

  const resumeBtn = root.querySelector<HTMLButtonElement>("[data-action='resume']")
  if (resumeBtn) {
    resumeBtn.addEventListener("click", () => {
      void runAction("runtime.resume", null, t.runtimeResumedMessage)
    })
  }

  const deactivateBtn = root.querySelector<HTMLButtonElement>("[data-action='deactivate']")
  if (deactivateBtn) {
    deactivateBtn.addEventListener("click", () => {
      void runAction("plan.deactivate", null, t.planDeactivatedMessage)
    })
  }

  root.querySelectorAll<HTMLButtonElement>("[data-plan-activate]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.planActivate)
      if (!Number.isFinite(id)) return
      void runAction("plan.activate", { id, force: true }, t.planActivatedMessage(id))
    })
  })

  root.querySelectorAll<HTMLButtonElement>("[data-plan-done]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.planDone)
      if (!Number.isFinite(id)) return
      void runAction("plan.done", { id }, t.planDoneMessage(id))
    })
  })

  root.querySelectorAll<HTMLButtonElement>("[data-step-done]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.stepDone)
      if (!Number.isFinite(id)) return
      void runAction("step.done", { id }, t.stepDoneMessage(id))
    })
  })

  root.querySelectorAll<HTMLButtonElement>("[data-goal-done]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = Number(button.dataset.goalDone)
      if (!Number.isFinite(id)) return
      void runAction("goal.done", { id }, t.goalDoneMessage(id))
    })
  })

  const createForm = root.querySelector<HTMLFormElement>("[data-form='create-plan-tree']")
  if (createForm) {
    createForm.addEventListener("submit", (event) => {
      event.preventDefault()
      const titleInput = createForm.querySelector<HTMLInputElement>("[name='title']")
      const contentInput = createForm.querySelector<HTMLTextAreaElement>("[name='content']")
      const stepsInput = createForm.querySelector<HTMLTextAreaElement>("[name='steps']")
      const title = titleInput?.value.trim() ?? ""
      const content = contentInput?.value.trim() ?? ""
      const stepsText = stepsInput?.value ?? ""
      const steps = parseTreeSteps(stepsText)
      if (!title || !content || steps.length === 0) {
        state.message = t.planTreeRequiredError
        render()
        return
      }

      void runAction(
        "plan.createTree",
        { title, content, steps },
        t.planTreeCreatedMessage,
      ).then(() => {
        createForm.reset()
      })
    })
  }

  const addStepForm = root.querySelector<HTMLFormElement>("[data-form='add-step']")
  if (addStepForm) {
    addStepForm.addEventListener("submit", (event) => {
      event.preventDefault()
      const planId = Number(addStepForm.dataset.planId)
      const contentInput = addStepForm.querySelector<HTMLInputElement>("[name='content']")
      const goalsInput = addStepForm.querySelector<HTMLTextAreaElement>("[name='goals']")
      const content = contentInput?.value.trim() ?? ""
      const goals = (goalsInput?.value ?? "")
        .split("\n")
        .map((goal) => goal.trim())
        .filter((goal) => goal.length > 0)
      if (!Number.isFinite(planId) || !content) {
        state.message = t.stepContentRequiredError
        render()
        return
      }
      void runAction("step.addTree", { planId, content, executor: "ai", goals }, t.stepAddedMessage).then(() => {
        addStepForm.reset()
      })
    })
  }

  root.querySelectorAll<HTMLFormElement>("[data-form='add-goal']").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault()
      const stepId = Number(form.dataset.stepId)
      const contentInput = form.querySelector<HTMLInputElement>("[name='goalContent']")
      const content = contentInput?.value.trim() ?? ""
      if (!Number.isFinite(stepId) || !content) {
        state.message = t.goalContentRequiredError
        render()
        return
      }
      void runAction("goal.add", { stepId, content }, t.goalAddedMessage).then(() => {
        form.reset()
      })
    })
  })
}

function renderRuntimeCard(): string {
  const runtime = state.runtime
  const isPaused = runtime?.paused ? t.runtimePaused : t.runtimeActive
  const activeId = runtime?.activePlan?.plan_id ?? null
  const activePlan = planById(activeId)
  const nextStep = runtime?.nextStep?.step
  const waitText = runtime?.nextStep ? formatWait(runtime.nextStep.wait ?? null) : ""
  const actionBusy = state.busyAction !== null

  return `
    <section class="card">
      <h2>${t.runtimeStatus}</h2>
      <div class="runtime-line"><span class="label">${t.state}</span><strong>${escapeHtml(isPaused)}</strong></div>
      <div class="runtime-line"><span class="label">${t.activePlan}</span><span>${activePlan ? `#${activePlan.id} ${escapeHtml(activePlan.title)}` : t.none}</span></div>
      <div class="runtime-line"><span class="label">${t.nextStep}</span><span>${nextStep ? `#${nextStep.id} ${escapeHtml(nextStep.content)}` : t.none}</span></div>
      ${waitText ? `<div class="note">${waitText}</div>` : ""}
      <div class="row-actions">
        <button data-action="refresh" ${actionBusy ? "disabled" : ""}>${t.refresh}</button>
        ${runtime?.paused ? `<button data-action="resume" ${actionBusy ? "disabled" : ""}>${t.resume}</button>` : `<button data-action="pause" ${actionBusy ? "disabled" : ""}>${t.pause}</button>`}
        <button data-action="deactivate" ${actionBusy ? "disabled" : ""}>${t.deactivate}</button>
      </div>
      <div class="small">${t.events}: ${escapeHtml(state.eventStatus)}</div>
    </section>
  `
}

function renderPlanList(): string {
  if (state.plans.length === 0) {
    return `<div class="empty">${t.noPlansCreateOne}</div>`
  }
  return state.plans
    .map((plan) => {
      const isSelected = state.selectedPlanId === plan.id
      const isActive = activePlanId() === plan.id
      return `
        <button class="plan-item ${isSelected ? "selected" : ""}" data-plan-select="${plan.id}">
          <span class="plan-title">#${plan.id} ${escapeHtml(plan.title)}</span>
          <span class="plan-meta">
            <span class="pill ${statusTag(plan.status)}">${statusLabel(plan.status)}</span>
            ${isActive ? `<span class="pill active">${t.activeBadge}</span>` : ""}
          </span>
        </button>
      `
    })
    .join("")
}

function renderPlanDetail(): string {
  const detail = state.selectedPlan
  if (!detail) {
    return `<section class="card"><h2>${t.planDetail}</h2><div class="empty">${t.selectPlanHint}</div></section>`
  }

  const stepRows = detail.steps
    .map((step) => {
      const goals = goalsForStep(detail, step.id)
      const goalItems = goals.length
        ? goals
            .map(
              (goal) => `
                <li>
                  <span class="goal-text">#${goal.id} ${escapeHtml(goal.content)}</span>
                  <span class="pill ${statusTag(goal.status)}">${statusLabel(goal.status)}</span>
                  ${goal.status === "todo" ? `<button data-goal-done="${goal.id}" ${state.busyAction ? "disabled" : ""}>${t.done}</button>` : ""}
                </li>
              `,
            )
            .join("")
        : `<li class="empty">${t.noGoals}</li>`

      return `
        <article class="step-card">
          <div class="step-head">
            <div>
              <strong>#${step.id}</strong> ${escapeHtml(step.content)}
              <div class="small">${t.executor}: ${escapeHtml(step.executor)}</div>
            </div>
            <div class="row-actions">
              <span class="pill ${statusTag(step.status)}">${statusLabel(step.status)}</span>
              ${step.status === "todo" ? `<button data-step-done="${step.id}" ${state.busyAction ? "disabled" : ""}>${t.done}</button>` : ""}
            </div>
          </div>
          <ul class="goal-list">${goalItems}</ul>
          <form class="inline-form" data-form="add-goal" data-step-id="${step.id}">
            <input name="goalContent" type="text" placeholder="${t.addGoalPlaceholder}" />
            <button type="submit" ${state.busyAction ? "disabled" : ""}>${t.addGoal}</button>
          </form>
        </article>
      `
    })
    .join("")

  const isActive = activePlanId() === detail.plan.id
  return `
    <section class="card">
      <h2>${t.planDetail}</h2>
      <div class="runtime-line"><span class="label">${t.title}</span><strong>${escapeHtml(detail.plan.title)}</strong></div>
      <div class="runtime-line"><span class="label">${t.status}</span><span class="pill ${statusTag(detail.plan.status)}">${statusLabel(detail.plan.status)}</span></div>
      <div class="runtime-line"><span class="label">${t.progress}</span><span>${escapeHtml(planProgressLabel(detail))}</span></div>
      <div class="runtime-line"><span class="label">${t.goals}</span><span>${selectedPlanGoalCount(detail)}</span></div>
      <p class="content">${escapeHtml(detail.plan.content)}</p>
      <div class="row-actions">
        <button data-plan-activate="${detail.plan.id}" ${state.busyAction ? "disabled" : ""}>${isActive ? t.reactivate : t.activate}</button>
        <button data-plan-done="${detail.plan.id}" ${state.busyAction ? "disabled" : ""}>${t.markPlanDone}</button>
      </div>
    </section>
    <section class="card">
      <h2>${t.steps}</h2>
      <form class="stack-form" data-form="add-step" data-plan-id="${detail.plan.id}">
        <input name="content" type="text" placeholder="${t.newStepContentPlaceholder}" />
        <textarea name="goals" rows="3" placeholder="${t.optionalGoalsPlaceholder}"></textarea>
        <button type="submit" ${state.busyAction ? "disabled" : ""}>${t.addStep}</button>
      </form>
      ${stepRows || `<div class="empty">${t.noStepsYet}</div>`}
    </section>
  `
}

function renderCreateForm(): string {
  return `
    <section class="card">
      <h2>${t.createPlanTree}</h2>
      <form class="stack-form" data-form="create-plan-tree">
        <input name="title" type="text" placeholder="${t.planTitlePlaceholder}" />
        <textarea name="content" rows="3" placeholder="${t.planSummaryPlaceholder}"></textarea>
        <textarea name="steps" rows="4" placeholder="${t.inlineStepsPlaceholder}"></textarea>
        <button type="submit" ${state.busyAction ? "disabled" : ""}>${t.createTree}</button>
      </form>
    </section>
  `
}

function renderStyles(): string {
  return `
    <style>
      :root {
        color-scheme: light;
        --bg: #f4f6ef;
        --card: #ffffff;
        --ink: #1f2a2a;
        --muted: #5c6767;
        --line: #d5d9d3;
        --ok: #1f7a52;
        --todo: #b55f2d;
        --active: #125ea9;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--ink);
        background: radial-gradient(circle at top left, #fafcf5, var(--bg));
      }
      #app {
        padding: 10px;
        display: grid;
        gap: 10px;
      }
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 12px;
        padding: 10px;
      }
      h1, h2 {
        margin: 0 0 8px;
        font-size: 14px;
      }
      .small {
        color: var(--muted);
        font-size: 11px;
      }
      .note {
        margin: 6px 0;
        color: var(--muted);
        font-size: 12px;
      }
      .runtime-line {
        display: flex;
        gap: 8px;
        justify-content: space-between;
        margin-bottom: 6px;
        font-size: 12px;
      }
      .label {
        color: var(--muted);
      }
      .row-actions {
        display: flex;
        gap: 6px;
        flex-wrap: wrap;
      }
      button {
        border: 1px solid var(--line);
        border-radius: 8px;
        background: #f9faf7;
        color: var(--ink);
        padding: 5px 8px;
        font-size: 12px;
        cursor: pointer;
      }
      button:disabled {
        opacity: 0.6;
        cursor: default;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        border-radius: 999px;
        padding: 2px 7px;
        font-size: 11px;
        border: 1px solid var(--line);
      }
      .pill.done {
        color: var(--ok);
        border-color: color-mix(in srgb, var(--ok), white 65%);
      }
      .pill.todo {
        color: var(--todo);
        border-color: color-mix(in srgb, var(--todo), white 65%);
      }
      .pill.active {
        color: var(--active);
        border-color: color-mix(in srgb, var(--active), white 65%);
      }
      .plan-item {
        width: 100%;
        text-align: left;
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 6px;
      }
      .plan-item.selected {
        border-color: var(--active);
        background: #f1f7ff;
      }
      .plan-title {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 72%;
      }
      .plan-meta {
        display: inline-flex;
        gap: 4px;
      }
      .content {
        white-space: pre-wrap;
        font-size: 12px;
        margin: 6px 0 8px;
      }
      .stack-form,
      .inline-form {
        display: grid;
        gap: 6px;
      }
      .inline-form {
        grid-template-columns: 1fr auto;
      }
      input,
      textarea {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 8px;
        padding: 6px;
        font: inherit;
        font-size: 12px;
      }
      .step-card {
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 8px;
        margin-top: 8px;
      }
      .step-head {
        display: flex;
        justify-content: space-between;
        gap: 8px;
      }
      .goal-list {
        margin: 8px 0;
        padding-left: 16px;
        display: grid;
        gap: 4px;
      }
      .goal-list li {
        display: grid;
        grid-template-columns: 1fr auto auto;
        gap: 6px;
        align-items: center;
      }
      .goal-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .empty {
        color: var(--muted);
        font-size: 12px;
      }
      .message {
        font-size: 12px;
        color: #8a2f19;
      }
      @media (min-width: 900px) {
        #app {
          grid-template-columns: 300px 1fr;
          align-items: start;
        }
      }
    </style>
  `
}

function render(): void {
  const root = document.getElementById("app")
  if (!root) return

  const loadingText = state.loading ? `<div class="small">${t.loading}</div>` : ""
  const messageText = state.message ? `<div class="message">${escapeHtml(state.message)}</div>` : ""

  root.innerHTML = `
    ${renderStyles()}
    <section>
      <div class="card">
        <h1>${t.sidebarTitle}</h1>
        ${loadingText}
        ${messageText}
      </div>
      ${renderRuntimeCard()}
      <section class="card">
        <h2>${t.planList}</h2>
        ${renderPlanList()}
      </section>
      ${renderCreateForm()}
    </section>
    <section>
      ${renderPlanDetail()}
    </section>
  `

  bindUiHandlers(root)
}

function subscribeEvents(): () => void {
  const source = new EventSource(`/api/plugins/${encodeURIComponent(state.pluginId)}/events`)

  const onChange = () => {
    state.eventStatus = t.live
    scheduleRefresh()
    render()
  }

  source.onopen = () => {
    state.eventStatus = t.live
    render()
  }

  source.addEventListener("plugin.event", onChange)
  source.addEventListener("planpilot.runtime.changed", onChange)
  source.onmessage = onChange
  source.addEventListener("heartbeat", () => {
    state.eventStatus = t.live
    render()
  })

  source.addEventListener("plugin.error", (event) => {
    const data = event instanceof MessageEvent ? String(event.data || "") : t.eventError
    state.message = data.length > 300 ? `${data.slice(0, 300)}...` : data
    state.eventStatus = t.eventError
    render()
  })

  source.onerror = () => {
    state.eventStatus = t.reconnecting
    render()
  }

  return () => {
    source.close()
  }
}

void (async () => {
  render()
  await refreshAll()
  const stop = subscribeEvents()
  window.addEventListener("beforeunload", () => {
    stop()
  })
})()
