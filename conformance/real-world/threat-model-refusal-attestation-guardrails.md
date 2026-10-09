# Threat model — guardrails for `tx_already_used` refusal writing an attestation

> **Status:** draft, revision 3. Authored by gates-spec, offered to `x402-receipts` (thread
> StelarDigital/x402-receipts#6) for adoption or ignore. Not merged, not a commitment,
> not gated on anything. Written to take the cost off the contributor's plate after C6
> ("that half carries a cost worth seeing before calling it the same change twice").
>
> **Revision 2 incorporates C7** — the contributor's refinement that the right `subject` is
> *not the same for both halves*, and that the per-payer per-window cap is the **backstop, not a
> nicety**. Both corrections are his and are recorded as his (§0.1, §4 G3, §9). Revision 1 had the
> cap the wrong way round; it is corrected here.
>
> **Revision 3 incorporates C8** — the contributor filled the open "fingerprint composition"
> cell (§8, formerly "theirs to define") with a complete, failure-mode-aware definition: hash
> the request the **client** made (never seller-written fields), the explicit canonical-byte
> formula, normalization, and the settle/refusal agreement. The open cell is now his definition,
> recorded as his (§4 G1, §9). gates-spec also anchors this composition as the **RW-001 reference
> composition** ahead of any code, in the order the contributor asked for ("objections before the
> code").

---

## 0. Scope

This note addresses **only the refusal half** of RW-001's proposed third predicate — making a
`tx_already_used` refusal also write a signed attestation entry. The **settlement half** (optional
`subject` = `txHash` on `/v2/attest`, `dataHash = sha256(canonicalJSON(subject))`) is the cheap,
adoptable increment covered in RW-001 §3 and is out of scope here.

### 0.1 The `subject` is not the same for both halves (contributor, C7 — recorded as his)

> "For the settlement half, `subject = txHash` is correct: it binds *this payment*. For the
> refusal half it has to be the **request fingerprint**, not the transaction hash — each attempt
> carries its own tx, so txHash-bound entries can never be grouped into a count at all."
>
> "txHash-bound attestations buy provenance without buying a count."

| half | `subject` | buys | does **not** buy |
|---|---|---|---|
| settlement | `txHash` | **provenance** — binds this payment | a count |
| refusal | **request fingerprint** | **a count** — `redeem_count` = the entries under that fingerprint | (provenance belongs to the other half) |

Consequences:

- The fingerprint half is **the half that makes `redeem_count` derivable**. Attempt 1 settles,
  attempt 2 is refused, both bound to the same fingerprint, and the count is simply the entries
  under it.
- gates-spec had treated `subject` as **one** increment when it is **two with different payoffs**.
  The correction is the contributor's, and it inverts build order: he has stated that if it ships,
  **the fingerprint half ships first**.

---

## 1. The change under analysis

On a `tx_already_used` refusal (a settled proof presented again), the origin additionally appends an
entry to its hash-chained attestation ledger (`/v2/ledger`) whose `dataHash` binds the **request
fingerprint** of the refused attempt — *not* the tx (§0.1). The entry is signed with the origin's
current key, exactly like every other ledger entry (README §4). No change to the chain, keyring, or
existing signatures.

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
with the origin's key. That is the risk this threat model bounds.

---

## 3. Asset and adversary

- **Asset:** integrity and *bounded growth* of the attestation ledger, and the write authority
  delegated by the signer's key.
- **Adversary:** any party who can cause a refusal to be emitted — i.e. anyone who can present an
  already-settled (or fabricated) proof and trigger `tx_already_used`. Capabilities:
  - **spam** — grow the ledger unbounded, "at the rate they choose";
  - **replay** — turn one refusal into many entries;
  - **forge** — write attestations that claim settlement for payments that never settled on-chain;
  - **mint** — fabricate a *fresh logical request* per write (contributor, C7). This is the
    capability that makes fingerprint dedup insufficient on its own, and it is why G3 is the
    backstop rather than a refinement.
- **Security goal (contributor's words):** "a refusal becomes a **bounded, signed, once-per-attempt
  record**."

---

## 4. The three guardrails

Each guardrail maps to an adversary capability. **Two of the guardrails' dedup keys do different
jobs, and the note now says which is which** (contributor, C7: *"Three guardrails, two of them doing
different jobs; the note is better for saying which is which."*).

### G1 — Dedup (two keys, two jobs)

| dedup key | bounds | job |
|---|---|---|
| `(txHash \| nonce)` | **one attempt** | makes the record once-per-attempt; kills replay of the same attempt |
| request fingerprint | **one logical request** | groups attempts, which is what makes `redeem_count` derivable (§0.1) |

#### Fingerprint composition (contributor, C8 — recorded as his)

> The fingerprint must be over the request the **client** made, never over fields the **seller**
> wrote. In x402 v2 the challenge carries server-chosen fields — `accepts[].resource.url` is
> absolute and written by the seller (on our host, the edge writes it). If any of those enter the
> fingerprint, the seller can make one client request hash two ways, or two different requests hash
> the same, and the count stops measuring attempts.

**Canonical bytes to hash** (all decoded, none of it wire bytes):

```
sha256( v1 \0 method \0 origin \0 path \0 queryCanonical \0 payTo \0 asset \0 network \0 amount \0 scheme )
```

- `origin` = the origin the client actually contacted, carried by the request — **not**
  `accepts[].resource.url`, for the same reason `payTo` pins to the contacted origin: the seller
  writes that field.
- **The terms belong in it:** a "same logical request" that agreed different terms is a different
  request; a refused attempt that agreed different terms should not group with the one that settled.
- **Everything per-attempt is out:** `txHash`, `nonce`, timestamps, and deadlines derived from
  `maxTimeoutSeconds`.
- **Normalization** (so two implementations do not differ): lowercase host, strip the default port,
  no trailing slash, query sorted by key with percent-encoding applied once, and non-canonical
  encodings rejected instead of silently re-encoded.

**Failure modes this composition avoids** (the contributor named them; recorded as his):

1. **Seller-forged hash collisions** — if a seller-controlled field enters the fingerprint, one
   request hashes two ways or two requests hash the same; `redeem_count` stops measuring attempts.
2. **Wire-vs-canonical split ("hash the challenge" lifts the txHash problem one level up)** — one
   challenge is carried in three wire representations (`PAYMENT-REQUIRED`, `X-PAYMENT-REQUIRED`,
   the body); hashed as wire bytes they are three fingerprints, decoded-and-canonicalized they are
   one (sha256 `c016f1f3…`). Hashing the challenge as received reproduces the txHash problem at the
   next layer up.
3. **Settle/refusal divergence** — attempt 1's settle carries the terms it actually signed; the
   refusal carries the terms it *would have* signed. If the seller computes from the challenge it
   advertised and the buyer from the challenge it received, they diverge exactly when the seller
   rotates or reorders an `accepts` entry — the very case where you want the two counted together.
   **Both sides must compute from the request as received.**

- **Mechanism:** idempotency key `= sha256(txHash ‖ nonce)` for the attempt bound, and
  `sha256(fingerprint)` for the logical-request bound; append only if absent.
- **Residual risk:** neither key bounds the adversary. A stranger can mint a fresh logical request
  per write, so fingerprint dedup bounds a *request*, not the attacker. That is G3's job.

### G2 — On-chain check before the append

- **Mitigates:** forged attestations for non-settled payments.
- **Mechanism:** the referenced `txHash` is confirmed settled on Base mainnet (public RPC,
  `eth_getTransactionByHash`, same path gates-spec already uses in RW-001 §1) **before** the entry is
  written. A refusal for a tx that never settled is dropped, not recorded.
- **Residual risk:** liveness dependence on the RPC. Mitigated by the existing CI provenance statement
  (runs `37954034031` / `37954651313`) and by caching the settlement proof alongside the entry.

### G3 — Per-payer per-window cap — **the backstop, not a nicety**

> "a stranger can still fabricate a fresh logical request per write, so the per-payer per-window cap
> is the backstop, not a nicety" (contributor, C7).

- **Mitigates:** unbounded growth in exactly the case dedup cannot — adversary mints new logical
  requests.
- **Mechanism:** cap refusals written per `payer` per time window (`N` refusals / `window`). Blast
  radius is per-payer, so a determined adversary with many distinct payers still cannot flood the
  whole ledger.
- **Residual risk:** a Sybil adversary (many payers) can still reach `N × payers` entries. Acceptable
  because the cost is per-write and the bound is explicit; the cap is the lever the contributor keeps.

---

## 5. Composed property

| property | from |
|---|---|
| **bounded** | G3 (per-payer per-window cap — **the backstop**) |
| **signed** | existing key (no keyring change) |
| **once-per-attempt** | G1 `(txHash \| nonce)` dedup |
| **groupable into a count** | G1 fingerprint dedup — makes `redeem_count` derivable |
| **tx-bound** | G2 (on-chain settlement confirmed before write) |

That is the "bounded, signed, once-per-attempt record" the contributor asked for, **plus** the
grouping that makes the count derivable rather than asserted. The stranger can still *trigger* a
refusal and can still *mint* new logical requests, but can no longer grow the ledger unbounded,
replayed, or unbacked.

---

## 6. What flips in RW-001 if adopted

- The **redeem-trace RED half** (README §"Verification status", row 2) goes GREEN: `tx_already_used`
  now leaves a signed, bounded, fingerprint-grouped trace.
- Because the entries are fingerprint-bound, **`redeem_count` becomes derivable**, not merely
  asserted — which is the entire claim the field exists to make.
- RW-001's overall status moves from *known-gap vector* toward *converged*: the chain half was already
  independently reproduced (run `37954651313`, ALL CHECKS PASSED).
- **Sequencing, per the contributor:** nothing is moving on their side; **if it ships, the fingerprint
  half ships first**, and gates-spec will see it in CI before he writes a word about it.
- gates-spec sends the run id. Nothing is required from the contributor beyond shipping G1–G3.

---

## 7. Adoption posture

gates-spec authors this note; `x402-receipts` adopts or ignores, on its timeline. The change is a
**queued decision for a paid product**, not a mid-thread patch (contributor's framing). **No ask
attached.** Revision 2 is sent *before* implementation at the contributor's request, so that
objections arrive before the code rather than after — "which is the better order."

---

## 8. Parameters to tune (contributor's to set)

| param | question | gates-spec can supply a default from RW-001 vectors |
|---|---|---|
| **fingerprint composition** | what makes two attempts the *same logical request* | **defined by the contributor, C8 (§4 G1)** — his composition is anchored as the RW-001 reference composition ahead of any code |
| `window` length + cap `N` (G3) | how much growth per payer is acceptable | from observed 33-entry ledger / 21 empty `dataHash` baseline |
| `nonce` source (G1) | which field is the stable per-attempt id | EIP-3009 `nonce` (already single-use) |
| RPC + confirmation depth (G2) | how settled is "settled" | Base mainnet, 395k+ confirmations observed in RW-001 §1 |

These are theirs to set; we only need the values to encode the adopted form back into RW-001 as a
positive vector.

---

## 9. Attribution

Recorded as the contributor's, used by permission, cited in-thread:

- **C6** — the cost framing ("worth seeing before calling it the same change twice"), the write-authority
  risk ("a document an unnamed party can grow at will … under our key"), the "paid product's ledger is a
  queued decision" framing, and the target property ("bounded, signed, once-per-attempt").
- **C7** — `subject` is not the same for both halves; fingerprint vs `txHash`; the two dedup jobs
  (one attempt vs one logical request); the *mint* capability; and the correction that the per-payer
  per-window cap is the **backstop, not a nicety**.
- **C8** — the fingerprint composition definition: hash the client-made request (not seller-written
  fields), the canonical-byte formula, normalization rules, and the settle/refusal agreement; plus
  the three failure modes it avoids (seller-forged hash collisions, wire-vs-canonical split,
  settle/refusal divergence). He closed the open cell we had left as "theirs to define."

gates-spec's own contributions here are the asset/adversary framing and the mapping of each guardrail
to a capability — the corrections above are his.
