# SYCEE — archived

> **⚠️ This repository has been archived.**
>
> **Development continues at [`ruiruii/sycee`](https://github.com/ruiruii/sycee).**
> This copy is read-only and preserved for historical reference only.
> Do not open issues or PRs here.

![status: archived](https://img.shields.io/badge/status-archived-lightgrey)

`SYCEE` is a protocol-agnostic semantic layer for machine payments. It answers
two questions that upstream protocols do not yet define:

1. **Was the paid result actually consumed by downstream context?**
2. **How many times was the same payment proof redeemed?**

This repository is the **pre-migration snapshot** of the SYCEE specification,
reference implementation, conformance suite, and proposal path. All active
development, CI, conformance-vector regeneration, and issue/PR discussion now
live in [`ruiruii/sycee`](https://github.com/ruiruii/sycee).

---

## Where to go

| Need | Where |
|------|-------|
| Latest specification | [`ruiruii/sycee` → `SPEC.md`](https://github.com/ruiruii/sycee/blob/main/SPEC.md) |
| Conformance vectors | [`ruiruii/sycee` → `conformance/vectors/`](https://github.com/ruiruii/sycee/tree/main/conformance/vectors) |
| Reference implementation | [`ruiruii/sycee` → `packages/`](https://github.com/ruiruii/sycee/tree/main/packages) |
| CI / conformance runs | [`ruiruii/sycee` → Actions](https://github.com/ruiruii/sycee/actions) |
| New issues / PRs | [`ruiruii/sycee` → Issues](https://github.com/ruiruii/sycee/issues) |

---

## Why this snapshot was preserved

The SYCEE project was originally published as `gates-spec` (v0.1) and renamed
to `SYCEE` in October 2026. The rename happened **twice**:

1. **In-repo rename** — `gates-spec` → `SYCEE` (schema_version `gates-spec/v0.1` → `sycee/v0.1`,
   package names `@gates-spec/*` → `@sycee/*`). GitHub's redirect still resolves old
   URLs to the new names inside this same repository.
2. **Cross-repo migration** — the project moved from `ruiruii/gates-spec` (this
   repository) to [`ruiruii/sycee`](https://github.com/ruiruii/sycee). This repository
   was archived at that point.

This snapshot is kept so that links, citations, and commit SHAs referenced in
issues, PRs, IETF drafts, and ERC proposals remain resolvable. The canonical
source of truth is [`ruiruii/sycee`](https://github.com/ruiruii/sycee).

---

## Name

Two identifiers changed with the in-repo rename and are not interchangeable:

| was | is |
|-----|-----|
| `gates-spec/v0.1` (receipt `schema_version`) | `sycee/v0.1` |
| `@gates-spec/{core,middleware,agent-sdk,conformance,adapter-automaton,probe}` | `@sycee/{...}` |

Because the version string is one of the inputs to a vector fingerprint, every
conformance vector hash changed when it moved. The twelve vectors were
regenerated with the repository's own generator, not patched by hand, and the
three rejection paths survived: schema-rejected, signature-rejected, and
semantic (`level: invalid`).

---

## One-line pitch

> "Others prove delivery; we prove consumption."
> （别人证明“送到了”；我们证明“被用了”。）

---

## Why this matters

| Layer | Question it answers | State of the art | What is missing |
|-------|--------------------|------------------|-----------------|
| x402, MPP, AP2, APOP | How does the agent pay? | Standards and SDKs exist | — |
| x402-receipts, Vauban | Did payment happen and did the seller deliver? | Production code, IETF drafts | Consumption evidence |
| ERC-8183, VCAP | Did an evaluator judge work complete? | Escrow / verdict layers | Non-custodial, non-scoring evidence |
| **SYCEE** | **Was the result consumed? How many redemptions?** | **[`ruiruii/sycee`](https://github.com/ruiruii/sycee)** | — |

An HTTP `200` means the response was delivered. It does **not** mean the agent:
- put the result in a prompt,
- passed it to another tool,
- stored it in working memory, or
- showed it to a user.

That gap is idle spend. It is also the gap where the same `payment_proof` can be
redeemed against multiple resources without anyone noticing. `SYCEE`
makes both observable.

---

## What is in this snapshot

```
SYCEE/
├── SPEC.md                    # normative specification v0.1
├── schema/vsr-v0.1.schema.json # JSON Schema for Verifiable Spend Receipts
├── conformance/vectors/        # signed conformance test vectors
├── packages/
│   ├── core/                   # canonical JSON, Ed25519 sign/verify, VSR builder
│   ├── middleware/             # merchant-side HTTP middleware (counts redemptions)
│   ├── agent-sdk/              # buyer-side agent SDK (records consumption)
│   ├── conformance/            # zero-dependency conformance runner
│   ├── adapter-automaton/      # adapter for upstream x402 / x402-receipts
│   └── probe/                  # CLI probe
├── examples/
├── reports/                    # generated reports (audit, census)
├── outreach/                   # IETF / ERC / ecosystem notes
├── upstream/                   # upstream spec diffs
└── TRANSPARENCY.{en,zh}.md     # evidence-layer transparency notes
```

---

## Status

| Item | Value |
|------|-------|
| Last commit on this repo | `780f4f3` (2026-10-20) |
| Archived | 2026-10-21 |
| Canonical home | [`ruiruii/sycee`](https://github.com/ruiruii/sycee) |
| License | MIT (see `LICENSE`) |
| Status | **archived, read-only** |

---

## License

MIT. See [`LICENSE`](./LICENSE).
