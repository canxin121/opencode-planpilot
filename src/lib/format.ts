import type { GoalRow, PlanRow, StepRow, PlanDetail } from "./models"
import { formatDateTimeUTC } from "./util"

function hasText(value?: string | null) {
  return value !== undefined && value !== null && value.trim().length > 0
}

export function formatStepDetail(step: StepRow, goals: GoalRow[]): string {
  let output = ""
  output += `Step ID: ${step.id}\n`
  output += `Plan ID: ${step.plan_id}\n`
  output += `Status: ${step.status}\n`
  output += `Executor: ${step.executor}\n`
  output += `Content: ${step.content}\n`
  if (hasText(step.comment)) {
    output += `Comment: ${step.comment ?? ""}\n`
  }
  output += `Created: ${formatDateTimeUTC(step.created_at)}\n`
  output += `Updated: ${formatDateTimeUTC(step.updated_at)}\n`
  output += "\n"
  if (!goals.length) {
    output += "Goals: (none)"
    return output.trimEnd()
  }
  output += "Goals:\n"
  for (const goal of goals) {
    output += `- [${goal.status}] ${goal.content} (goal id ${goal.id})\n`
    if (hasText(goal.comment)) {
      output += `  Comment: ${goal.comment ?? ""}\n`
    }
  }
  return output.trimEnd()
}

export function formatGoalDetail(goal: GoalRow, step: StepRow): string {
  let output = ""
  output += `Goal ID: ${goal.id}\n`
  output += `Step ID: ${goal.step_id}\n`
  output += `Plan ID: ${step.plan_id}\n`
  output += `Status: ${goal.status}\n`
  output += `Content: ${goal.content}\n`
  if (hasText(goal.comment)) {
    output += `Comment: ${goal.comment ?? ""}\n`
  }
  output += `Created: ${formatDateTimeUTC(goal.created_at)}\n`
  output += `Updated: ${formatDateTimeUTC(goal.updated_at)}\n`
  output += "\n"
  output += `Step Status: ${step.status}\n`
  output += `Step Executor: ${step.executor}\n`
  output += `Step Content: ${step.content}\n`
  if (hasText(step.comment)) {
    output += `Step Comment: ${step.comment ?? ""}\n`
  }
  return output.trimEnd()
}

export function formatPlanDetail(plan: PlanRow, steps: StepRow[], goals: Map<number, GoalRow[]>): string {
  let output = ""
  output += `Plan ID: ${plan.id}\n`
  output += `Title: ${plan.title}\n`
  output += `Status: ${plan.status}\n`
  output += `Content: ${plan.content}\n`
  if (hasText(plan.comment)) {
    output += `Comment: ${plan.comment ?? ""}\n`
  }
  output += `Created: ${formatDateTimeUTC(plan.created_at)}\n`
  output += `Updated: ${formatDateTimeUTC(plan.updated_at)}\n`
  output += "\n"
  if (!steps.length) {
    output += "Steps: (none)"
    return output.trimEnd()
  }
  output += "Steps:\n"
  for (const step of steps) {
    const stepGoals = goals.get(step.id) ?? []
    if (stepGoals.length) {
      const done = stepGoals.filter((goal) => goal.status === "done").length
      output += `- [${step.status}] ${step.content} (step id ${step.id}, exec ${step.executor}, goals ${done}/${stepGoals.length})\n`
    } else {
      output += `- [${step.status}] ${step.content} (step id ${step.id}, exec ${step.executor})\n`
    }
    if (hasText(step.comment)) {
      output += `  Comment: ${step.comment ?? ""}\n`
    }
    if (stepGoals.length) {
      for (const goal of stepGoals) {
        output += `  - [${goal.status}] ${goal.content} (goal id ${goal.id})\n`
        if (hasText(goal.comment)) {
          output += `    Comment: ${goal.comment ?? ""}\n`
        }
      }
    }
  }
  return output.trimEnd()
}

export function formatPlanMarkdown(
  active: boolean,
  activeUpdated: number | null,
  plan: PlanRow,
  steps: StepRow[],
  goals: Map<number, GoalRow[]>,
): string {
  const lines: string[] = []

  const checkbox = (status: string) => (status === "done" ? "x" : " ")

  const collapseHeading = (text: string) => {
    const normalized = text.replace(/\r\n/g, "\n")
    const parts = normalized
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    if (!parts.length) return "(untitled)"
    return parts.join(" / ")
  }

  const splitTaskText = (text: string): [string, string[]] => {
    const normalized = text.replace(/\r\n/g, "\n")
    const rawLines = normalized.split("\n")
    if (!rawLines.length) return ["(empty)", []]
    let firstIdx = -1
    for (let i = 0; i < rawLines.length; i += 1) {
      if (rawLines[i].trim()) {
        firstIdx = i
        break
      }
    }
    if (firstIdx === -1) return ["(empty)", []]
    return [rawLines[firstIdx], rawLines.slice(firstIdx + 1)]
  }

  const pushLine = (indent: number, text: string) => {
    lines.push(`${" ".repeat(indent)}${text}`)
  }
  const pushBlank = (indent: number) => {
    lines.push(indent === 0 ? "" : " ".repeat(indent))
  }

  pushLine(0, "# Plan")
  pushBlank(0)
  pushLine(0, `## Plan: ${collapseHeading(plan.title)}`)
  pushBlank(0)
  pushLine(0, `- **Active:** \`${active ? "true" : "false"}\``)
  pushLine(0, `- **Plan ID:** \`${plan.id}\``)
  pushLine(0, `- **Status:** \`${plan.status}\``)
  if (hasText(plan.comment)) {
    pushLine(0, `- **Comment:** ${plan.comment ?? ""}`)
  }
  if (activeUpdated) {
    pushLine(0, `- **Activated:** ${formatDateTimeUTC(activeUpdated)}`)
  }
  pushLine(0, `- **Created:** ${formatDateTimeUTC(plan.created_at)}`)
  pushLine(0, `- **Updated:** ${formatDateTimeUTC(plan.updated_at)}`)
  const stepsDone = steps.filter((step) => step.status === "done").length
  pushLine(0, `- **Steps:** ${stepsDone}/${steps.length}`)
  pushBlank(0)

  pushLine(0, "### Plan Content")
  pushBlank(0)
  if (!plan.content.trim()) {
    pushLine(0, "*No content*")
  } else {
    const normalized = plan.content.replace(/\r\n/g, "\n")
    for (const line of normalized.split("\n")) {
      if (!line.length) {
        pushLine(0, ">")
      } else {
        pushLine(0, `> ${line}`)
      }
    }
  }
  pushBlank(0)

  pushLine(0, "### Steps")
  pushBlank(0)
  if (!steps.length) {
    pushLine(0, "*No steps*")
    return lines.join("\n").trimEnd()
  }

  steps.forEach((step, idx) => {
    const [firstLine, restLines] = splitTaskText(step.content)
    pushLine(0, `- [${checkbox(step.status)}] **${firstLine}** *(id: ${step.id}, exec: ${step.executor}, order: ${step.sort_order})*`)

    let hasRest = false
    for (const line of restLines) {
      if (!line.trim()) continue
      if (!hasRest) {
        pushBlank(2)
        hasRest = true
      } else {
        pushBlank(2)
      }
      pushLine(2, line)
    }

    pushBlank(2)
    pushLine(2, `- Created: ${formatDateTimeUTC(step.created_at)}`)
    pushLine(2, `- Updated: ${formatDateTimeUTC(step.updated_at)}`)
    if (hasText(step.comment)) {
      pushLine(2, `- Comment: ${step.comment ?? ""}`)
    }

    const stepGoals = goals.get(step.id)
    if (stepGoals && stepGoals.length) {
      const done = stepGoals.filter((goal) => goal.status === "done").length
      pushLine(2, `- Goals: ${done}/${stepGoals.length}`)
      for (const goal of stepGoals) {
        const [goalFirst, goalRest] = splitTaskText(goal.content)
        pushBlank(2)
        pushLine(2, `- [${checkbox(goal.status)}] ${goalFirst} *(id: ${goal.id})*`)
        for (const line of goalRest) {
          if (!line.trim()) continue
          pushBlank(4)
          pushLine(4, line)
        }
        if (hasText(goal.comment)) {
          pushBlank(4)
          pushLine(4, `Comment: ${goal.comment ?? ""}`)
        }
      }
    } else {
      pushLine(2, "- Goals: 0/0")
      pushBlank(2)
      pushLine(2, "- (none)")
    }

    if (idx + 1 < steps.length) {
      pushBlank(0)
    }
  })

  return lines.join("\n").trimEnd()
}

export function planDetailToMarkdown(detail: PlanDetail, active: boolean, activeUpdated: number | null): string {
  return formatPlanMarkdown(active, activeUpdated, detail.plan, detail.steps, detail.goals)
}
