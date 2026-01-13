export type PlanStatus = "todo" | "done"
export type StepStatus = "todo" | "done"
export type GoalStatus = "todo" | "done"
export type StepExecutor = "ai" | "human"

export interface PlanRow {
  id: number
  title: string
  content: string
  status: PlanStatus
  comment: string | null
  last_session_id: string | null
  last_cwd: string | null
  created_at: number
  updated_at: number
}

export interface StepRow {
  id: number
  plan_id: number
  content: string
  status: StepStatus
  executor: StepExecutor
  sort_order: number
  comment: string | null
  created_at: number
  updated_at: number
}

export interface GoalRow {
  id: number
  step_id: number
  content: string
  status: GoalStatus
  comment: string | null
  created_at: number
  updated_at: number
}

export interface ActivePlanRow {
  id: number
  session_id: string
  plan_id: number
  updated_at: number
}

export interface PlanDetail {
  plan: PlanRow
  steps: StepRow[]
  goals: Map<number, GoalRow[]>
}

export interface StepDetail {
  step: StepRow
  goals: GoalRow[]
}

export interface GoalDetail {
  goal: GoalRow
  step: StepRow
}

export interface StepInput {
  content: string
  executor: StepExecutor
  goals: string[]
}

export interface StepStatusChange {
  step_id: number
  from: string
  to: string
  reason: string
}

export interface PlanStatusChange {
  plan_id: number
  from: string
  to: string
  reason: string
}

export interface ActivePlanCleared {
  plan_id: number
  reason: string
}

export interface StatusChanges {
  steps: StepStatusChange[]
  plans: PlanStatusChange[]
  active_plans_cleared: ActivePlanCleared[]
}

export interface PlanChanges {
  title?: string
  content?: string
  status?: PlanStatus
  comment?: string
}

export interface StepChanges {
  content?: string
  status?: StepStatus
  executor?: StepExecutor
  comment?: string
}

export interface GoalChanges {
  content?: string
  status?: GoalStatus
  comment?: string
}

export type PlanOrder = "id" | "title" | "created" | "updated"
export type StepOrder = "order" | "id" | "created" | "updated"

export interface StepQuery {
  status?: StepStatus | null
  executor?: StepExecutor | null
  limit?: number
  offset?: number
  order?: StepOrder
  desc?: boolean
}

export interface GoalQuery {
  status?: GoalStatus | null
  limit?: number
  offset?: number
}

export function createEmptyStatusChanges(): StatusChanges {
  return { steps: [], plans: [], active_plans_cleared: [] }
}

export function mergeStatusChanges(target: StatusChanges, other: StatusChanges) {
  target.steps.push(...other.steps)
  target.plans.push(...other.plans)
  target.active_plans_cleared.push(...other.active_plans_cleared)
}

export function statusChangesEmpty(changes: StatusChanges) {
  return !changes.steps.length && !changes.plans.length && !changes.active_plans_cleared.length
}
