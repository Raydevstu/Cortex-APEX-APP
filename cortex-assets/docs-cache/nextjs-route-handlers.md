# Next.js App Router — route handlers & server patterns (verified)

## Route handler skeleton

```typescript
// app/api/<resource>/route.ts
export const dynamic = 'force-dynamic' // always fresh in a daemon-style API
export const runtime = 'nodejs'        // required for node:fs, node:crypto

import { z } from 'zod'

const bodySchema = z.object({
  id: z.string().min(1),
})

export async function POST(request: Request) {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      { error: 'Validation failed', details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) },
      { status: 422 },
    )
  }
  // ... real work ...
  return Response.json({ ok: true }, { status: 201 })
}
```

## Dynamic segments

```typescript
// app/api/items/[id]/route.ts
import { NextResponse } from 'next/server'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }, // Next 15+: params is a Promise
) {
  const { id } = await params
  return NextResponse.json({ id })
}
```

## Response helpers

- `NextResponse.json(data, { status: 201 })` — typed JSON responses.
- `Response.json(...)` works identically for plain payloads.
- Redirects: `NextResponse.redirect(new URL('/login', request.url))`.

## Validation envelope convention (this project)

Every mutating endpoint: parse body with zod → on failure return
`{ error, details }` with status 422; domain failures return
`{ error, details: null }` with 4xx; unexpected errors log server-side and
return 500 `{ error: 'Unexpected daemon error' }`.

## Server-only file access

```typescript
import { promises as fs } from 'node:fs'
import path from 'node:path'
const abs = path.join(process.cwd(), 'data', 'file.json')
const content = await fs.readFile(abs, 'utf-8')
```

Route handlers run on the server — `process.cwd()` is the app root. Never
import `node:fs` into a client component.

## Long-running endpoints

`export const maxDuration = 120` (seconds) for heavy pipelines; call external
models with `AbortController` + timeout so the route can never hang forever.
