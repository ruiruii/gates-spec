# Contributing to gates-spec

Thank you for helping define the `consumed` and `redeem_count` semantics for machine payments.

## What we need most right now

1. **Independent implementations** in another language (Go, Rust, Python, TypeScript). A
   minimal Ed25519 signer + JSON canonicalizer is enough.
2. **Upstream alignment** pull requests:
   - x402-receipts: extend `delivery` with `consumed` and `payment` with `redeem_count`.
   - Vauban IETF drafts: adopt `consumed` / `redeem_count` as optional extensions.
   - ERC-8004 v2: reserve `agent.spend.result.consumed` / `agent.spend.payment.redeem_count`.
3. **Real-world test vectors**: signed receipts from production agent payment flows.
4. **Protocol mapping PRs**: for rails we have not yet covered (AP2, card-a2a, etc.).

## Ground rules

- **Do not break the three red lines.** No fund movement, no scoring, no storing of raw
  payment proof bodies.
- **Additive only.** This spec never redefines an existing field from another standard.
- **Keep packages zero-dependency.** The core validator and signer must run in a clean
  Node environment.
- **Back your claim with data.** If you say a competitor already defines `consumed`, include
  a link to the spec line or source file.

## How to propose a change

1. Open an issue describing the problem with a minimal example.
2. If you can, include the exact VSR before/after your change.
3. Run `npm test` and `npm run vectors` before submitting.
4. Keep language: **normative text in English**; examples and explanatory comments may be
   bilingual.

## Commit messages

- `spec: <what>` for SPEC.md changes
- `schema: <what>` for JSON Schema changes
- `feat(core|middleware|agent-sdk|conformance): <what>` for implementation changes
- `test: <what>` for tests and vectors
- `upstream: <target>` for proposals to other standards

## Code of conduct

Be direct. Be evidence-based. No marketing.
