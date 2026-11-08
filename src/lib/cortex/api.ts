/**
 * Daemon API helpers — uniform JSON envelopes, zod validation and
 * error mapping for every cortexd endpoint.
 */
import { NextResponse } from 'next/server'
import type { ZodType } from 'zod'

export function ok<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data as object, init)
}

export function fail(message: string, status = 400, details?: unknown): NextResponse {
  return NextResponse.json({ error: message, details: details ?? null }, { status })
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.status = status
  }
}

export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new ApiError('Request body must be valid JSON', 400)
  }
  const result = schema.safeParse(raw)
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')
    throw new ApiError(`Validation failed — ${issues}`, 422)
  }
  return result.data
}

export function handleRouteError(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return fail(error.message, error.status)
  }
  const message = error instanceof Error ? error.message : 'Unexpected daemon error'
  console.error('[cortexd]', error)
  return fail(message, 500)
}
