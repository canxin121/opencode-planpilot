import type { DatabaseConnection } from "./db"
import {
  createEmptyStatusChanges,
  mergeStatusChanges,
  type ActivePlanRow,
  type GoalChanges,
  type GoalDetail,
  type GoalQuery,
  type GoalRow,
  type GoalStatus,
  type PlanChanges,
  type PlanDetail,
  type PlanOrder,
  type PlanRow,
  type PlanStatus,
  type StatusChanges,
  type StepChanges,
  type StepDetail,
  type StepExecutor,
  type StepInput,
  type StepQuery,
  type StepRow,
  type StepStatus,
} from "./models"
import {
  ensureNonEmpty,
  joinIds,
  normalizeCommentEntries,
  parseWaitFromComment,
  removeWaitFromComment,
  uniqueIds,
  upsertWaitInComment,
} from "./util"
import { invalidInput, notFound } from "./errors"
import { formatStepDetail } from "./format"

export class PlanpilotApp {
  private db: DatabaseConnection
  private sessionId: string
  private cwd?: string

  constructor(db: DatabaseConnection, sessionId: string, cwd?: string) {
    this.db = db
    this.sessionId = sessionId
    this.cwd = cwd
  }

  addPlan(input: { title: string; content: string }): PlanRow {
    ensureNonEmpty("plan title", input.title)
    ensureNonEmpty("plan content", input.content)
    const now = Date.now()
    const result = this.db
      .prepare(
        `INSERT INTO plans (title, content, status, comment, last_session_id, last_cwd, created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`
      )
      .run(input.title, input.content, "todo", this.sessionId, this.cwd ?? null, now, now)
    const plan = this.getPlan(result.lastInsertRowid as number)
    return plan
  }

  addPlanTree(input: { title: string; content: string }, steps: StepInput[]): { plan: PlanRow; stepCount: number; goalCount: number } {
    ensureNonEmpty("plan title", input.title)
    ensureNonEmpty("plan content", input.content)
    steps.forEach((step) => {
      ensureNonEmpty("step content", step.content)
      step.goals.forEach((goal) => ensureNonEmpty("goal content", goal))
    })

    const tx = this.db.transaction(() => {
      const now = Date.now()
      const planResult = this.db
        .prepare(
          `INSERT INTO plans (title, content, status, comment, last_session_id, last_cwd, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`
        )
        .run(input.title, input.content, "todo", this.sessionId, this.cwd ?? null, now, now)
      const plan = this.getPlan(planResult.lastInsertRowid as number)

      let stepCount = 0
      let goalCount = 0
      steps.forEach((step, idx) => {
        const stepResult = this.db
          .prepare(
            `INSERT INTO steps (plan_id, content, status, executor, sort_order, comment, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
          )
          .run(plan.id, step.content, "todo", step.executor, idx + 1, now, now)
        const stepId = stepResult.lastInsertRowid as number
        stepCount += 1
        step.goals.forEach((goal) => {
          this.db
            .prepare(
              `INSERT INTO goals (step_id, content, status, comment, created_at, updated_at)
               VALUES (?, ?, ?, NULL, ?, ?)`
            )
            .run(stepId, goal, "todo", now, now)
          goalCount += 1
        })
      })

      return { plan, stepCount, goalCount }
    })

    return tx()
  }

  listPlans(order?: PlanOrder | null, desc?: boolean): PlanRow[] {
    const orderBy = order ?? "updated"
    const direction = desc ? "DESC" : "ASC"
    const orderColumn =
      orderBy === "id" ? "id" : orderBy === "title" ? "title" : orderBy === "created" ? "created_at" : "updated_at"

    return this.db
      .prepare(`SELECT * FROM plans ORDER BY ${orderColumn} ${direction}, id ASC`)
      .all() as PlanRow[]
  }

  getPlan(id: number): PlanRow {
    const row = this.db.prepare("SELECT * FROM plans WHERE id = ?").get(id) as PlanRow | undefined
    if (!row) throw notFound(`plan id ${id}`)
    return row
  }

  getStep(id: number): StepRow {
    const row = this.db.prepare("SELECT * FROM steps WHERE id = ?").get(id) as StepRow | undefined
    if (!row) throw notFound(`step id ${id}`)
    return row
  }

  getGoal(id: number): GoalRow {
    const row = this.db.prepare("SELECT * FROM goals WHERE id = ?").get(id) as GoalRow | undefined
    if (!row) throw notFound(`goal id ${id}`)
    return row
  }

  planWithSteps(id: number): { plan: PlanRow; steps: StepRow[] } {
    const plan = this.getPlan(id)
    const steps = this.db
      .prepare("SELECT * FROM steps WHERE plan_id = ? ORDER BY sort_order ASC, id ASC")
      .all(id) as StepRow[]
    return { plan, steps }
  }

  getPlanDetail(id: number): PlanDetail {
    const plan = this.getPlan(id)
    const steps = this.db
      .prepare("SELECT * FROM steps WHERE plan_id = ? ORDER BY sort_order ASC, id ASC")
      .all(id) as StepRow[]
    const stepIds = steps.map((step) => step.id)
    const goals = this.goalsForSteps(stepIds)
    const goalsMap = new Map<number, GoalRow[]>()
    for (const step of steps) {
      goalsMap.set(step.id, goals.get(step.id) ?? [])
    }
    return { plan, steps, goals: goalsMap }
  }

  getStepDetail(id: number): StepDetail {
    const step = this.getStep(id)
    const goals = this.goalsForStep(step.id)
    return { step, goals }
  }

  getGoalDetail(id: number): GoalDetail {
    const goal = this.getGoal(id)
    const step = this.getStep(goal.step_id)
    return { goal, step }
  }

  getPlanDetails(plans: PlanRow[]): PlanDetail[] {
    if (!plans.length) return []
    const planIds = plans.map((plan) => plan.id)
    const steps = this.db
      .prepare(`SELECT * FROM steps WHERE plan_id IN (${planIds.map(() => "?").join(",")}) ORDER BY plan_id ASC, sort_order ASC, id ASC`)
      .all(...planIds) as StepRow[]
    const stepIds = steps.map((step) => step.id)
    const goalsByStep = this.goalsForSteps(stepIds)

    const stepsByPlan = new Map<number, StepRow[]>()
    for (const step of steps) {
      const list = stepsByPlan.get(step.plan_id)
      if (list) list.push(step)
      else stepsByPlan.set(step.plan_id, [step])
    }

    return plans.map((plan) => {
      const planSteps = stepsByPlan.get(plan.id) ?? []
      const goalsMap = new Map<number, GoalRow[]>()
      for (const step of planSteps) {
        goalsMap.set(step.id, goalsByStep.get(step.id) ?? [])
      }
      return { plan, steps: planSteps, goals: goalsMap }
    })
  }

  getStepsDetail(steps: StepRow[]): StepDetail[] {
    if (!steps.length) return []
    const stepIds = steps.map((step) => step.id)
    const goalsMap = this.goalsForSteps(stepIds)
    return steps.map((step) => ({
      step,
      goals: goalsMap.get(step.id) ?? [],
    }))
  }

  getActivePlan(): ActivePlanRow | null {
    const row = this.db
      .prepare("SELECT * FROM active_plan WHERE session_id = ?")
      .get(this.sessionId) as ActivePlanRow | undefined
    return row ?? null
  }

  setActivePlan(planId: number, takeover: boolean): ActivePlanRow {
    this.getPlan(planId)
    const tx = this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT * FROM active_plan WHERE plan_id = ?")
        .get(planId) as ActivePlanRow | undefined
      if (existing && existing.session_id !== this.sessionId && !takeover) {
        throw invalidInput(
          `plan id ${planId} is already active in session ${existing.session_id} (use --force to take over)`
        )
      }

      this.db.prepare("DELETE FROM active_plan WHERE session_id = ?").run(this.sessionId)
      this.db.prepare("DELETE FROM active_plan WHERE plan_id = ?").run(planId)

      const now = Date.now()
      this.db
        .prepare("INSERT INTO active_plan (session_id, plan_id, updated_at) VALUES (?, ?, ?)")
        .run(this.sessionId, planId, now)

      this.touchPlan(planId)

      const created = this.db
        .prepare("SELECT * FROM active_plan WHERE session_id = ?")
        .get(this.sessionId) as ActivePlanRow | undefined
      if (!created) throw notFound("active plan not found after insert")
      return created
    })

    return tx()
  }

  clearActivePlan() {
    this.db.prepare("DELETE FROM active_plan WHERE session_id = ?").run(this.sessionId)
  }

  updatePlanWithActiveClear(id: number, changes: PlanChanges): { plan: PlanRow; cleared: boolean } {
    const tx = this.db.transaction(() => {
      const plan = this.updatePlanWithConn(id, changes)
      let cleared = false
      if (plan.status === "done") {
        cleared = this.clearActivePlansForPlanWithConn(plan.id)
      }
      return { plan, cleared }
    })

    return tx()
  }

  deletePlan(id: number) {
    const tx = this.db.transaction(() => {
      this.db.prepare("DELETE FROM active_plan WHERE plan_id = ?").run(id)
      const stepIds = this.db
        .prepare("SELECT id FROM steps WHERE plan_id = ?")
        .all(id)
        .map((row: any) => row.id as number)
      if (stepIds.length) {
        this.db
          .prepare(`DELETE FROM goals WHERE step_id IN (${stepIds.map(() => "?").join(",")})`)
          .run(...stepIds)
        this.db.prepare("DELETE FROM steps WHERE plan_id = ?").run(id)
      }
      const result = this.db.prepare("DELETE FROM plans WHERE id = ?").run(id)
      if (result.changes === 0) {
        throw notFound(`plan id ${id}`)
      }
    })

    tx()
  }

  addStepsBatch(
    planId: number,
    contents: string[],
    status: StepStatus,
    executor: StepExecutor,
    at?: number | null,
  ): { steps: StepRow[]; changes: StatusChanges } {
    if (!this.db.prepare("SELECT 1 FROM plans WHERE id = ?").get(planId)) {
      throw notFound(`plan id ${planId}`)
    }
    if (!contents.length) {
      return { steps: [], changes: createEmptyStatusChanges() }
    }
    contents.forEach((content) => ensureNonEmpty("step content", content))

    const tx = this.db.transaction(() => {
      const existing = this.db
        .prepare("SELECT * FROM steps WHERE plan_id = ? ORDER BY sort_order ASC, id ASC")
        .all(planId) as StepRow[]
      this.normalizeStepsInPlace(existing)

      const total = existing.length
      const insertPos = at !== undefined && at !== null ? (at > 0 ? Math.min(at, total + 1) : 1) : total + 1
      const now = Date.now()
      const shiftBy = contents.length
      if (shiftBy > 0) {
        for (let idx = existing.length - 1; idx >= 0; idx -= 1) {
          const step = existing[idx]
          if (step.sort_order >= insertPos) {
            const newOrder = step.sort_order + shiftBy
            this.db
              .prepare("UPDATE steps SET sort_order = ?, updated_at = ? WHERE id = ?")
              .run(newOrder, now, step.id)
            step.sort_order = newOrder
            step.updated_at = now
          }
        }
      }

      const created: StepRow[] = []
      contents.forEach((content, idx) => {
        const sortOrder = insertPos + idx
        const result = this.db
          .prepare(
            `INSERT INTO steps (plan_id, content, status, executor, sort_order, comment, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
          )
          .run(planId, content, status, executor, sortOrder, now, now)
        const step = this.getStep(result.lastInsertRowid as number)
        created.push(step)
      })

      const changes = this.refreshPlanStatus(planId)
      this.touchPlan(planId)
      return { steps: created, changes }
    })

    return tx()
  }

  addStepTree(planId: number, content: string, executor: StepExecutor, goals: string[]): { step: StepRow; goals: GoalRow[]; changes: StatusChanges } {
    ensureNonEmpty("step content", content)
    goals.forEach((goal) => ensureNonEmpty("goal content", goal))

    const tx = this.db.transaction(() => {
      if (!this.db.prepare("SELECT 1 FROM plans WHERE id = ?").get(planId)) {
        throw notFound(`plan id ${planId}`)
      }
      const existing = this.db
        .prepare("SELECT * FROM steps WHERE plan_id = ? ORDER BY sort_order ASC, id ASC")
        .all(planId) as StepRow[]
      this.normalizeStepsInPlace(existing)

      const sortOrder = existing.length + 1
      const now = Date.now()
      const stepResult = this.db
        .prepare(
          `INSERT INTO steps (plan_id, content, status, executor, sort_order, comment, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
        )
        .run(planId, content, "todo", executor, sortOrder, now, now)
      const step = this.getStep(stepResult.lastInsertRowid as number)

      const createdGoals: GoalRow[] = []
      for (const goalContent of goals) {
        const goalResult = this.db
          .prepare(
            `INSERT INTO goals (step_id, content, status, comment, created_at, updated_at)
             VALUES (?, ?, ?, NULL, ?, ?)`
          )
          .run(step.id, goalContent, "todo", now, now)
        createdGoals.push(this.getGoal(goalResult.lastInsertRowid as number))
      }

      const changes = this.refreshPlanStatus(planId)
      this.touchPlan(planId)
      return { step, goals: createdGoals, changes }
    })

    return tx()
  }

  listStepsFiltered(planId: number, query: StepQuery): StepRow[] {
    this.getPlan(planId)
    const conditions: string[] = ["plan_id = ?"]
    const params: any[] = [planId]
    if (query.status) {
      conditions.push("status = ?")
      params.push(query.status)
    }
    if (query.executor) {
      conditions.push("executor = ?")
      params.push(query.executor)
    }
    const order = query.order ?? "order"
    const direction = query.desc ? "DESC" : "ASC"
    const orderColumn =
      order === "id"
        ? "id"
        : order === "created"
          ? "created_at"
          : order === "updated"
            ? "updated_at"
            : "sort_order"

    let sql = `SELECT * FROM steps WHERE ${conditions.join(" AND ")} ORDER BY ${orderColumn} ${direction}, id ASC`
    if (query.limit !== undefined) {
      sql += " LIMIT ?"
      params.push(query.limit)
    }
    if (query.offset !== undefined) {
      sql += " OFFSET ?"
      params.push(query.offset)
    }
    return this.db.prepare(sql).all(...params) as StepRow[]
  }

  countSteps(planId: number, query: StepQuery): number {
    this.getPlan(planId)
    const conditions: string[] = ["plan_id = ?"]
    const params: any[] = [planId]
    if (query.status) {
      conditions.push("status = ?")
      params.push(query.status)
    }
    if (query.executor) {
      conditions.push("executor = ?")
      params.push(query.executor)
    }
    const row = this.db
      .prepare(`SELECT COUNT(*) as count FROM steps WHERE ${conditions.join(" AND ")}`)
      .get(...params) as { count: number }
    return row.count
  }

  nextStep(planId: number): StepRow | null {
    const row = this.db
      .prepare("SELECT * FROM steps WHERE plan_id = ? AND status = ? ORDER BY sort_order ASC, id ASC LIMIT 1")
      .get(planId, "todo") as StepRow | undefined
    return row ?? null
  }

  updateStep(id: number, changes: StepChanges): { step: StepRow; changes: StatusChanges } {
    const tx = this.db.transaction(() => {
      if (changes.content !== undefined) {
        ensureNonEmpty("step content", changes.content)
      }
      if (changes.status === "done") {
        const pending = this.nextGoalForStep(id)
        if (pending) {
          throw invalidInput(`cannot mark step done; next pending goal: ${pending.content} (id ${pending.id})`)
        }
      }
      const existing = this.getStep(id)
      const now = Date.now()

      const updated = {
        content: changes.content ?? existing.content,
        status: changes.status ?? existing.status,
        executor: changes.executor ?? existing.executor,
        comment: changes.comment !== undefined ? changes.comment : existing.comment,
      }
      this.db
        .prepare(
          `UPDATE steps SET content = ?, status = ?, executor = ?, comment = ?, updated_at = ? WHERE id = ?`
        )
        .run(updated.content, updated.status, updated.executor, updated.comment, now, id)

      const step = this.getStep(id)
      const statusChanges = createEmptyStatusChanges()
      if (changes.status !== undefined) {
        mergeStatusChanges(statusChanges, this.refreshPlanStatus(step.plan_id))
      }
      this.touchPlan(step.plan_id)
      return { step, changes: statusChanges }
    })

    return tx()
  }

  setStepDoneWithGoals(id: number, allGoals: boolean): { step: StepRow; changes: StatusChanges } {
    const tx = this.db.transaction(() => {
      let changes = createEmptyStatusChanges()
      if (allGoals) {
        const goalChanges = this.setAllGoalsDoneForStep(id)
        mergeStatusChanges(changes, goalChanges)
      } else {
        const pending = this.nextGoalForStep(id)
        if (pending) {
          throw invalidInput(`cannot mark step done; next pending goal: ${pending.content} (id ${pending.id})`)
        }
      }

      const existing = this.getStep(id)
      if (existing.status !== "done") {
        const now = Date.now()
        this.db.prepare("UPDATE steps SET status = ?, updated_at = ? WHERE id = ?").run("done", now, id)
      }
      const step = this.getStep(id)
      mergeStatusChanges(changes, this.refreshPlanStatus(step.plan_id))
      this.touchPlan(step.plan_id)
      return { step, changes }
    })

    return tx()
  }

  moveStep(id: number, to: number): StepRow[] {
    const tx = this.db.transaction(() => {
      const target = this.getStep(id)
      const planId = target.plan_id
      const steps = this.db
        .prepare("SELECT * FROM steps WHERE plan_id = ? ORDER BY sort_order ASC, id ASC")
        .all(planId) as StepRow[]
      const currentIndex = steps.findIndex((step) => step.id === id)
      if (currentIndex === -1) throw notFound(`step id ${id}`)
      let desiredIndex = Math.max(to - 1, 0)
      if (desiredIndex >= steps.length) desiredIndex = steps.length - 1

      const [moving] = steps.splice(currentIndex, 1)
      if (desiredIndex >= steps.length) steps.push(moving)
      else steps.splice(desiredIndex, 0, moving)

      const now = Date.now()
      steps.forEach((step, idx) => {
        const desiredOrder = idx + 1
        if (step.sort_order !== desiredOrder) {
          this.db
            .prepare("UPDATE steps SET sort_order = ?, updated_at = ? WHERE id = ?")
            .run(desiredOrder, now, step.id)
          step.sort_order = desiredOrder
          step.updated_at = now
        }
      })
      return steps
    })

    return tx()
  }

  deleteSteps(ids: number[]): { deleted: number; changes: StatusChanges } {
    const tx = this.db.transaction(() => {
      if (!ids.length) return { deleted: 0, changes: createEmptyStatusChanges() }
      const unique = uniqueIds(ids)
      const steps = this.db
        .prepare(`SELECT * FROM steps WHERE id IN (${unique.map(() => "?").join(",")})`)
        .all(...unique) as StepRow[]
      const existing = new Set(steps.map((step) => step.id))
      const missing = unique.filter((id) => !existing.has(id))
      if (missing.length) {
        throw notFound(`step id(s) not found: ${joinIds(missing)}`)
      }

      const planIds = Array.from(new Set(steps.map((step) => step.plan_id)))
      if (unique.length) {
        this.db
          .prepare(`DELETE FROM goals WHERE step_id IN (${unique.map(() => "?").join(",")})`)
          .run(...unique)
      }
      const result = this.db
        .prepare(`DELETE FROM steps WHERE id IN (${unique.map(() => "?").join(",")})`)
        .run(...unique)

      planIds.forEach((planId) => this.normalizeStepsForPlan(planId))

      const changes = createEmptyStatusChanges()
      planIds.forEach((planId) => mergeStatusChanges(changes, this.refreshPlanStatus(planId)))
      if (planIds.length) {
        this.touchPlans(planIds)
      }
      return { deleted: result.changes, changes }
    })

    return tx()
  }

  addGoalsBatch(stepId: number, contents: string[], status: GoalStatus): { goals: GoalRow[]; changes: StatusChanges } {
    if (!contents.length) return { goals: [], changes: createEmptyStatusChanges() }
    contents.forEach((content) => ensureNonEmpty("goal content", content))

    const tx = this.db.transaction(() => {
      const step = this.getStep(stepId)
      const now = Date.now()
      const created: GoalRow[] = []
      contents.forEach((content) => {
        const result = this.db
          .prepare(
            `INSERT INTO goals (step_id, content, status, comment, created_at, updated_at)
             VALUES (?, ?, ?, NULL, ?, ?)`
          )
          .run(stepId, content, status, now, now)
        created.push(this.getGoal(result.lastInsertRowid as number))
      })
      const changes = this.refreshStepStatus(stepId)
      this.touchPlan(step.plan_id)
      return { goals: created, changes }
    })

    return tx()
  }

  listGoalsFiltered(stepId: number, query: GoalQuery): GoalRow[] {
    this.getStep(stepId)
    const conditions: string[] = ["step_id = ?"]
    const params: any[] = [stepId]
    if (query.status) {
      conditions.push("status = ?")
      params.push(query.status)
    }
    let sql = `SELECT * FROM goals WHERE ${conditions.join(" AND ")} ORDER BY updated_at DESC, id DESC`
    if (query.limit !== undefined) {
      sql += " LIMIT ?"
      params.push(query.limit)
    }
    if (query.offset !== undefined) {
      sql += " OFFSET ?"
      params.push(query.offset)
    }
    return this.db.prepare(sql).all(...params) as GoalRow[]
  }

  countGoals(stepId: number, query: GoalQuery): number {
    this.getStep(stepId)
    const conditions: string[] = ["step_id = ?"]
    const params: any[] = [stepId]
    if (query.status) {
      conditions.push("status = ?")
      params.push(query.status)
    }
    const row = this.db
      .prepare(`SELECT COUNT(*) as count FROM goals WHERE ${conditions.join(" AND ")}`)
      .get(...params) as { count: number }
    return row.count
  }

  updateGoal(id: number, changes: GoalChanges): { goal: GoalRow; changes: StatusChanges } {
    const tx = this.db.transaction(() => {
      if (changes.content !== undefined) {
        ensureNonEmpty("goal content", changes.content)
      }
      const existing = this.getGoal(id)
      const now = Date.now()
      const updated = {
        content: changes.content ?? existing.content,
        status: changes.status ?? existing.status,
        comment: changes.comment !== undefined ? changes.comment : existing.comment,
      }
      this.db
        .prepare("UPDATE goals SET content = ?, status = ?, comment = ?, updated_at = ? WHERE id = ?")
        .run(updated.content, updated.status, updated.comment, now, id)

      const goal = this.getGoal(id)
      const statusChanges = createEmptyStatusChanges()
      if (changes.status !== undefined) {
        mergeStatusChanges(statusChanges, this.refreshStepStatus(goal.step_id))
      }
      const step = this.getStep(goal.step_id)
      this.touchPlan(step.plan_id)
      return { goal, changes: statusChanges }
    })

    return tx()
  }

  setGoalStatus(id: number, status: GoalStatus): { goal: GoalRow; changes: StatusChanges } {
    const tx = this.db.transaction(() => {
      this.getGoal(id)
      const now = Date.now()
      this.db.prepare("UPDATE goals SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id)
      const goal = this.getGoal(id)
      const changes = this.refreshStepStatus(goal.step_id)
      const step = this.getStep(goal.step_id)
      this.touchPlan(step.plan_id)
      return { goal, changes }
    })

    return tx()
  }

  setGoalsStatus(ids: number[], status: GoalStatus): { updated: number; changes: StatusChanges } {
    if (!ids.length) return { updated: 0, changes: createEmptyStatusChanges() }
    const tx = this.db.transaction(() => {
      const unique = uniqueIds(ids)
      const goals = this.db
        .prepare(`SELECT * FROM goals WHERE id IN (${unique.map(() => "?").join(",")})`)
        .all(...unique) as GoalRow[]
      const existing = new Set(goals.map((goal) => goal.id))
      const missing = unique.filter((id) => !existing.has(id))
      if (missing.length) {
        throw notFound(`goal id(s) not found: ${joinIds(missing)}`)
      }
      const now = Date.now()
      const stepIds: number[] = []
      const stepSeen = new Set<number>()
      goals.forEach((goal) => {
        if (!stepSeen.has(goal.step_id)) {
          stepSeen.add(goal.step_id)
          stepIds.push(goal.step_id)
        }
        this.db.prepare("UPDATE goals SET status = ?, updated_at = ? WHERE id = ?").run(status, now, goal.id)
      })

      const changes = createEmptyStatusChanges()
      stepIds.forEach((stepId) => mergeStatusChanges(changes, this.refreshStepStatus(stepId)))

      const planIds: number[] = []
      if (stepIds.length) {
        const steps = this.db
          .prepare(`SELECT plan_id FROM steps WHERE id IN (${stepIds.map(() => "?").join(",")})`)
          .all(...stepIds) as Array<{ plan_id: number }>
        const seen = new Set<number>()
        steps.forEach((row) => {
          if (!seen.has(row.plan_id)) {
            seen.add(row.plan_id)
            planIds.push(row.plan_id)
          }
        })
      }
      if (planIds.length) this.touchPlans(planIds)

      return { updated: unique.length, changes }
    })

    return tx()
  }

  deleteGoals(ids: number[]): { deleted: number; changes: StatusChanges } {
    const tx = this.db.transaction(() => {
      if (!ids.length) return { deleted: 0, changes: createEmptyStatusChanges() }
      const unique = uniqueIds(ids)
      const goals = this.db
        .prepare(`SELECT * FROM goals WHERE id IN (${unique.map(() => "?").join(",")})`)
        .all(...unique) as GoalRow[]
      const existing = new Set(goals.map((goal) => goal.id))
      const missing = unique.filter((id) => !existing.has(id))
      if (missing.length) {
        throw notFound(`goal id(s) not found: ${joinIds(missing)}`)
      }

      const stepIds = Array.from(new Set(goals.map((goal) => goal.step_id)))
      const result = this.db
        .prepare(`DELETE FROM goals WHERE id IN (${unique.map(() => "?").join(",")})`)
        .run(...unique)

      const changes = createEmptyStatusChanges()
      stepIds.forEach((stepId) => mergeStatusChanges(changes, this.refreshStepStatus(stepId)))

      if (stepIds.length) {
        const planIds: number[] = []
        const steps = this.db
          .prepare(`SELECT plan_id FROM steps WHERE id IN (${stepIds.map(() => "?").join(",")})`)
          .all(...stepIds) as Array<{ plan_id: number }>
        const seen = new Set<number>()
        steps.forEach((row) => {
          if (!seen.has(row.plan_id)) {
            seen.add(row.plan_id)
            planIds.push(row.plan_id)
          }
        })
        if (planIds.length) this.touchPlans(planIds)
      }

      return { deleted: result.changes, changes }
    })

    return tx()
  }

  commentPlans(entries: Array<[number, string]>): number[] {
    const normalized = normalizeCommentEntries(entries)
    if (!normalized.length) return []
    const ids = normalized.map(([id]) => id)
    const tx = this.db.transaction(() => {
      const existing = this.db
        .prepare(`SELECT id FROM plans WHERE id IN (${ids.map(() => "?").join(",")})`)
        .all(...ids)
        .map((row: any) => row.id as number)
      const existingSet = new Set(existing)
      const missing = ids.filter((id) => !existingSet.has(id))
      if (missing.length) {
        throw notFound(`plan id(s) not found: ${joinIds(missing)}`)
      }
      const now = Date.now()
      normalized.forEach(([planId, comment]) => {
        if (this.cwd) {
          this.db
            .prepare("UPDATE plans SET comment = ?, last_session_id = ?, last_cwd = ?, updated_at = ? WHERE id = ?")
            .run(comment, this.sessionId, this.cwd, now, planId)
        } else {
          this.db
            .prepare("UPDATE plans SET comment = ?, last_session_id = ?, updated_at = ? WHERE id = ?")
            .run(comment, this.sessionId, now, planId)
        }
      })
      return ids
    })

    return tx()
  }

  commentSteps(entries: Array<[number, string]>): number[] {
    const normalized = normalizeCommentEntries(entries)
    if (!normalized.length) return []
    const ids = normalized.map(([id]) => id)
    const tx = this.db.transaction(() => {
      const steps = this.db
        .prepare(`SELECT * FROM steps WHERE id IN (${ids.map(() => "?").join(",")})`)
        .all(...ids) as StepRow[]
      const existing = new Set(steps.map((step) => step.id))
      const missing = ids.filter((id) => !existing.has(id))
      if (missing.length) {
        throw notFound(`step id(s) not found: ${joinIds(missing)}`)
      }

      const planIds = Array.from(new Set(steps.map((step) => step.plan_id)))
      const now = Date.now()
      normalized.forEach(([stepId, comment]) => {
        this.db.prepare("UPDATE steps SET comment = ?, updated_at = ? WHERE id = ?").run(comment, now, stepId)
      })
      if (planIds.length) this.touchPlans(planIds)
      return planIds
    })

    return tx()
  }

  setStepWait(stepId: number, delayMs: number, reason?: string): { step: StepRow; until: number } {
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw invalidInput("delay must be a non-negative number")
    }
    const tx = this.db.transaction(() => {
      const step = this.getStep(stepId)
      const now = Date.now()
      const until = now + Math.trunc(delayMs)
      const comment = upsertWaitInComment(step.comment, until, reason)
      this.db.prepare("UPDATE steps SET comment = ?, updated_at = ? WHERE id = ?").run(comment, now, stepId)
      const updated = this.getStep(stepId)
      this.touchPlan(updated.plan_id)
      return { step: updated, until }
    })

    return tx()
  }

  clearStepWait(stepId: number): { step: StepRow } {
    const tx = this.db.transaction(() => {
      const step = this.getStep(stepId)
      const comment = step.comment ? removeWaitFromComment(step.comment) : null
      const now = Date.now()
      this.db.prepare("UPDATE steps SET comment = ?, updated_at = ? WHERE id = ?").run(comment, now, stepId)
      const updated = this.getStep(stepId)
      this.touchPlan(updated.plan_id)
      return { step: updated }
    })

    return tx()
  }

  getStepWait(stepId: number): { step: StepRow; wait: { until: number; reason?: string } | null } {
    const step = this.getStep(stepId)
    const wait = parseWaitFromComment(step.comment)
    return { step, wait }
  }

  commentGoals(entries: Array<[number, string]>): number[] {
    const normalized = normalizeCommentEntries(entries)
    if (!normalized.length) return []
    const ids = normalized.map(([id]) => id)
    const tx = this.db.transaction(() => {
      const goals = this.db
        .prepare(`SELECT * FROM goals WHERE id IN (${ids.map(() => "?").join(",")})`)
        .all(...ids) as GoalRow[]
      const existing = new Set(goals.map((goal) => goal.id))
      const missing = ids.filter((id) => !existing.has(id))
      if (missing.length) {
        throw notFound(`goal id(s) not found: ${joinIds(missing)}`)
      }

      const stepIds = Array.from(new Set(goals.map((goal) => goal.step_id)))
      const now = Date.now()
      normalized.forEach(([goalId, comment]) => {
        this.db.prepare("UPDATE goals SET comment = ?, updated_at = ? WHERE id = ?").run(comment, now, goalId)
      })

      if (stepIds.length) {
        const planIds: number[] = []
        const steps = this.db
          .prepare(`SELECT plan_id FROM steps WHERE id IN (${stepIds.map(() => "?").join(",")})`)
          .all(...stepIds) as Array<{ plan_id: number }>
        const seen = new Set<number>()
        steps.forEach((row) => {
          if (!seen.has(row.plan_id)) {
            seen.add(row.plan_id)
            planIds.push(row.plan_id)
          }
        })
        if (planIds.length) this.touchPlans(planIds)
        return planIds
      }

      return []
    })

    return tx()
  }

  goalsForStep(stepId: number): GoalRow[] {
    return this.db.prepare("SELECT * FROM goals WHERE step_id = ? ORDER BY id ASC").all(stepId) as GoalRow[]
  }

  goalsForSteps(stepIds: number[]): Map<number, GoalRow[]> {
    const grouped = new Map<number, GoalRow[]>()
    if (!stepIds.length) return grouped
    const rows = this.db
      .prepare(`SELECT * FROM goals WHERE step_id IN (${stepIds.map(() => "?").join(",")}) ORDER BY step_id ASC, id ASC`)
      .all(...stepIds) as GoalRow[]
    rows.forEach((goal) => {
      const list = grouped.get(goal.step_id)
      if (list) list.push(goal)
      else grouped.set(goal.step_id, [goal])
    })
    return grouped
  }

  planIdsForSteps(ids: number[]): number[] {
    if (!ids.length) return []
    const unique = uniqueIds(ids)
    const rows = this.db
      .prepare(`SELECT plan_id FROM steps WHERE id IN (${unique.map(() => "?").join(",")})`)
      .all(...unique) as Array<{ plan_id: number }>
    const seen = new Set<number>()
    const planIds: number[] = []
    rows.forEach((row) => {
      if (!seen.has(row.plan_id)) {
        seen.add(row.plan_id)
        planIds.push(row.plan_id)
      }
    })
    return planIds
  }

  planIdsForGoals(ids: number[]): number[] {
    if (!ids.length) return []
    const unique = uniqueIds(ids)
    const goals = this.db
      .prepare(`SELECT step_id FROM goals WHERE id IN (${unique.map(() => "?").join(",")})`)
      .all(...unique) as Array<{ step_id: number }>
    const stepIds = Array.from(new Set(goals.map((row) => row.step_id)))
    if (!stepIds.length) return []
    const steps = this.db
      .prepare(`SELECT plan_id FROM steps WHERE id IN (${stepIds.map(() => "?").join(",")})`)
      .all(...stepIds) as Array<{ plan_id: number }>
    const seen = new Set<number>()
    const planIds: number[] = []
    steps.forEach((row) => {
      if (!seen.has(row.plan_id)) {
        seen.add(row.plan_id)
        planIds.push(row.plan_id)
      }
    })
    return planIds
  }

  private updatePlanWithConn(id: number, changes: PlanChanges): PlanRow {
    if (changes.title !== undefined) ensureNonEmpty("plan title", changes.title)
    if (changes.content !== undefined) ensureNonEmpty("plan content", changes.content)
    if (changes.status === "done") {
      const total = this.db.prepare("SELECT COUNT(*) as count FROM steps WHERE plan_id = ?").get(id) as { count: number }
      if (total.count > 0) {
        const next = this.nextStep(id)
        if (next) {
          const goals = this.goalsForStep(next.id)
          const detail = formatStepDetail(next, goals)
          throw invalidInput(`cannot mark plan done; next pending step:\n${detail}`)
        }
      }
    }

    const existing = this.getPlan(id)
    const now = Date.now()
    const updated = {
      title: changes.title ?? existing.title,
      content: changes.content ?? existing.content,
      status: changes.status ?? existing.status,
      comment: changes.comment !== undefined ? changes.comment : existing.comment,
    }

    if (this.cwd) {
      this.db
        .prepare(
          `UPDATE plans SET title = ?, content = ?, status = ?, comment = ?, last_session_id = ?, last_cwd = ?, updated_at = ? WHERE id = ?`
        )
        .run(updated.title, updated.content, updated.status, updated.comment, this.sessionId, this.cwd, now, id)
    } else {
      this.db
        .prepare(
          `UPDATE plans SET title = ?, content = ?, status = ?, comment = ?, last_session_id = ?, updated_at = ? WHERE id = ?`
        )
        .run(updated.title, updated.content, updated.status, updated.comment, this.sessionId, now, id)
    }

    return this.getPlan(id)
  }

  private refreshPlanStatus(planId: number): StatusChanges {
    const total = this.db.prepare("SELECT COUNT(*) as count FROM steps WHERE plan_id = ?").get(planId) as { count: number }
    if (total.count === 0) return createEmptyStatusChanges()
    const done = this.db
      .prepare("SELECT COUNT(*) as count FROM steps WHERE plan_id = ? AND status = ?")
      .get(planId, "done") as { count: number }
    const status: PlanStatus = done.count === total.count ? "done" : "todo"

    const plan = this.getPlan(planId)
    const changes = createEmptyStatusChanges()
    if (plan.status !== status) {
      const now = Date.now()
      const reason = done.count === total.count ? `all steps are done (${done.count}/${total.count})` : `steps done ${done.count}/${total.count}`
      this.db.prepare("UPDATE plans SET status = ?, updated_at = ? WHERE id = ?").run(status, now, planId)
      changes.plans.push({ plan_id: planId, from: plan.status, to: status, reason })
      if (status === "done") {
        const clearedCurrent = this.clearActivePlansForPlanWithConn(planId)
        if (clearedCurrent) {
          changes.active_plans_cleared.push({ plan_id: planId, reason: "plan marked done" })
        }
      }
    }
    return changes
  }

  private refreshStepStatus(stepId: number): StatusChanges {
    const goals = this.db.prepare("SELECT * FROM goals WHERE step_id = ? ORDER BY id ASC").all(stepId) as GoalRow[]
    if (!goals.length) return createEmptyStatusChanges()
    const doneCount = goals.filter((goal) => goal.status === "done").length
    const total = goals.length
    const status: StepStatus = doneCount === total ? "done" : "todo"

    const step = this.getStep(stepId)
    const changes = createEmptyStatusChanges()
    if (step.status !== status) {
      const now = Date.now()
      const reason = doneCount === total ? `all goals are done (${doneCount}/${total})` : `goals done ${doneCount}/${total}`
      this.db.prepare("UPDATE steps SET status = ?, updated_at = ? WHERE id = ?").run(status, now, stepId)
      changes.steps.push({ step_id: stepId, from: step.status, to: status, reason })
    }
    mergeStatusChanges(changes, this.refreshPlanStatus(step.plan_id))
    return changes
  }

  private nextGoalForStep(stepId: number): GoalRow | null {
    const row = this.db
      .prepare("SELECT * FROM goals WHERE step_id = ? AND status = ? ORDER BY id ASC LIMIT 1")
      .get(stepId, "todo") as GoalRow | undefined
    return row ?? null
  }

  private setAllGoalsDoneForStep(stepId: number): StatusChanges {
    this.getStep(stepId)
    const goals = this.goalsForStep(stepId)
    if (!goals.length) return createEmptyStatusChanges()
    const ids = goals.map((goal) => goal.id)
    return this.setGoalsStatus(ids, "done").changes
  }

  private touchPlan(planId: number) {
    const now = Date.now()
    if (this.cwd) {
      const result = this.db
        .prepare("UPDATE plans SET last_session_id = ?, last_cwd = ?, updated_at = ? WHERE id = ?")
        .run(this.sessionId, this.cwd, now, planId)
      if (result.changes === 0) {
        throw notFound(`plan id ${planId}`)
      }
    } else {
      const result = this.db
        .prepare("UPDATE plans SET last_session_id = ?, updated_at = ? WHERE id = ?")
        .run(this.sessionId, now, planId)
      if (result.changes === 0) {
        throw notFound(`plan id ${planId}`)
      }
    }
  }

  private touchPlans(planIds: number[]) {
    planIds.forEach((planId) => this.touchPlan(planId))
  }

  private normalizeStepsForPlan(planId: number) {
    const steps = this.db
      .prepare("SELECT * FROM steps WHERE plan_id = ? ORDER BY sort_order ASC, id ASC")
      .all(planId) as StepRow[]
    this.normalizeStepsInPlace(steps)
  }

  private normalizeStepsInPlace(steps: StepRow[]) {
    const now = Date.now()
    steps.forEach((step, idx) => {
      const desired = idx + 1
      if (step.sort_order !== desired) {
        this.db.prepare("UPDATE steps SET sort_order = ?, updated_at = ? WHERE id = ?").run(desired, now, step.id)
        step.sort_order = desired
        step.updated_at = now
      }
    })
  }

  private clearActivePlansForPlanWithConn(planId: number): boolean {
    const existing = this.db
      .prepare("SELECT * FROM active_plan WHERE plan_id = ?")
      .all(planId) as ActivePlanRow[]
    const clearedCurrent = existing.some((row) => row.session_id === this.sessionId)
    this.db.prepare("DELETE FROM active_plan WHERE plan_id = ?").run(planId)
    return clearedCurrent
  }
}
