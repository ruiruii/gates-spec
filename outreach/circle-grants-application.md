# Circle Grants — Application

**Project:** gates-probe — the independent attestation layer for agentic commerce
**Track:** Agentic Commerce / AI Agents
**Requested amount:** **$25,000 USDC** (non-dilutive)
**Duration:** 6 months
**Applicant:** _[name / entity — fill before submission]_

---

## 1. One-line summary

We measure, score and publish whether agent-payment endpoints provide **verifiable evidence of what was actually delivered** — and today, **97% of them do not**.

---

## 2. The problem

Agentic commerce is arriving faster than its trust layer. x402 and similar protocols let an agent pay for a resource and receive it in one round trip. **What they do not provide is evidence.** Our census of the public x402 ecosystem (W1, October 2026) found:

| Dimension | Measured |
|---|--:|
| Public x402 resources listed across discovery directories (incl. Circle's) | 150 |
| Distinct seller origins | 60 |
| Settlement authorities (facilitators / ledgers / receipt services) | 17 |
| **Total endpoints probed** | **77** |
| **Endpoints exposing persistent, verifiable evidence** | **2 — 3%** |
| Seller origins with their own attestation surface | **0 / 60** |
| Settlement authorities that settle but do not attest | **14 / 17** |

**The consequences are concrete:**

- An agent that paid **cannot prove what it received**;
- A seller **cannot prove what it delivered**;
- A dispute has **no adjudicable record**;
- An enterprise buyer or compliance function **cannot adopt** a channel with no audit trail.

**And where evidence does exist, quality is not guaranteed.** Our predicate analysis of the ecosystem's one hash-chain ledger (34 entries) found that **22 of them — 64.7% — sign an empty object**: `dataHash === sha256("{}")`. That signature is cryptographically valid and evidentially empty: it proves *someone signed something at some time*, not *this content was delivered for this request*. This is the failure mode that makes "we sign every payment" worthless in practice.

The distribution tells us more: the 22 empty entries are **contiguous, indices 12–33**. The first 12 entries bind content correctly. That is the signature of a regression — a capability that existed and was lost — which means the gap is measurable, diagnosable, and recoverable. It is also exactly why a *quality* layer is needed, not just a coverage count.

> **The gap is not that nobody keeps records. It is that nobody can prove what the records commit to — and nobody is measuring it.**

---

## 3. What we are building

**gates-probe**: an independent, non-custodial, protocol-neutral **census and quality-scoring layer for attestation in agent payments**.

Already running (built and published before this application):

- A **weekly automated census** of public x402 endpoints — authority layer and seller layer;
- A **seven-predicate attestation suite**: `hashIntegrity`, `chainContinuity`, `keyring.historyAware`, `contentBinding`, `settlementLinkage`, `redeemCountDerivable`, `settlementTrivalued`;
- **Anti-false-positive method**: a surface counts as evidence **only** on 2xx + JSON. Several endpoints appear to expose a ledger but return HTML — we classify those correctly as non-evidence;
- **Public, reproducible reports**: every figure comes from unauthenticated requests to public endpoints.

**What this grant funds — Attestation Quality Scoring v1:**

1. **A weighted quality score** per endpoint, derived from coverage, content binding, chain continuity and settlement linkage — moving the question from *"do you have evidence?"* to *"is your evidence worth anything?"*;
2. **Weekly public quality reports** and a **scoring API** (public beta), so agent frameworks, wallets and marketplaces can query evidence quality before transacting;
3. **A `Verified` certification pilot** with 3–5 endpoints, including the two that already expose evidence;
4. **Contribution of the predicate suite** to the x402 standard via public issue/PR, so evidence quality becomes a measurable property of the protocol rather than a marketing claim.

---

## 4. Why this matters to Circle — and why now

- **Circle is bootstrapping the ecosystem we are measuring.** One of the two discovery directories in our census is Circle's own x402 resource directory. We are instrumenting the agentic commerce surface Circle is building.
- **Evidence is the bottleneck to agentic commerce at scale.** USDC already solves *moving the money*. The unsolved half is *proving what the money bought*. Without it, agent payments cannot clear enterprise procurement, audit, or dispute resolution.
- **Settlement and evidence are complements, not substitutes.** Growth in USDC-denominated agent payments is gated by whether counterparties can trust the record. We make that trust measurable — which makes the channel more usable, and therefore more used.
- **We are aligned with, but structurally independent from, Circle.** We do not settle, do not custody, do not operate a facilitator, and accept no influence over published results. That independence is precisely why our numbers are usable by buyers who cannot rely on a participant's self-assertion.

---

## 5. Why us / what is differentiated

| Capability | Evidence it works |
|---|---|
| Distinguishes real evidence from decoration | Correctly rejected HTML "ledger" endpoints that naive probing misclassifies |
| Detects evidentially empty signatures | Identified the `sha256("{}")` empty-object binding pathology in the ecosystem's one live ledger |
| Two-layer census (authorities + sellers) | Established that **0 of 60** sellers attest — locating the gap structurally, not anecdotally |
| Reproducible by anyone | Public endpoints, unauthenticated, method published |
| Already operating | Weekly census running and published before this application |

We are not proposing to study the problem. **We are already producing the measurement; this grant scales it from coverage to quality.**

---

## 6. Milestones & deliverables

| Milestone | Month | Deliverable |
|---|---|---|
| **M1 — Scoring specification** | 1–2 | Weighted scoring model published; predicate weights justified; implemented in the existing pipeline |
| **M2 — Public quality reporting + API** | 3–4 | Weekly quality reports live; scoring API in public beta; baseline scores for all reachable endpoints |
| **M3 — Certification pilot + standard contribution** | 5–6 | `Verified` pilot with 3–5 endpoints; predicate suite submitted to the x402 standard via public issue/PR |

**Success metrics:**

- Endpoints under continuous measurement: **77 → 300+**
- Endpoints with published quality scores: **≥ 200**
- Certification pilot participants: **3–5**
- Standard contribution: **1 submitted predicate proposal**
- Ecosystem attestation coverage tracked weekly, baseline **3%**

---

## 7. Budget — $25,000 USDC

| Item | Amount | Detail |
|---|---:|---|
| Engineering — scoring v1 + API | $14,000 | Predicate weighting, scoring implementation, API, integration into weekly pipeline |
| Infrastructure & census operations | $3,000 | Runner capacity, storage for time-series, uptime |
| Public reporting & documentation | $3,000 | Report rendering, methodology documentation, reproducibility kit |
| Certification pilot & outreach | $5,000 | Endpoint assessments, pilot coordination, ecosystem communication |
| **Total** | **$25,000** | |

> Framed deliberately as **catalytic** funding: the census already runs at near-zero marginal cost. This grant buys the quality layer and the standard contribution, not the baseline operation.

---

## 8. Sustainability beyond the grant

Grant funding is a catalyst, not the model. Post-grant revenue comes from:

- **`Verified` certification** (annual fee + re-assessment) for endpoints that want their status citable in procurement and compliance;
- **Scoring API subscriptions** for agent frameworks, wallets, marketplaces and compliance platforms;
- **Deep attestation audits** (high-ticket, one-off) for projects facing listing or compliance requirements.

**The public baseline — coverage census and the coverage rate — remains free and public permanently.** It is both our credibility source and the top of the commercial funnel. **Payment never influences a published score**; this is stated in every certification agreement and is the basis of our own credibility.

---

## 9. Independence statement

We want to be explicit, because it is the substance of what we offer:

**Funding does not purchase results.** Circle's support would be acknowledged as a grant; it would not affect any published score, and no endpoint receives a favourable assessment because of it. If the grant were perceived otherwise, the measurement would lose the only property that makes it valuable.

---

## 10. Team

_[Fill before submission — recommended content: 2–4 sentences covering (a) who is building it, (b) the relevant track record in payments / cryptography / data infrastructure, (c) evidence you can execute: the census is already running and published. Do not overstate; reviewers can verify the published reports.]_

---

## 11. Links & reproducibility

- Weekly census reports: _[link]_
- Methodology & predicate definitions: _[link]_
- Reproduce the census:
  ```bash
  node tools/w1/discover.mjs --out endpoints.txt --sellers-out sellers.txt --discovery-out discovery.json
  node tools/w1/scan.mjs     --list endpoints.txt --sellers sellers.txt --out w1-raw.json
  node tools/w1/report.mjs
  ```

---

## Before you submit — fill these in

1. **§10 Team** — who is building it, and why you can execute.
2. **§11 Links** — the live report and methodology URLs.
3. **Applicant name / entity** at the top.
4. ~~Content-binding figures~~ — already filled from the W1 census (22/34, 64.7%, indices 12–33). If you re-run before submitting, refresh from the latest weekly report.

*Prepared for Circle Grants · Cohort 2 · Agentic Commerce track*
