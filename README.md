# opencode-planpilot

Planpilot for OpenCode. Provides plan/step/goal workflow with auto-continue for AI steps and a native `planpilot` tool.

## Features
- Plan/step/goal hierarchy with status auto-propagation upward (goals -> steps -> plan)
- SQLite storage with markdown plan snapshots
- Native OpenCode tool for plan/step/goal operations
- Auto-continue on `session.idle` when next step is assigned to `ai`
- Configurable auto-continue triggers for stop/pause/error events (with keyword filters)

## Install

Add to `opencode.json`:

```json
{
  "plugin": ["opencode-planpilot"]
}
```

OpenCode installs npm plugins automatically at startup.

## Studio Integration

- Studio manifest is generated at `dist/studio.manifest.json`.
- Bridge entrypoint is generated at `dist/studio-bridge.js` and is invoked by the manifest.
- Web mount assets are generated under `dist/studio-web/`.

The Studio bridge accepts JSON on stdin and returns a JSON envelope on stdout (`{ ok, data | error }`).

Key actions:

- `config.get`, `config.set`
- `runtime.snapshot`, `runtime.next`, `runtime.pause`, `runtime.resume`
- `plan.*`, `step.*`, `goal.*` (including `plan.createTree` / `plan.addTree`)
- `events.poll` for change cursors + event envelopes

Studio UI integration includes:

- `chat.sidebar` mount for runtime + next-step context
- `settings.panel` capability backed by plugin settings schema

## Configuration

Planpilot configuration comes from:

- Environment variables (to control where data/config is stored)
- An optional JSON config file (to control auto-continue behavior)

### Paths and environment variables

Planpilot stores all local state under a single directory (database, plan markdown snapshots, and the default config file).

- OpenCode config root
  - Default: `~/.config/opencode` (XDG config)
  - Override: `OPENCODE_CONFIG_DIR=/abs/path`
- Planpilot data directory
  - Default: `~/.config/opencode/.planpilot`
    - If `OPENCODE_CONFIG_DIR` is set, the default becomes `${OPENCODE_CONFIG_DIR}/.planpilot`.
  - Override: `OPENCODE_PLANPILOT_DIR=/abs/path` (or the legacy alias `OPENCODE_PLANPILOT_HOME`)
- Planpilot config file
  - Default: `~/.config/opencode/.planpilot/config.json`
    - If `OPENCODE_PLANPILOT_DIR` is set, the default becomes `${OPENCODE_PLANPILOT_DIR}/config.json`.
  - Override: `OPENCODE_PLANPILOT_CONFIG=/abs/path/to/config.json`
    - If a relative path is provided, it is resolved to an absolute path.

Data layout under the Planpilot data directory:

- `planpilot.db` - SQLite database (plans/steps/goals + active plan pointer)
- `plans/plan_<id>.md` - Markdown plan snapshots (kept in sync on write operations)

### Config load + validation behavior

- Missing config file: Planpilot falls back to defaults (idle-only triggers).
- Invalid JSON / invalid shape: Planpilot falls back to defaults and logs a load warning.
- Normalization:
  - Unknown fields are ignored.
  - String arrays are trimmed, empty strings removed, and duplicates de-duped.
  - Number arrays are filtered to finite numbers, truncated to integers, and de-duped.
  - Integers that must be positive (e.g. `maxAttempts`) fall back to defaults if invalid.

Note on live changes:

- The core plugin currently loads `autoContinue.*` once at initialization. If you change `autoContinue.*`, restart OpenCode (or reload the plugin) for the new values to take effect.
- `runtime.paused` is exposed via Studio and persisted to the config file, but the core auto-continue loop does not currently consult it.

### Config file schema

All fields are optional; missing values fall back to safe defaults.

Default config:

```json
{
  "autoContinue": {
    "sendRetry": {
      "enabled": true,
      "maxAttempts": 3,
      "delaysMs": [1500, 5000, 15000]
    },
    "onSessionError": {
      "enabled": false,
      "force": true,
      "keywords": {
        "any": [],
        "all": [],
        "none": [],
        "matchCase": false
      },
      "errorNames": [],
      "statusCodes": [],
      "retryableOnly": false
    },
    "onSessionRetry": {
      "enabled": false,
      "force": false,
      "keywords": {
        "any": [],
        "all": [],
        "none": [],
        "matchCase": false
      },
      "attemptAtLeast": 1
    },
    "onPermissionAsked": {
      "enabled": false,
      "force": false,
      "keywords": {
        "any": [],
        "all": [],
        "none": [],
        "matchCase": false
      }
    },
    "onPermissionRejected": {
      "enabled": false,
      "force": true,
      "keywords": {
        "any": [],
        "all": [],
        "none": [],
        "matchCase": false
      }
    },
    "onQuestionAsked": {
      "enabled": false,
      "force": false,
      "keywords": {
        "any": [],
        "all": [],
        "none": [],
        "matchCase": false
      }
    },
    "onQuestionRejected": {
      "enabled": false,
      "force": true,
      "keywords": {
        "any": [],
        "all": [],
        "none": [],
        "matchCase": false
      }
    }
  },
  "runtime": {
    "paused": false
  }
}
```

Notes:

- `session.idle` and `session.status=idle` are always auto-continue triggers and cannot be disabled.
- Additional triggers are optional and configured in:

- Default: `~/.config/opencode/.planpilot/config.json`
- Override path: `OPENCODE_PLANPILOT_CONFIG=/abs/path/to/config.json`

Example:

```json
{
  "autoContinue": {
    "sendRetry": {
      "enabled": true,
      "maxAttempts": 3,
      "delaysMs": [1500, 5000, 15000]
    },
    "onSessionError": {
      "enabled": true,
      "force": true,
      "errorNames": ["APIError", "UnknownError"],
      "statusCodes": [408, 429, 500, 502, 503, 504],
      "retryableOnly": true,
      "keywords": {
        "any": ["rate", "overload", "timeout"],
        "all": [],
        "none": ["aborted"],
        "matchCase": false
      }
    },
    "onSessionRetry": {
      "enabled": false,
      "force": false,
      "attemptAtLeast": 2,
      "keywords": {
        "any": ["overloaded", "rate"],
        "all": [],
        "none": [],
        "matchCase": false
      }
    },
    "onPermissionAsked": {
      "enabled": false,
      "force": false,
      "keywords": {
        "any": [],
        "all": [],
        "none": [],
        "matchCase": false
      }
    },
    "onPermissionRejected": {
      "enabled": true,
      "force": true,
      "keywords": {
        "any": ["write"],
        "all": [],
        "none": [],
        "matchCase": false
      }
    },
    "onQuestionAsked": {
      "enabled": false,
      "force": false,
      "keywords": {
        "any": [],
        "all": [],
        "none": [],
        "matchCase": false
      }
    },
    "onQuestionRejected": {
      "enabled": true,
      "force": true,
      "keywords": {
        "any": ["confirm"],
        "all": [],
        "none": [],
        "matchCase": false
      }
    }
  }
}
```

### Field reference

#### `runtime`

- `runtime.paused` (boolean)
  - Persisted to the config file and surfaced in Studio runtime snapshots.
  - Currently not used by the core auto-continue loop (see note above).

#### `autoContinue.sendRetry`

Controls retrying a failed auto-continue send (`session.promptAsync`).

- `enabled` (boolean): enable/disable retries.
- `maxAttempts` (integer, min 1): maximum number of attempts per plan/step signature.
- `delaysMs` (integer[], min 1): backoff delays in milliseconds.
  - Attempt 1 uses `delaysMs[0]`, attempt 2 uses `delaysMs[1]`, etc.
  - If attempts exceed the array length, the last delay is used.

#### Event rules (`autoContinue.on*`)

Event rules let Planpilot attempt an auto-continue send when a specific OpenCode event occurs.
Each rule has the same base shape:

- `enabled` (boolean): enable/disable the rule.
- `force` (boolean): bypass default safety guards when the rule matches.
  - Guards that `force=true` can bypass include:
    - last assistant message was aborted (`MessageAbortedError`)
    - last assistant message is not "ready" (e.g. finished with tool-calls)
- `keywords` (object): substring match rules against the event summary text.
  - `any`: if non-empty, at least one term must appear.
  - `all`: all terms must appear.
  - `none`: no terms may appear.
  - `matchCase`: case-sensitive matching when true.
  - If all arrays are empty, the keyword rule matches everything.

Event summary text is what keyword matching runs against:

- `onSessionError`: summary includes `error=<name>`, optional `status=<code>`, optional `retryable=<bool>`, plus message text.
- `onSessionRetry`: summary includes `attempt=<n>`, optional `next=<ms>`, plus message text.
- `onPermissionAsked`: summary includes `<permission>` and optional `patterns=a,b,c`.
- `onPermissionRejected`: summary includes the asked summary (if available), plus `request=<id> reply=reject`.
- `onQuestionAsked`: summary concatenates question `header` + `question` items (joined with ` | `).
- `onQuestionRejected`: summary includes the asked summary (if available), plus `request=<id> question=rejected`.

Event-specific fields:

- `autoContinue.onSessionError`
  - `errorNames` (string[]): if non-empty, only match when `error.name` is in the list.
  - `statusCodes` (integer[]): if non-empty, only match when `error.data.statusCode` is in the list.
  - `retryableOnly` (boolean): when true, only match when `error.data.isRetryable === true`.
- `autoContinue.onSessionRetry`
  - `attemptAtLeast` (integer, min 1): only match when `status.attempt >= attemptAtLeast`.

### Operational notes (non-configurable behavior)

- `session.idle` / `session.status=idle` always triggers an auto-continue check and cannot be disabled.
- Auto-continue only sends when an active plan exists and its next pending step has `executor="ai"`.
- Step wait annotations
  - `planpilot step wait <step_id> --delay <ms> [--reason <text>]` stores wait markers in the step comment:
    - `@wait-until=<epoch_ms>`
    - `@wait-reason=<text>`
  - When present, Planpilot will delay auto-sending that step until the timestamp.
- Manual-stop protection
  - If OpenCode emits `MessageAbortedError`, Planpilot arms a manual-stop guard.
  - While active: queued triggers/retries are canceled and auto-sends are suppressed.
  - The guard is cleared when a new user message arrives.

### How to modify configuration

- Edit the JSON file directly
  - Default path: `~/.config/opencode/.planpilot/config.json`
  - Or set `OPENCODE_PLANPILOT_CONFIG` to use a different file.
- Use OpenCode Studio
  - The Studio settings panel uses bridge actions `config.get` / `config.set`.
  - The runtime toggle uses `runtime.pause` / `runtime.resume` (persists `runtime.paused`).

### Studio settings panel mapping (settingsSchema)

Planpilot advertises the `settings.panel` capability and ships a JSON Schema in `dist/studio.manifest.json` under `settingsSchema`.
OpenCode Studio uses this schema to render the settings form.

The schema is authored in `tsup.config.ts` and written into the generated Studio manifest at build time.

The settings panel fields map 1:1 to the config file object. The UI group/label corresponds to a config path like `autoContinue.onSessionError.keywords.any`.

Top-level groups:

- `Runtime` -> `runtime`
- `Auto continue` -> `autoContinue`

#### Runtime

- `Runtime > Paused` -> `runtime.paused` (boolean, default `false`)

#### Auto continue

Retry failed sends:

- `Auto continue > Retry failed sends > Enabled` -> `autoContinue.sendRetry.enabled` (boolean, default `true`)
- `Auto continue > Retry failed sends > Max attempts` -> `autoContinue.sendRetry.maxAttempts` (integer, minimum `1`, default `3`)
- `Auto continue > Retry failed sends > Delays (ms)` -> `autoContinue.sendRetry.delaysMs` (integer[], items minimum `1`, default `[1500, 5000, 15000]`)

Session error trigger:

- `Auto continue > On session error > Enabled` -> `autoContinue.onSessionError.enabled` (boolean, default `false`)
- `Auto continue > On session error > Force` -> `autoContinue.onSessionError.force` (boolean, default `true`)
- `Auto continue > On session error > Keywords > Any` -> `autoContinue.onSessionError.keywords.any` (string[], default `[]`)
- `Auto continue > On session error > Keywords > All` -> `autoContinue.onSessionError.keywords.all` (string[], default `[]`)
- `Auto continue > On session error > Keywords > None` -> `autoContinue.onSessionError.keywords.none` (string[], default `[]`)
- `Auto continue > On session error > Keywords > Match case` -> `autoContinue.onSessionError.keywords.matchCase` (boolean, default `false`)
- `Auto continue > On session error > Error names` -> `autoContinue.onSessionError.errorNames` (string[], default `[]`)
- `Auto continue > On session error > Status codes` -> `autoContinue.onSessionError.statusCodes` (integer[], default `[]`)
- `Auto continue > On session error > Retryable only` -> `autoContinue.onSessionError.retryableOnly` (boolean, default `false`)

Session retry trigger:

- `Auto continue > On session retry > Enabled` -> `autoContinue.onSessionRetry.enabled` (boolean, default `false`)
- `Auto continue > On session retry > Force` -> `autoContinue.onSessionRetry.force` (boolean, default `false`)
- `Auto continue > On session retry > Keywords > Any` -> `autoContinue.onSessionRetry.keywords.any` (string[], default `[]`)
- `Auto continue > On session retry > Keywords > All` -> `autoContinue.onSessionRetry.keywords.all` (string[], default `[]`)
- `Auto continue > On session retry > Keywords > None` -> `autoContinue.onSessionRetry.keywords.none` (string[], default `[]`)
- `Auto continue > On session retry > Keywords > Match case` -> `autoContinue.onSessionRetry.keywords.matchCase` (boolean, default `false`)
- `Auto continue > On session retry > Attempt at least` -> `autoContinue.onSessionRetry.attemptAtLeast` (integer, minimum `1`, default `1`)

Permission triggers:

- `Auto continue > On permission asked > Enabled` -> `autoContinue.onPermissionAsked.enabled` (boolean, default `false`)
- `Auto continue > On permission asked > Force` -> `autoContinue.onPermissionAsked.force` (boolean, default `false`)
- `Auto continue > On permission asked > Keywords > Any` -> `autoContinue.onPermissionAsked.keywords.any` (string[], default `[]`)
- `Auto continue > On permission asked > Keywords > All` -> `autoContinue.onPermissionAsked.keywords.all` (string[], default `[]`)
- `Auto continue > On permission asked > Keywords > None` -> `autoContinue.onPermissionAsked.keywords.none` (string[], default `[]`)
- `Auto continue > On permission asked > Keywords > Match case` -> `autoContinue.onPermissionAsked.keywords.matchCase` (boolean, default `false`)

- `Auto continue > On permission rejected > Enabled` -> `autoContinue.onPermissionRejected.enabled` (boolean, default `false`)
- `Auto continue > On permission rejected > Force` -> `autoContinue.onPermissionRejected.force` (boolean, default `true`)
- `Auto continue > On permission rejected > Keywords > Any` -> `autoContinue.onPermissionRejected.keywords.any` (string[], default `[]`)
- `Auto continue > On permission rejected > Keywords > All` -> `autoContinue.onPermissionRejected.keywords.all` (string[], default `[]`)
- `Auto continue > On permission rejected > Keywords > None` -> `autoContinue.onPermissionRejected.keywords.none` (string[], default `[]`)
- `Auto continue > On permission rejected > Keywords > Match case` -> `autoContinue.onPermissionRejected.keywords.matchCase` (boolean, default `false`)

Question triggers:

- `Auto continue > On question asked > Enabled` -> `autoContinue.onQuestionAsked.enabled` (boolean, default `false`)
- `Auto continue > On question asked > Force` -> `autoContinue.onQuestionAsked.force` (boolean, default `false`)
- `Auto continue > On question asked > Keywords > Any` -> `autoContinue.onQuestionAsked.keywords.any` (string[], default `[]`)
- `Auto continue > On question asked > Keywords > All` -> `autoContinue.onQuestionAsked.keywords.all` (string[], default `[]`)
- `Auto continue > On question asked > Keywords > None` -> `autoContinue.onQuestionAsked.keywords.none` (string[], default `[]`)
- `Auto continue > On question asked > Keywords > Match case` -> `autoContinue.onQuestionAsked.keywords.matchCase` (boolean, default `false`)

- `Auto continue > On question rejected > Enabled` -> `autoContinue.onQuestionRejected.enabled` (boolean, default `false`)
- `Auto continue > On question rejected > Force` -> `autoContinue.onQuestionRejected.force` (boolean, default `true`)
- `Auto continue > On question rejected > Keywords > Any` -> `autoContinue.onQuestionRejected.keywords.any` (string[], default `[]`)
- `Auto continue > On question rejected > Keywords > All` -> `autoContinue.onQuestionRejected.keywords.all` (string[], default `[]`)
- `Auto continue > On question rejected > Keywords > None` -> `autoContinue.onQuestionRejected.keywords.none` (string[], default `[]`)
- `Auto continue > On question rejected > Keywords > Match case` -> `autoContinue.onQuestionRejected.keywords.matchCase` (boolean, default `false`)

Notes:

- Studio persists settings by calling `config.set` and Planpilot writes the normalized config to the resolved config path.
- `runtime.pause` / `runtime.resume` also persist `runtime.paused` (and are used by the bundled runtime UI), but are separate from the settings panel.

## License
MIT
