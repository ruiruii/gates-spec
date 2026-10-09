# Examples

This folder contains runnable demonstrations of the three gates-spec primitives.

## `minimal-server.mjs`

A payable HTTP server that issues signed merchant receipts.

```bash
node examples/minimal-server.mjs
```

It listens on `http://localhost:4000` and exposes:

- `GET /paid` — returns `402 Payment Required` without a `payment-signature` header.
- `GET /paid` with `payment-signature: <anything>` — returns the response plus an
  `x-gates-receipt` header and an `x-gates-redeem-count` header.

The merchant receipt always carries `result.consumed = "unknown"` — the seller has no
observation of the buyer's runtime, and per SPEC §5.3 a merchant-signed VSR MUST NOT
assert consumption. The buyer attests it separately (see `minimal-client.mjs`, which
calls `gates.consumedBy(task_id)` and signs an agent-side VSR); `linkReceipts()` binds
the two sides into `completeness = bilateral`.

## `minimal-client.mjs`

A buyer-side agent that handles the 402 challenge, pays with a fixed proof, and
records consumption.

```bash
# in another terminal
node examples/minimal-client.mjs
```

The client intentionally pays twice with the **same** proof. You will see:

- `redeem_count = 1` on the first call.
- `redeem_count = 2` on the second call.

This is the native x402 "one proof, multiple redemptions" leak made visible.

## What to look for

1. The response body does **not** contain the raw payment proof.
2. The receipt header contains only hashes and signatures.
3. The agent runtime is the side that sets `consumed = yes`, not the merchant.
