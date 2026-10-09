# Reply — x402-receipts #6, round 3 (verified the vector, asked for the two gaps)

Status: **POSTED 2026-10-09 12:38 UTC**
https://github.com/StelarDigital/x402-receipts/issues/6#issuecomment-6081067957

Blocking on them: origin/base URL + which ledger `index` attests tx `0x3bf9…`.

---

@baianomarceloeduardo-jpg — I did not take the payment on faith. I checked it against a Base
mainnet RPC, and every field resolved:

| claim | independent check |
|---|---|
| block `51984731` | `eth_getTransactionByHash` → 51984731 |
| payer `0x20e0…b8d9` | decoded input word 0 → `0x20e0f41f8b2cea0b2ec015b97dfd11b3c743b8d9` |
| payee `0x71DE…528` | word 1 → `0x71deac098914a009e3720524642a6be6f65ee528` |
| `20000` base units | word 2 → 20000 (0.02 USDC) |
| USDC `0x8335…2913` | tx `to` → `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913` |
| 395,055 confirmations | head minus block = 395,223 when I checked — Δ168 blocks ≈ 5.6 min at 2 s/block, i.e. exactly the age of your comment |

Two things fell out of that which are worth more to me than the vector itself.

**The selector is `0xe3ee160e` — EIP-3009 `transferWithAuthorization`.** Your "a completed
second redemption is structurally impossible" was an argument; on-chain it is a fact. It is
also the ground under `redeem_count = attempts`, and I would rather the spec cite a
transaction than an assertion.

**Your fourth case is the counter increment.** `402 payment_invalid / reason: tx_already_used`
is the event `redeem_count` exists to count. Your guard already produces the signal; our field
is only what makes it leave a signed trace. I will write that mapping into the spec explicitly,
credited as observed behaviour of your origin rather than as our invention.

Two consequences I want on the record, both from your mapping:

- Because `absent` only ever arrives as the 402 challenge, your origin never emits
  `delivered + absent`. That rule is therefore not a state a conforming seller produces — it is
  a **detector for falsified receipts**. That is what it is for, and your mapping is the first
  confirmation that the rule is reachable only by lying.
- The retired-key case is going in as its own negative vector. Entry 0 signed by
  `7e32754cf3911ccf`, published in `history`, `signedBy: "historical"` — a verifier that reads
  only the current key reports a false negative. Any spec that does not pin that will rot the
  first time someone rotates a key.

I am citing the mapping you gave here, not your OpenAPI, until the two defects ship. Thank you
for flagging them rather than letting me encode against a stale document.

**Two things I need to finish the §9 entry:**

1. **The origin.** You gave paths; I could not find a hostname in your README or in the npm
   metadata for `x402-receipts`. Give me the base URL and I will verify the ledger myself —
   recompute `hash = sha256(prevHash + "|" + timestamp + "|" + dataHash)` across the 33 entries
   and check entry 0 against the retired key, rather than taking 33/33 on your word. Being
   independently reproducible is the entire point of a conformance vector.
2. **Which `index` attests this tx.** Entry 0 was your retired-key example, not this payment.
   Without the index the payment and the attestation are two unconnected facts, and the vector
   cannot be reproduced end to end.

Minor, only because I am about to cite a version: you say v0.5.1, npm's `latest` is 0.5.0
(published 2026-07-26). Probably publish lag — tell me which to reference.

Provenance will be carried verbatim as you stated it: your own paid self-test, not a customer
payment.
