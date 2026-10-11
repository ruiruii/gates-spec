# Deep Attestation Quality Profile — bsvkey

**Subject:** `https://inference.bsvkey.com`
**Evidence form:** `signed-receipt` — per-delivery signed receipt with published key document
**Assessment date:** 2026-10-11 · **Census:** W1 (public x402 ecosystem)
**Assessed by:** gates-probe — independent, non-custodial, protocol-neutral
**Basis:** public-endpoint probing only. Every result below is reproducible (§6).

---

## 1. Executive summary

bsvkey is **one of only 2 endpoints out of 77** publicly probed in the x402 ecosystem — and **1 of 17** settlement authorities — that exposes a persistent, independently verifiable evidence surface. In our weekly census, **97% of endpoints settle without attestation**. You are in the 3%.

You are also the **only signed-receipt implementation** we found. The other evidence-bearing endpoint (`api.automaton-sovereign.workers.dev`) uses a hash-chain ledger; every other endpoint — including 14 of 17 settlement authorities and all 60 seller origins — exposes no persistent evidence surface at all.

**What we verified:** you publish a receipt key document, which is what makes offline verification possible in principle.

**What we could not yet verify:** receipt-level properties — whether each receipt actually binds the request and delivered content. That requires a sample receipt or a documented receipt format, and it is the substance of what a certification engagement would assess (§4).

---

## 2. What we verified (surface probing)

| Evidence surface | Path | Result |
|---|---|---|
| Receipt key document | `/v1/receipt-key` | **present** — 2xx + JSON |

**Note on method:** a surface counts as present **only when it returns 2xx AND a JSON document**. HTML landing pages and error pages are rejected, so that "looks like a ledger but returns HTML" endpoints are not misclassified as evidence-bearing.

---

## 3. Why publishing the receipt key is the load-bearing part

Most payment systems produce internal records. What makes a **receipt** different is that it is **verifiable by the counterparty without trusting the issuer**: the payer (or an auditor, or a court) can check the signature against a published key, offline, indefinitely.

That property depends entirely on the key being published and resolvable — which is exactly what `/v1/receipt-key` provides. It is the reason bsvkey is classified as evidence-bearing rather than settlement-only.

In a market where **no seller origin we probed exposes any evidence surface**, and where **14 of 17 settlement authorities settle without attesting**, "the counterparty can prove what they paid for" is a genuine differentiator.

---

## 4. Receipt-level assessment — what we would measure, and what is still open

Our seven-predicate ledger suite applies to hash-chain ledgers. For the `signed-receipt` form we assess a parallel set of dimensions. We are listing them explicitly, including what is **not yet verified**, because an assessment that hides its own gaps is worthless:

| Dimension | What it asks | Status |
|---|---|---|
| **Receipt key published & resolvable** | Is a current key retrievable by a third party? | **verified** |
| **Receipt content binding** | Does each receipt commit to the delivered content, or only to metadata? | **not yet verified** |
| **Request linkage** | Can a receipt be tied to the specific request and settlement? | **not yet verified** |
| **Offline verifiability** | Can a third party verify a receipt with no further call to the issuer? | **not yet verified** |
| **Key rotation & history** | Are historical keys retained so old receipts stay verifiable? | **not yet verified** |
| **Retention / availability** | Is there a stated retention period for receipts? | **not yet verified** |
| **Settlement state modelling** | Is settlement outcome three-valued rather than boolean? | **not yet verified** |

**To resolve the open items we need one of:** a few sample receipts (redacted if you prefer), or documentation of the receipt format and signing scheme. We do not need access to your systems, keys, or funds.

We want to be precise about our own position here: **we are not claiming bsvkey's receipts are complete.** We are claiming that bsvkey is one of only two endpoints that publish a verifiable evidence surface at all — which is independently confirmed and, on its own, already rare.

---

## 5. Your position in the ecosystem (W1 census)

| Dimension | Count |
|---|--:|
| Public x402 resources listed across discovery directories | 150 |
| Distinct seller origins | 60 |
| Settlement authorities (facilitators / ledgers / receipt services) | 17 |
| **Total endpoints probed** | **77** |
| **Endpoints exposing persistent verifiable evidence** | **2 (3%)** |
| Seller origins with their own attestation surface | **0 / 60** |
| Settlement authorities that settle but do not attest | **14 / 17** |

**You are one of two — and the only signed-receipt implementation.** As agent-mediated payments grow and buyers begin asking "can you prove what was delivered?", that position becomes commercially load-bearing.

---

## 6. Reproducibility

```bash
curl -s https://inference.bsvkey.com/v1/receipt-key
```

The full census runs weekly and is published in the W1 report. We require no access to your internals and custody no assets.

---

## 7. What `gates-probe Verified` certification gives you

You are in the 3%, but today that fact is **unverified by anyone independent** — which makes it unusable in procurement, compliance, or enterprise sales. Certification turns it into something you can cite:

- **Independent third-party confirmation** that you publish a verifiable receipt surface;
- **A receipt-level assessment** resolving the seven dimensions in §4 — the substance most implementations cannot show;
- **A published quality profile**, re-scored quarterly;
- **A badge** referencing a public, reproducible method rather than a self-assertion.

---

## 8. The ask

We would like to assess bsvkey's receipts at the receipt level and, on that basis, certify you as **`gates-probe Verified`** — the first signed-receipt implementation in the public x402 ecosystem to hold it.

**Annual certification: $3,000–$10,000** (scope-dependent), including quarterly re-scoring and the published profile.

Two things we want to state plainly, because our own credibility depends on them:

1. **Public scoring is never influenced by payment.** Certification buys assessment depth, re-scoring, and the right to cite the mark — not a favourable result. Any dimension we cannot verify is published as unverified.
2. **We do not compete with you.** We do not settle, do not custody, do not run a facilitator. We only measure.

**Suggested next step:** send us a couple of sample receipts (redacted is fine) or a link to the receipt format documentation — we will return the full seven-dimension assessment at no cost, and then discuss certification.

---

*Prepared by gates-probe · independent attestation census · non-custodial · protocol-neutral*
