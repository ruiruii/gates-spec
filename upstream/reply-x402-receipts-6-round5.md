# Round 5 — reply to x402-receipts #6

Posted: 2026-10-09T13:3xZ (comment 6084046338)
In reply to: comment #6081974023 (2026-10-09T13:33:51Z, baianomarceloeduardo-jpg)
Commit will reference: harness + README known-gap rework

## What he said (the corrected, more valuable reply)

1. **No epoch; retracts the 13:05Z claim.** The ledger has no timer; only two paid
   writers append (`/v2/attest`, `/v2/batch`). Gaps range 0 min (batch burst) to
   3,271 min, median 114 min. Attestation is **not coupled to settlement at all**
   → the `freshness_s` prior I wanted does not exist; do not invent one.

2. **Index 20 does NOT attest the payment (he was wrong at 13:05Z, self-corrects).**
   `/v2/ledger` publishes only `dataHash` (preimage never stored). Entry 20's
   `dataHash` is `sha256("{}")`; **21 of 33 entries (indices 12–32) carry that same
   empty-object hash**. No entry binds the txHash in any form (raw, `0x`-stripped,
   `{tx}`). Payment and attestation are two unconnected facts.

3. **`tx_already_used` is enforced then forgotten — confirmed in his own code path.**
   The guard dedups and leaves no signed trace. Quote: *"Prevention is a tourniquet;
   the count is the medical record."* Under EIP-3009 the nonce is single-use, so a
   second redemption can only ever be an attempt → `redeem_count` = attempts.

4. **RW-001 in both projects: yes**, with three honesty conditions.

5. **Harness robustness:** use `?from=0` and page by increasing `from`; the old
   contiguity assert would rot once `total` exceeds the window.

6. He posted a full transcript from his side: 33/33 hash, 33/33 links, 33/33 sigs,
   29 current + 4 historical, index 0/20 both directions, 21/33 empty `dataHash`,
   no entry binds the tx.

## What we did

- Took option (b), made stricter: RW-001 now carries GREEN half (chain, keys,
  signatures — asserted true) and RED half (dataHash != sha256("{}") for the
  claimed index; some entry binds the tx — reported, expected false today).
- Accepted the paging fix (`?from=0`, page until exhausted).
- Per user instruction: cite only his words **from the issue** (dropped the
  `server.js:391/:864` line-number ask).
- Per user instruction: kept the concrete wire proposal — `/v2/attest` accepts a
  `subject` (txHash or `request_fingerprint`), `dataHash = sha256(canonicalJSON(subject))`;
  a `tx_already_used` refusal also writes an attestation for the attempt → gives
  `redeem_count` a signed source. Explicitly framed as "not asking them to do it;
  telling them the smallest change that turns the RED half green."
- RW-001 redefined as a **known-gap vector**: the chain reproduces; the settlement
  link does not yet. Reference stays v0.5.0.

## Why this is good

A published, reproducible receipts implementation **self-testifies** that its ledger
does not bind payments and does not record redeem attempts. That is independent,
third-party confirmation of exactly the gap `consumed` / `redeem_count` /
`settlement_status` exist to close. Our moat is now corroborated by the incumbent.

## Local rework (uncommitted → this commit)

- `verify-rw001.mjs`: ledger now paged from `?from=0`; added RED-half report
  (empty `dataHash` count, tx-binding count) that does not gate the exit code.
- `conformance/real-world/README.md`: status table split into GREEN/RED; §3 retitled
  to "signed timestamp nearest the payment, not a settlement link"; quote attributed
  to the contributor with permission.
