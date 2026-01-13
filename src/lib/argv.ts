import { invalidInput } from "./errors"

export function parseCommandArgs(input: string): string[] {
  const args: string[] = []
  let current = ""
  let inSingle = false
  let inDouble = false
  let escapeNext = false

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]

    if (escapeNext) {
      current += ch
      escapeNext = false
      continue
    }

    if (ch === "\\" && !inSingle) {
      escapeNext = true
      continue
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }

    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (current.length) {
        args.push(current)
        current = ""
      }
      continue
    }

    current += ch
  }

  if (escapeNext) {
    current += "\\"
  }

  if (inSingle || inDouble) {
    throw invalidInput("unterminated quote in command")
  }

  if (current.length) {
    args.push(current)
  }

  return args
}
