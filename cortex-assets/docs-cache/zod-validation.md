# Zod — schema validation patterns (verified)

## Object schema + safeParse

```typescript
import { z } from 'zod'

const subscriptionSchema = z.object({
  userId: z.string().min(1),
  stripeSubscriptionId: z.string().min(1),
  status: z.enum(['active', 'past_due', 'canceled']),
  currentPeriodEnd: z.coerce.date(),
})

const parsed = subscriptionSchema.safeParse(payload)
if (!parsed.success) {
  // parsed.error.issues: [{ path: ['status'], message: ..., code: ... }]
}
```

## Type inference (single source of truth)

```typescript
type Subscription = z.infer<typeof subscriptionSchema>
```

## Prisma model → Zod schema (the deterministic mapping this project generates)

| Prisma field | Zod equivalent |
| --- | --- |
| `String` + `@id`/`@unique` | `z.string().min(1)` |
| `String` (plain) | `z.string()` |
| `String?` | `z.string().nullable().optional()` |
| `Int` | `z.number().int()` |
| `Float` | `z.number()` |
| `Boolean` | `z.boolean()` |
| `DateTime` | `z.coerce.date()` |
| `String[]` | `z.array(z.string())` |

## Enums, defaults, refinements

```typescript
const envSchema = z.object({
  STRIPE_SECRET_KEY: z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  DATABASE_URL: z.string().min(1).optional(),
})

const webhookConfig = z.object({
  retries: z.number().int().min(0).max(10).default(3),
  endpoint: z.string().url(),
}).refine((c) => !c.endpoint.includes('localhost') || process.env.NODE_ENV !== 'production', {
  message: 'Production must not point at localhost',
})
```

## Strict mode

`z.strictObject({...})` rejects unknown keys — use for wire contracts where an
unexpected field signals a client bug. `z.object` (strip mode) is the default.
