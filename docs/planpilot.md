# Planpilot (OpenCode Tool)

## Tool Name
`planpilot`

## What it is
Planpilot is a planner/tracker for multi-step work. It manages plans, steps, and goals, and automatically rolls up status.

## OpenCode Tool Usage (Required)
Use the custom `planpilot` tool. Do **not** call the CLI via `bash` for planning.

### Tool schema
- `argv?: string[]` - preferred; avoids quoting issues
- `command?: string` - optional; one command string

Rules:
- Provide either `argv` or `command`.
- Do **not** pass `--session-id` or `--cwd`; the tool injects them automatically from the current session.
- If both `argv` and `command` are provided, `argv` is used.

Example tool args:

```json
{ "argv": ["plan", "add", "Release v1.2", "Plan description"] }
```

```json
{ "command": "plan add \"Release v1.2\" \"Plan description\"" }
```

## CLI (Optional)
A CLI binary named `planpilot` is available for manual use. If you use the CLI directly, you must pass `--session-id` and `--cwd` yourself.

## Storage
- Database: `~/.config/opencode/.planpilot/planpilot.db`
- Plan snapshots: `~/.config/opencode/.planpilot/plans/`
- Override base directory: `OPENCODE_PLANPILOT_DIR` or `OPENCODE_PLANPILOT_HOME`

## Hierarchy
- Plan contains steps; step contains goals.
- Goals are the smallest units of work; steps group goals; plans group steps.

## AI Workflow Guidelines
- Use Planpilot for all planning, status, and progress tracking; do not use built-in plan/todo tools or other methods to track plan/step/goal status.
- Do not read plan files from disk or follow plan file placeholders; use the planpilot tool for plan/step/goal info.
- When waiting for external systems, use `step wait <id> --delay <ms> --reason <text>` to pause auto-continue until the delay expires.
- Treat tool output as authoritative. Do not invent IDs; only use IDs shown by `list`/`show`.
- If the tool is missing or unavailable, ask the user to enable/install the plugin.
- Record implementation details using Planpilot comments (plan/step/goal `--comment` or `comment` commands). Before starting a step or goal, think through the next actions and capture that context in comments so the plan stays actionable.
- Before starting a new plan, do deep analysis; then create the plan with clear steps and goals.
- When creating a plan or step, prefer `add-tree` to define all steps/goals upfront.
- Prefer assigning steps to `ai`; only assign `human` for truly critical/high-risk items or when passwords, `sudo` access, irreversible git history rewrites, or remote git changes are required. If `human` steps are necessary, batch them, make the step content explicit about what the human must do, and only ask for user input when the next step is assigned to `human`.
- Adjust plans/steps/goals only when necessary; avoid frequent arbitrary changes.
- Update status promptly as work completes; mark goals done, and let steps/plans auto-refresh unless a step/plan has no children (then use `step done`/`plan done`).
- In each reply turn, complete at most one step; do not advance multiple steps in a single response.

## Status Management
- Status values: `todo`, `done`.
- Goals are manual (`goal done`); steps/plans auto-refresh from child status, and use `step done`/`plan done` only when they have no children (`step done --all-goals` marks all goals done and then marks the step done). Auto status changes print as `Auto status updates:` with reasons.
- Parent status auto-flips to `todo` on incomplete child work and to `done` when all children are done. If a plan has 0 steps or a step has 0 goals, no auto-flip happens; use `plan done` / `step done` as needed.
- If the user completed a `human` step, verify/mark each goal and clearly list what remains.
- When a step becomes `done` and there is another pending step, the CLI will print the next-step instruction: for `ai`, end the turn so Planpilot can surface it; for `human`, show the step detail and tell the user to complete the goals, then end the turn. When a plan becomes `done` (automatic or manual), the CLI will prompt you to summarize completed results and end the turn.

## Active Plan Management
- Use `plan activate` / `plan deactivate` to manage, and no active plan means the plan is paused until reactivated. Plans auto-deactivate on `done` (manual or automatic) or removal.
- Each plan can be active in only one session at a time; use `plan activate --force` to take over. Default to no `--force`, and if activation fails due to another session, ask the user whether to take over.
- Use `plan show-active` to know which plan is active and get its details.

## Auto-Continue Behavior (OpenCode Plugin)
- The plugin listens to `session.idle` / `session.status` (idle) events.
- If there is an active plan and the next pending step is assigned to `ai`, it appends a `Planpilot (auto):` message to the prompt and submits it so the model continues the plan.
- It does nothing when there is no active plan or when the next step is assigned to `human`.
- If the next step has a wait marker (`@wait-until=<unix_ms>` in its comment) and the time has not elapsed, auto-continue is skipped.

## ID Notes
- Plan/step/goal IDs are database IDs and may be non-contiguous or not start at 1; always use the actual IDs shown by `list`/`show`.

## Commands

- IMPORTANT: Do NOT pass `--cwd` or `--session-id` when using the tool. These are injected automatically.

### plan
- Plan data is stored under OpenCode config: `~/.config/opencode/.planpilot/` (overridable via `OPENCODE_PLANPILOT_DIR` or `OPENCODE_PLANPILOT_HOME`).
- `plan add <title> <content>`: create a plan.
  - Output: `Created plan ID: <id>: <title>`.
- `plan add-tree <title> <content> --step <content> [--executor ai|human] [--goal <goal> ...] [--step <content> ...]`: create a plan with steps/goals in one command.
  - Output: `Created plan ID: <id>: <title> (steps: <n>, goals: <n>)`.
  - Behavior: the newly created plan is automatically activated for the current session.
  - Repeatable groups: you can repeat the `--step ... [--executor ...] [--goal ...]` group multiple times.
  - Each `--executor` / `--goal` applies to the most recent `--step`.
  - Example (tool args):
    ```json
    {"argv":["plan","add-tree","Release v1.2","Plan description","--step","Cut release branch","--executor","human","--goal","Create branch","--goal","Tag base","--step","Build artifacts","--executor","ai","--goal","Build packages"]}
    ```
  - Another example (3 steps, some without goals/executor):
    ```json
    {"argv":["plan","add-tree","Onboarding","Setup plan","--step","Create accounts","--goal","GitHub","--goal","Slack","--step","Install tooling","--executor","ai","--step","Read handbook"]}
    ```
- `plan list [--scope project|all] [--status todo|done|all] [--limit N] [--page N] [--order id|title|created|updated] [--desc]`: list plans. Default: `--scope project`, `--status all`, `--limit 20`, `--page 1`, order by `updated` desc (most recent first).
  - Output: prints a header line, then one line per plan with `ID STAT STEPS TITLE COMMENT` (`STEPS` is `done/total`); use `plan show` for full details.
  - Output (empty): `No plans found.`
  - Order: defaults to `updated` with most recent first. Use `--order` and `--desc` to override.
  - Pagination: If `--page` is provided without `--limit`, the default limit is used.
  - If `--page` exceeds the total pages, a warning is printed and no rows are returned.
  - Footer: prints `Page N / Limit N` after the list.
- `plan count [--scope project|all] [--status todo|done|all]`: count plans matching the filters. Output: `Total: <n>`.
- `plan search --search <term> [--search <term> ...] [--search-mode any|all] [--search-field plan|title|content|comment|steps|goals|all] [--match-case] [--scope project|all] [--status todo|done|all] [--limit N] [--page N] [--order id|title|created|updated] [--desc]`: search plans. Default: `--scope project`, `--status all`, `--limit 20`, `--page 1`, order by `updated` desc.
  - Output: same format as `plan list`.
  - Output (empty): `No plans found.`
  - Advanced search:
    - `--search <term>` (repeatable): filter plans by text (required).
    - `--search-mode any|all`: match any term or require all terms (default: `all`).
    - `--search-field plan|title|content|comment|steps|goals|all` (default: `plan`).
    - `--match-case`: make search case-sensitive.
  - Pagination: If `--page` is provided without `--limit`, the default limit is used.
  - If `--page` exceeds the total pages, a warning is printed and no rows are returned.
  - Footer: prints `Page N / Limit N` after the list.
- `plan show <id>`: prints plan details and nested steps/goals (includes ids for plan/step/goal).
  - Output: plan header includes `Plan ID: <id>`, `Title`, `Status`, `Content`, `Created`, `Updated`, and `Comment` when present.
  - Output: each step line includes step id and executor; progress (`goals done/total`) is shown only when the step has goals. Each goal line includes goal id.
- `plan export <id> <path>`: export plan details to a markdown file.
  - Output: `Exported plan ID: <id> to <path>`.
- `plan update <id> [--title <title>] [--content <content>] [--status todo|done] [--comment <comment>]`: update fields; `--status done` is allowed only when all steps are done or the plan has no steps.
  - Output: `Updated plan ID: <id>: <title>`.
  - Errors: multi-line `Error: Invalid input:` with `cannot mark plan done; next pending step:` on the next line, followed by the same step detail output as `step show`.
- `plan done <id>`: mark plan done (same rule as `plan update --status done`).
  - Output: `Plan ID: <id> marked done.`
  - Output (active plan): `Active plan deactivated because plan is done.`
  - Errors: multi-line `Error: Invalid input:` with `cannot mark plan done; next pending step:` on the next line, followed by the same step detail output as `step show`.
- `plan comment <id1> <comment1> [<id2> <comment2> ...]`: add or replace comments for one or more plans.
  - Output (single): `Updated plan comment for plan ID: <id>.`
  - Output (batch): `Updated plan comments for <n> plans.`
  - Each plan comment uses an `<id> <comment>` pair; you can provide multiple pairs in one call.
  - Example:
    ```json
    {"argv":["plan","comment","12","high priority","15","waiting on input"]}
    ```
- `plan remove <id>`: remove plan (and its steps/goals).
  - Output: `Plan ID: <id> removed.`
- `plan activate <id> [--force]`: set the active plan.
  - Output: `Active plan set to <id>: <title>`.
  - `--force` takes over a plan already active in another session.
  - Errors: `Error: Invalid input: cannot activate plan; plan is done`.
  - Errors: `Error: Invalid input: plan id <id> is already active in session <session_id> (use --force to take over)`.
- `plan show-active`: prints the active plan details (same format as `plan show`).
  - Output: the same plan detail format as `plan show`.
  - Output (empty): `No active plan.`
  - Output (missing): `Active plan ID: <id> not found.`
- `plan deactivate`: unset the active plan (does not delete any plan).
  - Output: `Active plan deactivated.`

### step
- `step add <plan_id> <content1> [<content2> ...] [--at <pos>] [--executor ai|human]`: add steps.
  - Output (single): `Created step ID: <id> for plan ID: <plan_id>`.
  - Output (batch): `Created <n> steps for plan ID: <plan_id>`.
- `step add-tree <plan_id> <content> [--executor ai|human] [--goal <goal> ...]`: create one step with goals in one command.
  - Output: `Created step ID: <id> for plan ID: <plan_id> (goals: <n>)`.
  - Example:
    ```json
    {"argv":["step","add-tree","1","Draft summary","--executor","ai","--goal","Collect inputs","--goal","Write draft"]}
    ```
- `step list <plan_id> [--status todo|done|all] [--executor ai|human] [--limit N] [--page N]`: list steps. Default: `--status all`, `--limit 20`, `--page 1`. Steps are always returned in their plan order.
  - Output: prints a header line, then one line per step with `ID STAT ORD EXEC GOALS CONTENT COMMENT` (`ORD` is the step order within the plan; `GOALS` is `done/total`); use `step show` for full details.
  - Output (empty): `No steps found for plan ID: <plan_id>.`
  - Pagination: If `--page` is provided without `--limit`, the default limit is used.
  - If `--page` exceeds the total pages, a warning is printed and no rows are returned.
  - Footer: prints `Page N / Limit N` after the list.
- `step count <plan_id> [--status todo|done|all] [--executor ai|human]`: count steps matching the filters. Output: `Total: <n>`.
- `step show <id>`: prints a single step with full details and its nested goals (includes ids for step/goal).
  - Output: step header includes `Step ID: <id>`, `Plan ID`, `Status`, `Executor`, `Content`, `Created`, `Updated`, and `Comment` when present.
  - Output: lists all goals with `[status]` and goal id.
- `step show-next`: show the next pending step for the active plan (same format as `step show`).
  - Output (empty): `No active plan.` or `No pending step.`.
- `step wait <id> --delay <ms> [--reason <text>]`: delay auto-continue for this step by a number of milliseconds.
  - Output: `Step ID: <id> waiting until <unix_ms>.`
- `step wait <id> --clear`: clear any existing wait on this step.
  - Output: `Step ID: <id> wait cleared.`
- `step update <id> [--content <content>] [--status todo|done] [--executor ai|human] [--comment <comment>]`: update fields; `--status done` is allowed only when all goals are done or the step has no goals.
  - Output: `Updated step ID: <id>.`.
  - Errors: `Error: Invalid input: cannot mark step done; next pending goal: <content> (id <id>)`.
- `step comment <id1> <comment1> [<id2> <comment2> ...]`: add or replace comments for one or more steps.
  - Output (single): `Updated step comments for plan ID: <plan_id>.`
  - Output (batch): `Updated step comments for <n> plans.`
  - Each step comment uses an `<id> <comment>` pair; you can provide multiple pairs in one call.
  - Example:
    ```json
    {"argv":["step","comment","45","blocked by API","46","ready to start"]}
    ```
- `step done <id> [--all-goals]`: mark step done (same rule as `step update --status done`). Use `--all-goals` to mark all goals in the step done first, then mark the step done.
  - Output: `Step ID: <id> marked done.`
  - Errors: `Error: Invalid input: cannot mark step done; next pending goal: <content> (id <id>)`.
- `step move <id> --to <pos>`: reorder and print the same one-line list as `step list`.
  - Output: `Reordered steps for plan ID: <plan_id>:` + list.
- `step remove <id1> [<id2> ...]`: remove step(s).
  - Output (single): `Step ID: <id> removed.`
  - Output (batch): `Removed <n> steps.`
  - Errors: `Error: Not found: step id(s) not found: <id1>[, <id2> ...]`.

### goal
- `goal add <step_id> <content1> [<content2> ...]`: add goals to a step.
  - Output (single): `Created goal ID: <id> for step ID: <step_id>`.
  - Output (batch): `Created <n> goals for step ID: <step_id>`.
- `goal list <step_id> [--status todo|done|all] [--limit N] [--page N]`: list goals. Default: `--status all`, `--limit 20`, `--page 1`, order by `updated` desc (most recent first).
  - Output: prints a header line, then one line per goal with `ID STAT CONTENT COMMENT`.
  - Output (empty): `No goals found for step ID: <step_id>.`
  - Pagination: If `--page` is provided without `--limit`, the default limit is used.
  - If `--page` exceeds the total pages, a warning is printed and no rows are returned.
  - Footer: prints `Page N / Limit N` after the list.
- `goal count <step_id> [--status todo|done|all]`: count goals matching the filters. Output: `Total: <n>`.
- `goal update <id> [--content <content>] [--status todo|done] [--comment <comment>]`: update fields.
  - Output: `Updated goal <id>.`
- `goal comment <id1> <comment1> [<id2> <comment2> ...]`: add or replace comments for one or more goals.
  - Output (single): `Updated goal comments for plan ID: <plan_id>.`
  - Output (batch): `Updated goal comments for <n> plans.`
  - Each goal comment uses an `<id> <comment>` pair; you can provide multiple pairs in one call.
  - Example:
    ```json
    {"argv":["goal","comment","78","done","81","needs review"]}
    ```
- `goal done <id1> [<id2> ...]`: mark one or more goals done.
  - Output (single): `Goal ID: <id> marked done.`
  - Output (batch): `Goals marked done: <n>.`
- `goal remove <id1> [<id2> ...]`: remove goal(s).
  - Output (single): `Goal ID: <id> removed.`
  - Output (batch): `Removed <n> goals.`
  - Errors: `Error: Not found: goal id(s) not found: <id1>[, <id2> ...]`.
