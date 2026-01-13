# opencode-planpilot

Planpilot rewritten in TypeScript for OpenCode. Provides plan/step/goal workflow with auto-continue for AI steps and a native `planpilot` tool.

## Features
- Plan/step/goal hierarchy with automatic status rollups
- SQLite storage with markdown plan snapshots
- Native OpenCode tool plus optional CLI
- Auto-continue on `session.idle` when next step is assigned to `ai`

## Requirements
- Bun runtime (uses `bun:sqlite` at runtime)

## Install

Add to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-planpilot"]
}
```

OpenCode installs npm plugins automatically at startup.

## Details
Usage and storage info: `docs/planpilot.md`

## License
MIT
