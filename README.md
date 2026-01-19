# opencode-planpilot

Planpilot for OpenCode. Provides plan/step/goal workflow with auto-continue for AI steps and a native `planpilot` tool.

## Features
- Plan/step/goal hierarchy with status auto-propagation upward (goals -> steps -> plan)
- SQLite storage with markdown plan snapshots
- Native OpenCode tool for plan/step/goal operations
- Auto-continue on `session.idle` when next step is assigned to `ai`

## Install

Add to `opencode.json`:

```json
{
  "plugin": ["opencode-planpilot"]
}
```

OpenCode installs npm plugins automatically at startup.

## License
MIT
