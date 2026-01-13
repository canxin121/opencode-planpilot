export type AppErrorKind = "InvalidInput" | "NotFound" | "Db" | "Io" | "Json"

export class AppError extends Error {
  public readonly kind: AppErrorKind
  public readonly detail: string

  constructor(kind: AppErrorKind, detail: string) {
    super(detail)
    this.kind = kind
    this.detail = detail
  }

  toDisplayString(): string {
    const label = this.kind === "InvalidInput" ? "Invalid input" : this.kind === "NotFound" ? "Not found" : null
    if (!label) {
      return this.detail
    }
    if (this.detail.includes("\n")) {
      return `${label}:\n${this.detail}`
    }
    return `${label}: ${this.detail}`
  }
}

export function invalidInput(message: string): AppError {
  return new AppError("InvalidInput", message)
}

export function notFound(message: string): AppError {
  return new AppError("NotFound", message)
}

export function wrapDbError(message: string, err: unknown): AppError {
  const detail = err instanceof Error ? `${message}: ${err.message}` : message
  return new AppError("Db", detail)
}
