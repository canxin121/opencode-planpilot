# opencode-planpilot

Chinese version: [README.zh-CN.md](README.zh-CN.md)

Planpilot adds a structured execution loop to OpenCode so multi-step work stays organized, visible, and easier to complete.

## Why Teams Use Planpilot

- Turn complex work into a clear `plan -> step -> goal` workflow.
- Keep momentum by auto-continuing when the next pending step is assigned to `ai`.
- Persist progress locally (database + markdown snapshots) so context is never lost.
- Keep collaboration natural: you describe intent in plain language, and Planpilot keeps execution structured.

## Installation

Add the plugin to your OpenCode config file `opencode.json`:

- Unix/macOS: `~/.config/opencode/opencode.json`
- Windows: `%USERPROFILE%\\.config\\opencode\\opencode.json` (for example: `C:\\Users\\<your-user>\\.config\\opencode\\opencode.json`)

```jsonc
{
  "plugin": ["opencode-planpilot"]
}
```

OpenCode installs npm plugins automatically when the session starts.

## Quick Start with Natural Language

Example prompt:

```text
Use planpilot.
```

## OpenCode Studio Experience

Planpilot ships first-class OpenCode Studio integration:

- Learn more: [opencode-studio](https://github.com/canxin121/opencode-studio)

- Runtime context in the Studio sidebar (active plan, next step, progress state).
- A Studio settings panel for Planpilot runtime and auto-continue controls.
- A Studio bridge for reading/writing runtime and configuration state.

If you already run multi-step work in OpenCode, using OpenCode Studio is the fastest way to monitor flow, tune behavior, and keep your team aligned from one UI.

## Details

Detailed configuration schema, bridge actions, parameter-level behavior, and event/trigger rules are documented in `DETAIL.md`.

## License

MIT
