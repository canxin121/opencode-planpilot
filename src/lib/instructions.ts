import fs from "fs"
import path from "path"
import { fileURLToPath } from "url"

let cached: string | null = null

export function loadPlanpilotInstructions(): string {
  if (cached !== null) return cached
  try {
    const moduleDir = path.dirname(fileURLToPath(import.meta.url))
    const candidates = [
      path.resolve(moduleDir, "../../docs/planpilot.md"),
      path.resolve(moduleDir, "../../../docs/planpilot.md"),
    ]
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        cached = fs.readFileSync(candidate, "utf8")
        return cached
      }
    }
    cached = ""
  } catch {
    cached = ""
  }
  return cached
}
