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

## Auto-Continue Config

`session.idle` and `session.status=idle` are always auto-continue triggers and cannot be disabled.

Additional triggers are optional and configured in:

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

Notes:

- `force=true` means the trigger can bypass the default `ready/aborted` guards.
- Keyword matching applies to trigger context text; leave arrays empty to match all.
- `sendRetry` retries failed `prompt_async` sends with backoff (`maxAttempts` + `delaysMs`).
- Manual stop protection: if OpenCode emits `MessageAbortedError`, Planpilot cancels queued retries and pauses auto-send until a new user message appears.
- Invalid/missing config falls back to safe defaults (idle-only behavior).

## License
MIT
