# Threat model — guardrails for `tx_already_used` refusal writing an attestation

> **Status:** draft. Authored by gates-spec, offered to `x402-receipts` (thread
> StelarDigital/x402-receipts#6) for adoption or ignore. Not merged, not a commitment,
> not gated on anything. Written to take the cost off the contributor's plate after C6
> ("that half carries a cost worth seeing before calling it the same change twice").

This note addresses **only the refusal half** of RW-001's proposed third predicate — making a
`tx_already_used` refusal also write a signed attestation entry. The **subject half** (optional
`subject` on `/v2/attest`, `dataHash = sha256(canonicalJSON(subject))`) is the cheap, adoptable
increment already covered in RW-001 §3 and is out of scope here.

---

## 0. Which RW-001 gap this closes

RW-001's RED half currently reads (README §"Verification status"):

- **settlement linkage** — 21/33 entries carry `dataHash = sha256("{}")`; 0 entries bind the tx.
- **redeem trace** — per the contributor, `tx_already_used` "enforces and then forgets; nothing is
  written on the payment path" (README §6, row 4).

The subject half fixes *settlement linkage*. This note is the threat model for the *redeem trace*
half: a refusal that leaves a signed, bounded record instead of being forgotten.

---

## 1. The change under analysis

On a `tx_already_used` refusal (a settled proof presented again), the origin additionally appends an
entry to its hash-chained attestation ledger (`/v2/ledger`) whose `dataHash` binds the refused
`txHash` + `nonce`. The entry is signed with the origin's current key, exactly like every other
ledger entry (README §4). No change to the chain, keyring, or existing signatures.

---

## 2. Why it carries cost (contributor's own framing, C6)

> "A `tx_already_used` refusal writing an attestation: that half carries a cost worth seeing before
> calling it the same change twice."
>
> "the ledger becomes a document an unnamed party can grow at will, at the rate they choose, under
> our key."
>
> "It is a paid product's ledger, so it is a queued decision rather than something I patch
> mid-thread."

The cost is **not** the crypto — it is **write authority**. Today the refusal path is unauthenticated
and the cheapest change on the origin's side is one that lets a stranger append to a ledger signed
with the origin's key. That is the risk this threat model bounds. (Quotes: contributor, x402-receipts#6,
used by permission.)

---

## 3. Asset and adversary

- **Asset:** integrity and *bounded growth* of the attestation ledger, and the write authority
  delegated by the signer's key.
- **Adversary:** any party who can cause a refusal to be emitted — i.e. anyone who can present an
  already-settled (or fabricated) proof and trigger `tx_already_used`. Motivations:
  - **spam** — grow the ledger unbounded, "at the rate they choose";
  - **replay** — turn one refusal into many entries;
  - **forge** — write attestations that claim settlement for payments that never settled on-chain.
- **Security goal (contributor's words):** "a refusal becomes a **bounded, signed, once-per-attempt
  record**."

---

## 4. The three guardrails

Each guardrail maps to exactly one adversary capability.

### G1 — Dedup by `(txHash | nonce)`

- **Mitigates:** replay / duplicate growth. The same attempt cannot produce two ledger entries.
- **Mechanism:** idempotency key `= sha256(txHash || nonce)`; append only if absent. Reuses the
  EIP-3009 single-use nonce that already grounds `redeem_count` as *attempts* (README §1).
- **Residual risk:** depends on the payment rail supplying a stable `nonce` per attempt. Within x402
  this is structural (EIP-3009 `transferWithAuthorization` is single-use), so the bound holds.

### G2 — On-chain check before the append

- **Mitigates:** forged attestations for non-settled payments.
- **Mechanism:** the referenced `txHash` is confirmed settled on Base mainnet (public RPC,
  `eth_getTransactionByHash`, same path gates-spec already uses in RW-001 §1) **before** the entry is
  written. A refusal for a tx that never settled is dropped, not recorded.
- **Residual risk:** liveness dependence on the RPC. Mitigated by the existing CI provenance statement
  (runs `37954034031` / `37954651313`) and by caching the settlement proof alongside the entry.

### G3 — Per-payer per-window cap

- **Mitigates:** unbounded "grow at will, at the rate they choose."
- **Mechanism:** cap refusals written per `payer` per time window (`N` refusals / `window`). Directly
  bounds ledger growth from any single party; blast radius is per-payer, so a determined adversary with
  many distinct payers still cannot flood the whole ledger.
- **Residual risk:** a Sybil adversary (many payers) can still reach `N × payers` entries. Acceptable
  because the cost is per-write and the bound is explicit; the cap is the lever the contributor keeps.

---

## 5. Composed property

With G1 + G2 + G3 a refusal entry is:

| property | from |
|---|---|
| **bounded** | G3 (per-payer per-window cap) |
| **signed** | existing key (no keyring change) |
| **once-per-attempt** | G1 (dedup by `txHash \| nonce`) |
| **tx-bound** | G2 (on-chain settlement confirmed before write) |

That is exactly the "bounded, signed, once-per-attempt record" the contributor asked for, and it
removes the "unnamed party grows the ledger under our key at will" risk. The stranger can still
*trigger* a refusal, but can no longer *grow the ledger unbounded, replayed, or unbacked*.

---

## 6. What flips in RW-001 if adopted

- The **redeem-trace RED half** (README §"Verification status", row 2) goes GREEN: `tx_already_used`
  now leaves a signed, tx-bound trace.
- RW-001's overall status moves from *known-gap vector* toward *converged*: the chain half was already
  independently reproduced (run `37954651313`, ALL CHECKS PASSED); the redeem trace becomes the second
  half gates-spec's weekly CI can show green on its own.
- gates-spec sends the run id. Nothing is required from the contributor beyond shipping G1–G3.

---

## 7. Adoption posture

gates-spec authors this note; `x402-receipts` adopts or ignores, on its timeline. The change is a
**queued decision for a paid product**, not a mid-thread patch (contributor's framing). **No ask
attached.** If adopted, RW-001's RED half can go GREEN and our CI demonstrates it; we send the run id.

---

## 8. Parameters to tune (contributor's to set)

| param | question | gates-spec can supply a default from RW-001 vectors |
|---|---|---|
| `window` length + cap `N` (G3) | how much growth per payer is acceptable | from observed 33-entry ledger / 21 empty `dataHash` baseline |
| `nonce` source (G1) | which field is the stable per-attempt id | EIP-3009 `nonce` (already single-use) |
| RPC + confirmation depth (G2) | how settled is "settled" | Base mainnet, 395k+ confirmations observed in RW-001 §1 |

These are theirs to set; we only need the values to encode the adopted form back into RW-001 as a
positive vector.
