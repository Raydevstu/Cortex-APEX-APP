# Stripe Webhooks (Node / TypeScript) — verified patterns

## Signature verification (MANDATORY — never trust an unverified body)

```typescript
import Stripe from 'stripe'
import type StripeTypes from 'stripe'

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2024-06-20', // pin the API version — never 'latest' in production
})

export async function verifyStripeWebhook(
  rawBody: string,             // the UNPARSED raw request body (see below)
  signatureHeader: string | null, // the 'stripe-signature' header
  webhookSecret: string,       // process.env.STRIPE_WEBHOOK_SECRET
): Promise<StripeTypes.Event> {
  if (!signatureHeader) throw new Error('Missing stripe-signature header')
  // constructEvent verifies the HMAC-SHA256 signature AND the timestamp
  // (replay protection). It throws Stripe.errors.SignatureVerificationError.
  return stripe.webhooks.constructEvent(rawBody, signatureHeader, webhookSecret)
}
```

## Raw body rule (Next.js App Router)

Route handlers must read the raw text BEFORE any JSON.parse, because the
signature is computed over the exact bytes:

```typescript
// app/api/webhooks/stripe/route.ts
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs' // crypto.webhooks requires the Node runtime

export async function POST(request: Request) {
  const rawBody = await request.text() // <- raw string, not request.json()
  const signature = request.headers.get('stripe-signature')
  try {
    const event = await verifyStripeWebhook(
      rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!,
    )
    switch (event.type) {
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object
        // idempotency: persist event.id before processing; skip if seen
        break
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object
        break
      }
      default:
        break
    }
    return Response.json({ received: true })
  } catch (error) {
    // 400 on signature failure — do NOT retry poisoned payloads
    return Response.json({ error: 'Invalid signature' }, { status: 400 })
  }
}
```

## Subscription lifecycle events

| Event | Fires when | Typical action |
| --- | --- | --- |
| `customer.subscription.created` | new subscription | provision seats, store `stripeSubscriptionId` |
| `invoice.payment_succeeded` | renewal paid | extend `currentPeriodEnd`, reset dunning state |
| `invoice.payment_failed` | renewal failed | mark past_due, notify user |
| `customer.subscription.updated` | plan/pricing change | re-sync entitlements |
| `customer.subscription.deleted` | cancellation | downgrade access at period end |

## Idempotency & race safety

1. Stripe retries delivery (up to 3 days). Store `event.id` in a processed-events
   table with a unique key; INSERT-first, and skip processing on conflict.
2. Update with optimistic concurrency: `UPDATE subscriptions SET status = ?,
   currentPeriodEnd = ? WHERE stripeSubscriptionId = ? AND currentPeriodEnd < ?`
   to avoid an older retry overwriting newer state.
3. Env keys (names only, never values): `STRIPE_SECRET_KEY`,
   `STRIPE_WEBHOOK_SECRET`, optionally `STRIPE_API_VERSION`.

## Testing

`stripe listen --forward-to localhost:3000/api/webhooks/stripe` prints a
whsec_... secret for local runs. Trigger events with `stripe trigger
invoice.payment_succeeded`.
