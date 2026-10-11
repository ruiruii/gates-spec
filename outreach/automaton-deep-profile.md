# Deep Attestation Quality Profile — automaton-sovereign

**Subject:** `https://api.automaton-sovereign.workers.dev`
**Evidence form:** `attestation-ledger` — persistent hash-chain attestation ledger
**Assessment date:** 2026-10-11 · **Census:** W1 (public x402 ecosystem)
**Assessed by:** gates-probe — independent, non-custodial, protocol-neutral
**Basis:** public-endpoint probing only. Every result below is reproducible (§7).

---

## 1. Executive summary

automaton-sovereign is **one of only 2 endpoints out of 77** publicly probed in the x402 ecosystem — and **1 of 17** settlement authorities — that exposes a persistent, independently verifiable evidence surface. In our weekly census, **97% of endpoints settle without attestation**. You are in the 3%.

Your ledger passes structural integrity and chain continuity, and your keyring is history-aware. **One material gap remains: content binding** — a share of ledger entries sign an empty object rather than the delivered content, which limits what the signature actually proves.

> Closing that gap would make automaton the first endpoint in the public x402 ecosystem with a fully content-bound, continuously verifiable attestation chain — i.e. evidence that is *evidentiary*, not merely *chronological*.

---

## 2. What we verified (surface probing)

| Evidence surface | Path | Result |
|---|---|---|
| Attestation ledger | `/v2/ledger` | **present** — 2xx + JSON |
| Public key / keyring | `/v2/pubkey` | **present** — 2xx + JSON |
| Facilitator capability | `/supported` | present |
| Health | `/health` | present |

**Note on method:** we count a surface as present **only when it returns 2xx AND a JSON document**. HTML landing pages and error pages are rejected. This is deliberate — several endpoints in the ecosystem appear to expose a ledger but return an HTML page; those are classified as non-evidence, not as ledgers.

---

## 3. Predicate-by-predicate assessment

Seven predicates apply to the `attestation-ledger` form. Status: `pass` = holds · `gap` = expected shortfall · `pending` = missing input (not a defect) · `info` = design statement.

| Predicate | What it measures | Result | Interpretation |
|---|---|---|---|
| `ledger.hashIntegrity` | Each entry's recorded hash recomputes and matches its content | **pass** | Ledger is internally sound |
| `ledger.chainContinuity` | Hash chain is unbroken — no gaps, rewrites, or orphan entries | **pass** | No tampering or truncation detected |
| `keyring.historyAware` | Key history retained; historical keys still resolvable after rotation | **pass** | Old signatures remain verifiable post-rotation — a genuinely strong property |
| **`evidence.contentBinding`** | **Share of entries whose `dataHash` binds real delivered content, rather than `sha256("{}")`** | **gap** | **See §4** |
| `evidence.settlementLinkage` | A ledger entry can be tied to the specific settled request | pending | Requires a published request fingerprint |
| `evidence.redeemCountDerivable` | Redemption/settlement count derivable from the ledger itself | pending | Same dependency |
| `evidence.settlementTrivalued` | Settlement state is three-valued rather than boolean | info | Design statement, not a score |

**Three passes, one gap, two pendings.** The structural layer of your attestation is sound; the *binding* layer is where evidentiary value is lost.

---

## 4. The contentBinding gap — the one that matters

**What we measure:** the proportion of ledger entries whose `dataHash` equals `sha256("{}")` — the canonical hash of an **empty object**.

**Measured — W1 census, 2026-10-10:**

| | |
|---|--:|
| Ledger entries | **34** |
| Entries binding real content | 12 (35.3%) |
| **Entries signing an empty object** | **22 (64.7%)** |

**The distribution is the important part.** The empty-object entries are **indices 12 through 33 — contiguous**. The first 12 entries bind content correctly; every entry from index 12 onward binds nothing.

That is not random noise. It is the signature of a **regression**: content capture worked, then at a specific point it stopped — a changed code path, a payload not yet materialised when the attestation hook fires, or a serialisation change.

Which is good news, and actionable:

- The capability **existed and was lost**, so it is recoverable — not a redesign;
- There is a **specific deploy window to inspect** (around entry 12), not a systemic architecture problem;
- Fixing it moves **22 entries at once** from "signed nothing" to "signed something".

**Why it matters:** a signature over an empty object is **cryptographically valid but evidentially empty**. It proves *"someone holding this key signed something at this time"* — it does **not** prove *"this content was delivered to this payer for this request"*.

In practice that means:
- In a **dispute**, the entry demonstrates a signature existed, not what was delivered.
- For **audit or compliance**, the record is chronological, not substantiating.
- In an **enterprise RFP**, "we sign every settlement" stops being a differentiator once the counterparty asks *"signed what?"*

**Typical root cause:** the attestation hook fires before the response payload is materialised (or without capturing it), so nothing substantive is available to hash at signing time.

**What closing it looks like:** bind the canonical hash of the delivered payload — or a stable fingerprint of it — at signing time, so every entry commits to content.

**What closing it buys you:** your entries become *evidentiary*. That is the difference between "we keep a signed log" and "we can prove what we delivered" — and it is the single highest-leverage change available to you.

**Verify it yourself, in one command** — this is the figure we publish, and you can reproduce it without us:

```bash
curl -s https://api.automaton-sovereign.workers.dev/v2/ledger \
| jq '[.[] | select(.dataHash == "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a")] | length'
# → N entries bind sha256("{}") — an empty object
```

**Reproducibility:** every figure above is recomputed in each weekly census and published in §4.1 of the W1 report. Status: `gap`.

---

## 5. The two `pending` items — and what we need from you

`settlementLinkage` and `redeemCountDerivable` are **pending, not failed**. Both require the request fingerprint that ties a ledger entry to the settled request. We deliberately record these as *expected gaps*, not defects — the limitation is in what is published, not in your implementation.

**If automaton publishes (or shares) the fingerprint scheme, both predicates can be resolved and would likely convert to `pass`.** This is the fastest way to move from "3 passes + 1 gap" to "5 passes + 1 gap".

---

## 6. Your position in the ecosystem (W1 census)

| Dimension | Count |
|---|--:|
| Public x402 resources listed across discovery directories | 150 |
| Distinct seller origins | 60 |
| Settlement authorities (facilitators / ledgers / receipt services) | 17 |
| **Total endpoints probed** | **77** |
| **Endpoints exposing persistent verifiable evidence** | **2 (3%)** |
| Seller origins with their own attestation surface | **0 / 60** |
| Settlement authorities that settle but do not attest | **14 / 17** |

**You are one of two.** The other is a signed-receipt implementation (`inference.bsvkey.com`). The remaining 75 endpoints — including every seller origin we probed and 14 of 17 settlement authorities — cannot attest to what they settled.

---

## 7. Reproducibility

Every figure in this profile comes from unauthenticated requests to public endpoints and can be reproduced:

```bash
curl -s https://api.automaton-sovereign.workers.dev/v2/ledger
curl -s https://api.automaton-sovereign.workers.dev/v2/pubkey
```

The full census runs weekly and is published in the W1 report. We do not require access to your internals, and we do not custody assets.

---

## 8. What `gates-probe Verified` certification gives you

You are already in the 3% — but today that fact is **unverified by anyone independent**, and therefore unusable in a procurement or compliance context. Certification converts it into an asset you can cite:

- **Independent third-party confirmation** that you expose persistent verifiable evidence — usable in RFPs, enterprise sales, and compliance responses;
- **A published quality profile**, re-scored quarterly, showing your predicate-by-predicate status over time;
- **A badge** referencing a public, reproducible method (not a self-assertion);
- **Priority re-assessment** as you close `contentBinding` and publish the request fingerprint.

---

## 9. The ask

We would like to certify automaton-sovereign as **`gates-probe Verified`** — the first attestation-ledger implementation in the public x402 ecosystem to hold it.

**Annual certification: $3,000–$10,000** (scope-dependent), including quarterly re-scoring and the published profile.

Two things we want to be explicit about, because they are the basis of our own credibility:

1. **Public scoring is never influenced by payment.** Certification buys assessment depth, re-scoring, and the right to cite the mark — it does not buy a result. Your `contentBinding` gap will be published as a gap until it is closed.
2. **We are not a competitor.** We do not settle, do not custody, do not run a facilitator. We only measure.

**Suggested next step:** a 30-minute call, or simply reply and we will send the full predicate-level output for your endpoints.

---

*Prepared by gates-probe · independent attestation census · non-custodial · protocol-neutral*
