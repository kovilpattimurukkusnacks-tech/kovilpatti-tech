/**
 * Typed error classes mapped from BE HTTP responses.
 * Pages / hooks `instanceof` against these to render user-friendly messages.
 */

export class ApiError extends Error {
  status: number
  body?: unknown

  constructor(status: number, message: string, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export class UnauthorizedError extends ApiError {
  constructor(body?: unknown) {
    super(401, 'Unauthorized — please sign in again.', body)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends ApiError {
  constructor(body?: unknown) {
    super(403, 'Forbidden — you do not have access.', body)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends ApiError {
  constructor(body?: unknown) {
    super(404, 'Not found.', body)
    this.name = 'NotFoundError'
  }
}

/**
 * 400 — request validation failed.
 * BE shape: { error: 'Validation failed', errors: { fieldName: ['msg', ...] } }
 */
export class ValidationError extends ApiError {
  errors: Record<string, string[]>

  constructor(body?: unknown) {
    const b = (body ?? {}) as { error?: string; errors?: Record<string, string[]> }
    super(400, b.error ?? 'Validation failed.', body)
    this.name = 'ValidationError'
    this.errors = b.errors ?? {}
  }

  /** Flatten all field errors into one human-readable string. */
  flatten(): string {
    const lines = Object.entries(this.errors)
      .flatMap(([field, msgs]) => msgs.map(m => `${field}: ${m}`))
    return lines.length > 0 ? lines.join('\n') : this.message
  }
}
