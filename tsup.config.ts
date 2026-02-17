import fs from "fs/promises"
import path from "path"
import { defineConfig } from "tsup"
import packageJson from "./package.json"

const keywordRuleSchema = {
  title: "Keywords",
  description: "Match rules for deciding whether to trigger.",
  type: "object",
  properties: {
    any: {
      title: "Any",
      description: "Trigger when any keyword matches (empty = no requirement).",
      type: "array",
      items: { type: "string" },
      default: [],
    },
    all: {
      title: "All",
      description: "Trigger only when all keywords match (empty = no requirement).",
      type: "array",
      items: { type: "string" },
      default: [],
    },
    none: {
      title: "None",
      description: "Do not trigger when any of these keywords match.",
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

const studioManifest = {
  studioApiVersion: 1,
  id: "opencode-planpilot",
  displayName: "Planpilot",
  version: packageJson.version,
  bridge: {
    command: ["bun", "dist/studio-bridge.js"],
  },
  capabilities: ["settings.panel", "events.poll"],
  events: {
    pollIntervalMs: 1200,
  },
  settingsSchema: {
    type: "object",
    properties: {
      autoContinue: {
        title: "Auto continue",
        description: "Rules for automatically continuing when the session becomes idle.",
        type: "object",
        properties: {
          sendRetry: {
            title: "Send retry",
            description: "Retry auto-continue sends that fail transiently.",
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
            description: "Trigger when a session reports an error.",
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
            description: "Trigger when the session enters retry state.",
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
            description: "Trigger when the assistant asks for permission.",
            ...eventRuleSchema,
          },
          onPermissionRejected: {
            title: "On permission rejected",
            description: "Trigger after a permission request is rejected.",
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
            description: "Trigger when the assistant asks a question.",
            ...eventRuleSchema,
          },
          onQuestionRejected: {
            title: "On question rejected",
            description: "Trigger after a question is rejected.",
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

async function removeLegacyStudioWebAssets() {
  // Planpilot used to ship a standalone panel UI under dist/studio-web.
  // Ensure legacy build artifacts are removed even if the output cleaner
  // doesn't delete empty directories.
  const legacyDir = path.resolve("dist/studio-web")
  await fs.rm(legacyDir, { recursive: true, force: true }).catch(() => {})
}

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "studio-bridge": "src/studio/bridge.ts",
  },
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  splitting: false,
  external: ["bun:sqlite", "xdg-basedir", "@opencode-ai/plugin"],
  onSuccess: async () => {
    await writeStudioManifest()
    await removeLegacyStudioWebAssets()
  },
})
