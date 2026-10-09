# Real-world vector — x402-receipts origin (Base mainnet USDC)

Source: `baianomarceloeduardo-jpg`, comment on StelarDigital/x402-receipts#6,
2026-10-09T12:29:07Z. Everything below is reproducible without trusting them.

**Status: payment independently verified by us. Two items still missing (see end).**

---

## 1. The payment

| field | value |
|---|---|
| tx | `0x3bf944626e3429c7acf1bbc135d82cd73d8e74fec2de4dd03e93a269993d62d8` |
| block | `51984731` |
| payer (authorized) | `0x20e0f41f8b2cea0b2ec015b97dfd11b3c743b8d9` |
| payee | `0x71DEAc098914A009E3720524642A6bE6F65EE528` |
| asset | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` on `eip155:8453` |
| amount | `20000` base units = **0.02 USDC** |
| provenance | their own paid self-test, not a customer payment |

### Our independent verification (Base mainnet public RPC, 2026-10-09 12:35 UTC)

| claim | checked | result |
|---|---|---|
| block number | `eth_getTransactionByHash` | 51984731 ✅ |
| `to` = USDC contract | decoded | `0x833589fc...02913` ✅ |
| payer | decoded input word 0 | `0x20e0f41f...b8d9` ✅ |
| payee | decoded input word 1 | `0x71deac09...528` ✅ |
| value | decoded input word 2 | 20000 = 0.02 USDC ✅ |
| scheme | function selector | `0xe3ee160e` = **EIP-3009 `transferWithAuthorization`** ✅ |
| confirmations | `eth_blockNumber` | we measured 395,223 vs their 395,055 → Δ168 blocks ≈ 5.6 min at 2 s/block = exactly the age of their comment ✅ |

Note: the tx `from` is `0x68efafe862d89ce66dd3d7b07d5a3747a0871164` — the facilitator that
submitted it. The *payer* is the EIP-3009 authorizer. Normal for `exact`.

**Why the selector matters:** `0xe3ee160e` confirms this ran on the EIP-3009 path, i.e. a
single-use nonce. A *completed* second redemption is therefore structurally impossible —
which is the exact reason `redeem_count` is defined as attempts, not completions.

---

## 2. Verify endpoints (all free, no key, no payment)

```
GET /v2/pubkey    → { keyId, algorithm: "ECDSA-P256-SHA256", encoding: "spki-pem",
                      publicKey: <PEM>, history: [ { keyId, publicKey } ], statePersistent }
GET /v2/verify?index=N → { verified, signatureValid, chainIntact, reason, keyId,
                           signedBy: "current" | "historical", entry: <envelope> }
GET /v2/ledger    → { total, from, count, entries: [ <envelope> ] }
GET /v1/verify-payment?txHash=0x… → { txHash, ok, reason, from, to, asset,
                      valueBaseUnits, confirmations, blockNumber, txHashValid, checkedAt }
```

**`history` is load-bearing.** Entry 0 is signed by a **retired** key (`keyId 7e32754cf3911ccf`)
published in that array; `verify?index=0` returns `signedBy: "historical"`. A verifier that
reads only the current key reports a **false negative** on old entries. They propose encoding
that as a negative conformance case of its own. We should.

---

## 3. Attestation envelope (they reproduced it, we did not take it on faith)

Fields: `index`, `prevHash`, `timestamp` (RFC 3339 Z), `dataHash`, `hash`,
`signature` (base64 DER), `keyId`.

- `hash = sha256(prevHash + "|" + timestamp + "|" + dataHash)` — separators are literal `|`,
  timestamp used as the published string. They recomputed it and it matches **33 of 33**
  entries.
- `signature` = ECDSA-P256-SHA256 (DER) **over the ASCII hex string of `hash`** — not the raw
  digest, not the preimage. Verified against the published key for entry 0 (retired) and for
  the newest entry (current).

---

## 4. The `X-Payment-Settled` mapping they actually run

| wire | when | maps to |
|---|---|---|
| `true` | 200 served against a verified payment (both EIP-3009 and legacy transfer-then-hash) | `settled` |
| `queued` | EIP-3009 path, settlement in flight; arrives with `X-Payment-Scheme: eip3009` | `in_flight` |
| absent | unpaid — the response *is* the 402 challenge | `absent` |
| `402 payment_invalid / reason: tx_already_used` | resend carrying an already-settled proof | see below |

**The fourth case is the important one.** `tx_already_used` is the refusal they emit when a
settled proof is presented again — i.e. it is precisely the event `redeem_count` counts.
Their runtime guard already produces the signal; our field is what makes it leave a signed
trace. Prevention vs evidence, confirmed by a production seller.

Note the consequence for our rules: because `absent` only ever arrives as a 402 challenge,
their origin never produces `delivered + absent`. That contradiction rule is therefore a
detector for *falsified* receipts, not a state their server emits — which is exactly what it
is for.

---

## 5. Two defects they disclosed themselves

1. Their published OpenAPI documents `X-Payment-Settled` as `enum: ["true"]` — it undersells
   `queued`.
2. `/v1/verify-payment` is live and free but is absent from the published OpenAPI `paths`.

Both queued on their side. **Cite the mapping above, not their OpenAPI, until that ships.**

---

## Missing — blocks encoding the §9 vector

1. **Origin / base URL.** They gave paths only; their README carries no hostname.
2. **Which ledger `index` attests this tx.** Entry 0 was given as the retired-key example,
   not as the entry for `0x3bf9…`. Without it the payment and the attestation are unlinked.
