# Real-world conformance vectors

Synthetic vectors in [`../vectors/`](../vectors) are generated from a fixed seed and a fixed
timestamp, so they are byte-reproducible and CI can detect drift. They prove an
implementation is *self-consistent*. They cannot prove the semantics describe anything real.

This directory holds vectors built from **actual settled payments**. A real-world vector is
the only way to show that `redeem_count`, `settlement_status` and `consumed` can be
populated by a live seller without lying — which is the entire claim gates-spec makes.

Every entry MUST state its provenance, including when the payment was **not** a customer
payment.

---

## RW-001 — x402-receipts origin, Base mainnet USDC

Contributed by the `x402-receipts` origin (thread: StelarDigital/x402-receipts#6).
Credit: their origin. Provenance as stated by the contributor.
Reference their **v0.5.0** (npm `latest`), as the contributor asked.

### Verification status

| assertion | status |
|---|---|
| payment exists on Base mainnet | ✅ **independently verified** (2026-10-09, public RPC) |
| ledger hash chain, signatures, `signedBy` | ⏳ **not yet independently verified** — see note |

> **Note on the pending half.** The ledger half is verified by
> [`verify-rw001.mjs`](./verify-rw001.mjs). It has not been run successfully from the
> gates-spec build environment: DNS there answers `api.automaton-sovereign.workers.dev`
> with placeholder addresses (A `162.125.32.2`, AAAA `2a03:2880:…:face:b00c`) and every
> connection times out, while control hosts resolve normally. That is an environment
> restriction, not a finding about their service. **Do not record RW-001 as fully
> reproduced until that script has been run somewhere with unrestricted egress and its
> transcript pasted here.**

### 1. The payment

| field | value |
|---|---|
| network | `eip155:8453` (Base mainnet) |
| tx | `0x3bf944626e3429c7acf1bbc135d82cd73d8e74fec2de4dd03e93a269993d62d8` |
| block | `51984731` |
| payer (authorized) | `0x20e0f41f8b2cea0b2ec015b97dfd11b3c743b8d9` |
| payee | `0x71DEAc098914A009E3720524642A6bE6F65EE528` |
| asset | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| amount | `20000` base units = `0.02` USDC |
| scheme | EIP-3009 `transferWithAuthorization` (selector `0xe3ee160e`) |
| tx submitter | `0x68efafe862d89ce66dd3d7b07d5a3747a0871164` (facilitator; not the payer) |
| verified on-chain at | `2026-09-30T11:38:11.311Z` (per contributor) |
| provenance | **contributor's own paid self-test**, not a customer payment |

#### Independent verification performed by gates-spec

Checked against a public Base mainnet RPC on 2026-10-09:

| claim | method | result |
|---|---|---|
| block `51984731` | `eth_getTransactionByHash` | ✅ |
| payer | decoded calldata word 0 | ✅ `0x20e0f41f…b8d9` |
| payee | decoded calldata word 1 | ✅ `0x71deac09…528` |
| `20000` base units | decoded calldata word 2 | ✅ `0.02` USDC |
| USDC contract | tx `to` | ✅ `0x833589fc…2913` |
| confirmations (395,055 at time of writing) | `eth_blockNumber` − block | ✅ 395,223 at check time; Δ168 blocks ≈ 5.6 min at 2 s/block = the age of the contributor's post |

The selector `0xe3ee160e` is load-bearing: it confirms the payment ran on the **EIP-3009**
path, i.e. a single-use nonce. A *completed* second redemption is therefore structurally
impossible on this payment. This is the on-chain ground for defining
`payment.redeem_count` as **attempts, not completions** (§5.4).

### 2. Origin and public endpoints

Base origin: `https://api.automaton-sovereign.workers.dev`

| purpose | endpoint |
|---|---|
| keyring (current + `history`) | `GET /v2/pubkey` |
| public ledger (33 entries at time of writing) | `GET /v2/ledger?limit=50` |
| offline verification | `GET /v2/verify?index=N` |
| live on-chain payment check | `GET /v1/verify-payment?txHash=0x…` |

All free, no key, no payment, rate-friendly for automated runners.

### 3. Which entry attests this payment

| | index | timestamp (per contributor) | hash | key |
|---|---|---|---|---|
| **this payment** | **20** | `2026-09-30T12:21:40.058Z` | `c71f0e2f…5a30b7` | current `6db8674197d1601f` |
| retired-key negative case | **0** | `2026-09-25T14:34:35.659Z` | `78941ded…15be87` | retired `7e32754cf3911ccf` |

Contributor reports `GET /v2/verify?index=20` →
`{ verified: true, signatureValid: true, chainIntact: true, signedBy: "current" }` and
`?index=0` → the same with `signedBy: "historical"`. **Not yet re-run by gates-spec.**

### 4. Attestation envelope (their evidence layer)

This is **not** a gates-spec VSR. It is the contributor's own ECDSA-P256 hash-chained
attestation ledger, included because it is the layer their settled payment lands in.

Fields: `index`, `prevHash`, `timestamp` (RFC 3339 Z), `dataHash`, `hash`,
`signature` (base64 DER), `keyId`.

```
hash      = sha256(prevHash + "|" + timestamp + "|" + dataHash)
signature = ECDSA-P256-SHA256(DER) over the ASCII hex string of `hash`
```

Two sharp edges worth encoding as vectors of their own:

- The `|` separators are literal, and `timestamp` is used as the **published string**,
  not a normalized form.
- The signature is over the **hex string** of `hash` — not the raw 32-byte digest and not
  the preimage. Signing the raw digest is the obvious implementation and it fails.

The contributor reports recomputing `hash` for **33 of 33** published entries and matching.
gates-spec has not yet reproduced this independently (see the status note above).

### 5. Negative case: retired signing key

Entry `0` is signed by a **retired** key, `keyId 7e32754cf3911ccf`, published in the
`history` array of `/v2/pubkey`. `GET /v2/verify?index=0` returns
`signedBy: "historical"`.

A verifier that reads only the current key reports a **false negative** on entry 0 — and
`verify-rw001.mjs` asserts explicitly that entry 0 must verify against the *retired* key
and must **not** verify against the current one.

> **TODO: encode as `invalid-verify-current-key-only`.** This is a general failure mode,
> not a quirk of this ledger: **any** spec that does not pin how historical keys are
> resolved will rot the first time a signer rotates a key.

### 6. Wire mapping (`X-Payment-Settled` → `payment.settlement_status`)

| their wire value | when | gates-spec enum |
|---|---|---|
| `true` | 200 served against a verified payment (EIP-3009 and legacy transfer-then-hash paths) | `settled` |
| `queued` | EIP-3009 path, settlement in flight; arrives with `X-Payment-Scheme: eip3009` | `in_flight` |
| absent | unpaid — the response **is** the 402 challenge | `absent` |
| `402 payment_invalid / reason: tx_already_used` | resend carrying an already-settled proof | redemption attempt #2 → `redeem_count += 1` |

**The fourth row is the point.** `tx_already_used` is the refusal a conforming seller emits
when a settled proof is presented again. It is exactly the event `redeem_count` exists to
record: the guard prevents the replay, the field is what makes it leave a signed trace.
Prevention is a tourniquet; the count is the medical record.

**Consequence for §6.1.1.** Because `absent` only ever arrives as a 402 challenge, this
origin never emits `delivered + absent`. That contradiction is therefore not a state a
conforming seller produces — it is a **detector for falsified receipts**, reachable only by
lying. That is what it is for.

> **Cite the table above, not their OpenAPI**, until their two known defects ship:
> `X-Payment-Settled` documented as `enum: ["true"]` (omits `queued`), and
> `/v1/verify-payment` absent from `paths`.

### 7. Reproduction

```
node conformance/real-world/verify-rw001.mjs
```

Zero dependencies, Node >= 18. It re-runs every assertion above — on-chain payment fields
from a public Base RPC, the whole hash chain, both signatures, and `signedBy` for both
indices — and exits non-zero on any failure. Paste its transcript here when it runs clean.

---

## Adding a real-world vector

A submission is accepted only if it carries:

1. a payment that can be verified on a public network **without trusting the submitter**;
2. the submitter's own statement of provenance, including "not a customer payment" where
   that is the case;
3. any wire mapping the submitter's transport uses, with the mapping written down;
4. at least one assertion a third party can re-run.

gates-spec re-verifies every submission independently before it is merged, and records
which assertions have and have not been re-run. Vector generosity is not vector acceptance.
