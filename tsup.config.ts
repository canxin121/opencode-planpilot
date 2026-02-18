import fs from "fs/promises"
import path from "path"
import { defineConfig } from "tsup"
import packageJson from "./package.json"

const keywordRuleSchema = {
  title: "Keywords",
  description: "Match rules against the event summary text.",
  type: "object",
  properties: {
    any: {
      title: "Any",
      description:
        "Trigger when any keyword matches the event summary text. Leave empty to ignore.",
      type: "array",
      items: { type: "string" },
      default: [],
    },
    all: {
      title: "All",
      description:
        "Trigger only when all keywords match the event summary text. Leave empty to ignore.",
      type: "array",
      items: { type: "string" },
      default: [],
    },
    none: {
      title: "None",
      description:
        "Do not trigger if any keyword matches the event summary text.",
      type: "array",
      items: { type: "string" },
      default: [],
    },
    matchCase: {
      title: "Match case",
      description: "Use case-sensitive matching.",
      type: "boolean",
      default: false,
    },
  },
  additionalProperties: false,
}

const eventRuleSchema = {
  type: "object",
  properties: {
    enabled: {
      title: "Enabled",
      description: "Enable this trigger.",
      type: "boolean",
      default: false,
    },
    force: {
      title: "Force",
      description: "Force auto-continue even when a guard would normally block it.",
      type: "boolean",
      default: false,
    },
    keywords: keywordRuleSchema,
  },
  additionalProperties: false,
}

const studioWebEntry = "studio-web/planpilot-todo-bar.js"

const studioManifest = {
  studioApiVersion: 1,
  id: "opencode-planpilot",
  displayName: "Planpilot",
  version: packageJson.version,
  bridge: {
    command: ["bun", "dist/studio-bridge.js"],
  },
  ui: {
    mode: "module",
    assetsDir: "dist",
    entry: studioWebEntry,
  },
  mounts: [
    {
      surface: "chat.overlay.bottom",
      title: "Planpilot",
      entry: studioWebEntry,
      mode: "module",
    },
  ],
  capabilities: ["settings.panel", "events.poll"],
  events: {
    pollIntervalMs: 1200,
  },
  settingsSchema: {
    type: "object",
    properties: {
      runtime: {
        title: "Runtime",
        description: "Operational switches for Planpilot.",
        type: "object",
        properties: {
          paused: {
            title: "Paused",
            description: "Pause auto-continue in this OpenCode instance.",
            type: "boolean",
            default: false,
          },
        },
        additionalProperties: false,
      },
      autoContinue: {
        title: "Auto continue",
        description: "Rules for automatically continuing when the session becomes idle.",
        type: "object",
        properties: {
          sendRetry: {
            title: "Retry failed sends",
            description: "Retry auto-continue sends that fail (e.g. transient errors).",
            type: "object",
            properties: {
              enabled: {
                title: "Enabled",
                description: "Enable retries for failed auto-continue sends.",
                type: "boolean",
                default: true,
              },
              maxAttempts: {
                title: "Max attempts",
                description: "Maximum number of retry attempts.",
                type: "integer",
                minimum: 1,
                default: 3,
              },
              delaysMs: {
                title: "Delays (ms)",
                description: "Retry delays in milliseconds.",
                type: "array",
                items: { type: "integer", minimum: 1 },
                default: [1500, 5000, 15000],
              },
            },
            additionalProperties: false,
          },
          onSessionError: {
            title: "On session error",
            description: "Trigger when the session errors.",
            type: "object",
            properties: {
              enabled: {
                title: "Enabled",
                description: "Enable auto-continue triggers on session errors.",
                type: "boolean",
                default: false,
              },
              force: {
                title: "Force",
                description: "Force auto-continue when this trigger matches.",
                type: "boolean",
                default: true,
              },
              keywords: keywordRuleSchema,
              errorNames: {
                title: "Error names",
                description: "Optional list of error.name values to match.",
                type: "array",
                items: { type: "string" },
                default: [],
              },
              statusCodes: {
                title: "Status codes",
                description: "Optional list of HTTP status codes to match.",
                type: "array",
                items: { type: "integer" },
                default: [],
              },
              retryableOnly: {
                title: "Retryable only",
                description: "Only trigger when the error is marked retryable.",
                type: "boolean",
                default: false,
              },
            },
            additionalProperties: false,
          },
          onSessionRetry: {
            title: "On session retry",
            description: "Trigger when the session retries.",
            type: "object",
            properties: {
              enabled: {
                title: "Enabled",
                description: "Enable auto-continue triggers on session retry.",
                type: "boolean",
                default: false,
              },
              force: {
                title: "Force",
                description: "Force auto-continue when this trigger matches.",
                type: "boolean",
                default: false,
              },
              keywords: keywordRuleSchema,
              attemptAtLeast: {
                title: "Attempt at least",
                description: "Only trigger when retry attempt is at least this value.",
                type: "integer",
                minimum: 1,
                default: 1,
              },
            },
            additionalProperties: false,
          },
          onPermissionAsked: {
            title: "On permission asked",
            description: "Trigger when a permission is requested.",
            ...eventRuleSchema,
          },
          onPermissionRejected: {
            title: "On permission rejected",
            description: "Trigger when a permission request is rejected.",
            ...eventRuleSchema,
            properties: {
              enabled: {
                title: "Enabled",
                description: "Enable this trigger.",
                type: "boolean",
                default: false,
              },
              force: {
                title: "Force",
                description: "Force auto-continue when this trigger matches.",
                type: "boolean",
                default: true,
              },
              keywords: keywordRuleSchema,
            },
          },
          onQuestionAsked: {
            title: "On question asked",
            description: "Trigger when a question is asked.",
            ...eventRuleSchema,
          },
          onQuestionRejected: {
            title: "On question rejected",
            description: "Trigger when a question is rejected.",
            ...eventRuleSchema,
            properties: {
              enabled: {
                title: "Enabled",
                description: "Enable this trigger.",
                type: "boolean",
                default: false,
              },
              force: {
                title: "Force",
                description: "Force auto-continue when this trigger matches.",
                type: "boolean",
                default: true,
              },
              keywords: keywordRuleSchema,
            },
          },
        },
        additionalProperties: false,
      },
    },
    additionalProperties: false,
  },
}

async function writeStudioManifest() {
  const distDir = path.resolve("dist")
  const manifestPath = path.join(distDir, "studio.manifest.json")
  await fs.mkdir(distDir, { recursive: true })
  await fs.writeFile(manifestPath, `${JSON.stringify(studioManifest, null, 2)}\n`, "utf8")
}

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "studio-bridge": "src/studio/bridge.ts",
    "studio-web/planpilot-todo-bar": "src/studio-web/planpilot-todo-bar.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  external: ["bun:sqlite", "xdg-basedir", "@opencode-ai/plugin"],
  onSuccess: async () => {
    await writeStudioManifest()
  },
})
