import { afterEach, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

type BridgeResponse =
  | {
      ok: true
      data: any
    }
  | {
      ok: false
      error: {
        code: string
        message: string
        details: unknown
      }
    }

const REPO_ROOT = path.resolve(import.meta.dir, "..")
const sandboxes: string[] = []

afterEach(() => {
  while (sandboxes.length) {
    const dir = sandboxes.pop()
    if (dir) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

function makeSandbox(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "planpilot-bridge-test-"))
  sandboxes.push(dir)
  return dir
}

function callBridge(planpilotDir: string, action: string, payload?: unknown): BridgeResponse {
  const result = spawnSync("bun", ["run", "src/studio/bridge.ts"], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      OPENCODE_PLANPILOT_DIR: planpilotDir,
    },
    input: JSON.stringify({ action, payload }),
    encoding: "utf8",
  })

  expect(result.status).toBe(0)
  expect(result.error).toBeUndefined()

  const output = result.stdout.trim()
  expect(output.length).toBeGreaterThan(0)

  try {
    return JSON.parse(output) as BridgeResponse
  } catch {
    throw new Error(`bridge returned non-JSON output: ${output}\nstderr: ${result.stderr}`)
  }
}

function assertOk(response: BridgeResponse): asserts response is Extract<BridgeResponse, { ok: true }> {
  if (!response.ok) {
    throw new Error(`bridge call failed (${response.error.code}): ${response.error.message}`)
  }
}

describe("studio bridge contracts", () => {
  test("config.set + config.get roundtrip", () => {
    const sandbox = makeSandbox()
    const expectedPaused = true

    const setResponse = callBridge(sandbox, "config.set", {
      config: {
        runtime: {
          paused: expectedPaused,
        },
      },
    })
    assertOk(setResponse)
    expect(setResponse.data.config.runtime.paused).toBe(expectedPaused)

    const getResponse = callBridge(sandbox, "config.get")
    assertOk(getResponse)
    expect(getResponse.data.runtime.paused).toBe(expectedPaused)
  })

  test("plan.createTree + plan.list/plan.get basic roundtrip", () => {
    const sandbox = makeSandbox()
    const createResponse = callBridge(sandbox, "plan.createTree", {
      title: "Integration plan",
      content: "Validate bridge roundtrip",
      steps: [
        {
          content: "Create a step",
          goals: ["Create a goal"],
        },
      ],
    })
    assertOk(createResponse)

    const planId = createResponse.data.plan.id
    expect(typeof planId).toBe("number")

    const listResponse = callBridge(sandbox, "plan.list", {})
    assertOk(listResponse)
    expect(Array.isArray(listResponse.data)).toBe(true)
    expect(listResponse.data.length).toBe(1)
    expect(listResponse.data[0].id).toBe(planId)

    const getResponse = callBridge(sandbox, "plan.get", { id: planId })
    assertOk(getResponse)
    expect(getResponse.data.plan.id).toBe(planId)
    expect(getResponse.data.steps.length).toBe(1)
    expect(getResponse.data.goals.length).toBe(1)
  })

  test("events.poll returns cursor/events envelope", () => {
    const sandbox = makeSandbox()

    const firstPoll = callBridge(sandbox, "events.poll", { cursor: "" })
    assertOk(firstPoll)
    expect(typeof firstPoll.data.cursor).toBe("string")
    expect(Array.isArray(firstPoll.data.events)).toBe(true)
    expect(firstPoll.data.events.length).toBe(1)
    expect(firstPoll.data.events[0].event).toBe("planpilot.runtime.changed")

    const secondPoll = callBridge(sandbox, "events.poll", { cursor: firstPoll.data.cursor })
    assertOk(secondPoll)
    expect(secondPoll.data.cursor).toBe(firstPoll.data.cursor)
    expect(Array.isArray(secondPoll.data.events)).toBe(true)
  })
})
