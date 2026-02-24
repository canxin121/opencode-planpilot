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

const zhCnText: Record<string, string> = {
  Planpilot: "计划领航",
  Keywords: "关键词",
  "Match rules against the event summary text.": "根据事件摘要文本匹配规则。",
  Any: "任意",
  "Trigger when any keyword matches the event summary text. Leave empty to ignore.":
    "当任意关键词匹配事件摘要文本时触发。留空则忽略。",
  All: "全部",
  "Trigger only when all keywords match the event summary text. Leave empty to ignore.":
    "仅当所有关键词都匹配事件摘要文本时触发。留空则忽略。",
  None: "无",
  "Do not trigger if any keyword matches the event summary text.": "如果任意关键词匹配事件摘要文本则不触发。",
  "Match case": "区分大小写",
  "Use case-sensitive matching.": "使用区分大小写匹配。",
  Enabled: "启用",
  "Enable this trigger.": "启用此触发器。",
  Force: "强制",
  "Force auto-continue even when a guard would normally block it.":
    "即使守卫通常会阻止，也强制自动继续。",
  Runtime: "运行时",
  "Operational switches for Planpilot.": "Planpilot 的运行开关。",
  Paused: "已暂停",
  "Pause auto-continue in this OpenCode instance.": "在此 OpenCode 实例中暂停自动继续。",
  "Auto continue": "自动继续",
  "Rules for automatically continuing when the session becomes idle.": "会话空闲时自动继续的规则。",
  "Retry failed sends": "重试发送失败",
  "Retry auto-continue sends that fail (e.g. transient errors).":
    "重试失败的自动继续发送（例如瞬时错误）。",
  "Enable retries for failed auto-continue sends.": "为失败的自动继续发送启用重试。",
  "Max attempts": "最大尝试次数",
  "Maximum number of retry attempts.": "重试尝试的最大次数。",
  "Delays (ms)": "延迟（毫秒）",
  "Retry delays in milliseconds.": "以毫秒为单位的重试延迟。",
  "On session error": "会话错误时",
  "Trigger when the session errors.": "当会话报错时触发。",
  "Enable auto-continue triggers on session errors.": "在会话错误时启用自动继续触发。",
  "Force auto-continue when this trigger matches.": "当此触发器匹配时强制自动继续。",
  "Error names": "错误名称",
  "Optional list of error.name values to match.": "要匹配的 error.name 可选列表。",
  "Status codes": "状态码",
  "Optional list of HTTP status codes to match.": "要匹配的 HTTP 状态码可选列表。",
  "Retryable only": "仅可重试",
  "Only trigger when the error is marked retryable.": "仅在错误被标记为可重试时触发。",
  "On session retry": "会话重试时",
  "Trigger when the session retries.": "当会话重试时触发。",
  "Enable auto-continue triggers on session retry.": "在会话重试时启用自动继续触发。",
  "Attempt at least": "最少尝试次数",
  "Only trigger when retry attempt is at least this value.": "仅当重试次数至少达到该值时触发。",
  "On permission asked": "请求权限时",
  "Trigger when a permission is requested.": "请求权限时触发。",
  "On permission rejected": "权限被拒绝时",
  "Trigger when a permission request is rejected.": "权限请求被拒绝时触发。",
  "On question asked": "提出问题时",
  "Trigger when a question is asked.": "提出问题时触发。",
  "On question rejected": "问题被拒绝时",
  "Trigger when a question is rejected.": "问题被拒绝时触发。",
}

function toZhCn(text: string): string {
  return zhCnText[text] ?? text
}

function addSchemaI18n<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => addSchemaI18n(item)) as T
  }
  if (!value || typeof value !== "object") {
    return value
  }

  const source = value as Record<string, unknown>
  const copy: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(source)) {
    copy[key] = addSchemaI18n(child)
  }

  if (typeof source.title === "string") {
    copy["x-title-i18n"] = {
      "en-US": source.title,
      "zh-CN": toZhCn(source.title),
    }
  }
  if (typeof source.description === "string") {
    copy["x-description-i18n"] = {
      "en-US": source.description,
      "zh-CN": toZhCn(source.description),
    }
  }

  return copy as T
}

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
      titleI18n: {
        "en-US": "Planpilot",
        "zh-CN": toZhCn("Planpilot"),
      },
      entry: studioWebEntry,
      mode: "module",
    },
  ],
  capabilities: ["settings.panel", "events.poll"],
  events: {
    pollIntervalMs: 1200,
  },
  settingsSchema: addSchemaI18n({
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
  }),
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
