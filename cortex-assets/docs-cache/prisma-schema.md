# Prisma Schema (SQLite / PostgreSQL) — verified patterns

## Model block syntax

```prisma
model Subscription {
  id           String   @id @default(cuid())
  userId       String
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  stripeSubId  String   @unique
  status       String            // active | past_due | canceled
  currentPeriodEnd DateTime
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  @@index([userId, status])
}
```

Field type mapping (SQLite): `String`, `Int`, `Float`, `Boolean`, `DateTime`,
`String?` (nullable), `Json` (stored as TEXT in SQLite). PostgreSQL adds
`String[]`, `Decimal`, `Bytes` and native `Json`.

## Datasource + generator

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite" // or "postgresql"
  url      = env("DATABASE_URL")
}
```

## Common attribute cheatsheet

| Attribute | Meaning |
| --- | --- |
| `@id @default(cuid())` | primary key with collision-safe id |
| `@unique` | column-level unique constraint |
| `@@unique([a, b])` | composite unique |
| `@relation(fields: [x], references: [id], onDelete: Cascade)` | FK with cascade |
| `@@index([a, b])` | composite index |
| `@updatedAt` | auto-refresh timestamp on update |
| `@default(now())` | creation timestamp default |

## Enum (PostgreSQL only — SQLite has no native enums)

```prisma
enum SubscriptionStatus {
  active
  past_due
  canceled
}
```

For SQLite, model enums as `String` + application-level validation (e.g. a Zod
`z.enum([...])`), which is the pattern this project uses.

## Adding a field safely

1. Add the field with a default (`String @default("")`) or make it nullable —
   existing rows must remain valid.
2. Run `prisma db push` (dev) or `prisma migrate dev --name add_subscription_fields`
   (tracked environments).
3. Regenerate the client (`prisma generate`) so types include the new field.

## Client usage (TypeScript)

```typescript
import { PrismaClient } from '@prisma/client'
const db = new PrismaClient()

// Upsert keyed on the Stripe id — the safe webhook write path
await db.subscription.upsert({
  where: { stripeSubId: event.data.object.id },
  create: { userId, stripeSubId: sub.id, status: sub.status, currentPeriodEnd: new Date(sub.current_period_end * 1000) },
  update: { status: sub.status, currentPeriodEnd: new Date(sub.current_period_end * 1000) },
})
```
