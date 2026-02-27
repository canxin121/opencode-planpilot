# Planpilot Details

Chinese version: [DETAIL.zh-CN.md](DETAIL.zh-CN.md)

This document keeps low-level details out of the main README.
For onboarding and daily usage, start with `README.md`.

## Runtime Model

- Hierarchy: `plan -> step -> goal`.
- Status propagation:
  - A step with goals is `done` only when all goals are `done`.
  - A plan is `done` only when all steps are `done`.
- Auto-continue runs when OpenCode is idle and the active plan's next pending step has `executor="ai"`.

## Tool Surface (High-Level)

Namespaces:

- `plan`: lifecycle, search, active-plan control.
- `step`: ordering, executor assignment, wait markers.
- `goal`: verification checkpoints under a step.

Key operations used by agents:

- `plan add-tree`, `plan activate`, `plan show-active`, `plan deactivate`
- `step show-next`, `step done`, `step wait`
- `goal done`

## Auto-Continue Notes

- `session.idle` is always a trigger and cannot be disabled.
- Optional event-based triggers can be enabled in config (`onSessionError`, `onSessionRetry`, permission/question events).
- `step wait <id> --delay <ms>` writes wait markers in the step comment and delays dispatch until the timestamp.
- Manual-stop protection suppresses queued auto-sends after `MessageAbortedError` until a new user message arrives.

## Path Resolution and Environment Variables

Planpilot stores local state under a single data directory.

- OpenCode config root
  - Default: `~/.config/opencode`
  - Override: `OPENCODE_CONFIG_DIR=/abs/path`
- Planpilot data directory
  - Default: `~/.config/opencode/.planpilot`
  - Override: `OPENCODE_PLANPILOT_DIR=/abs/path`
  - Legacy alias: `OPENCODE_PLANPILOT_HOME=/abs/path`
- Planpilot config file
  - Default: `<planpilot_dir>/config.json`
  - Override: `OPENCODE_PLANPILOT_CONFIG=/abs/path/to/config.json`

Data layout:

- `planpilot.db`: SQLite data store.
- `plans/plan_<id>.md`: markdown snapshots.

## Default Configuration

All fields are optional; missing or invalid values fall back to defaults.

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

Validation behavior:

- Unknown fields are ignored.
- String arrays are trimmed and deduplicated.
- Number arrays keep finite integers only, then deduplicate.
- Required positive integers fall back to defaults if invalid.

Runtime note:

- `runtime.paused` is persisted and exposed through Studio.
- Current core auto-continue behavior is driven primarily by trigger/rule matching and active-step eligibility.

## Event Rule Shape

Each optional `autoContinue.on*` rule supports:

- `enabled`: enable the rule.
- `force`: bypass default safety guards for matched events.
- `keywords`: text filters with `any`, `all`, `none`, and `matchCase`.

Event-specific filters:

- `onSessionError`: `errorNames`, `statusCodes`, `retryableOnly`.
- `onSessionRetry`: `attemptAtLeast`.

## Studio Bridge Contract

Build artifacts:

- Manifest: `dist/studio.manifest.json`
- Bridge entry: `dist/studio-bridge.js`
- Web mount assets: `dist/studio-web/`

Bridge IO contract:

- Input: JSON via stdin.
- Output: JSON envelope via stdout: `{ ok, data | error }`.

Common action groups:

- `config.get`, `config.set`
- `runtime.snapshot`, `runtime.next`, `runtime.pause`, `runtime.resume`
- `plan.*`, `step.*`, `goal.*` (including tree helpers)
- `events.poll`

Studio capabilities:

- `chat.sidebar` mount for runtime + next-step context.
- `settings.panel` backed by the plugin settings schema.

## Settings Schema Mapping

- The Studio settings form is generated from `settingsSchema` in the manifest.
- Field paths map directly to config keys (for example `autoContinue.onSessionError.keywords.any`).
- `config.set` writes normalized config back to the resolved config file path.
