# gates-spec

> **We record. Others score.**  
> **记录消费与兑现实；不评分、不托管、不触碰资金。**

`gates-spec` is a protocol-agnostic semantic layer for machine payments. It answers
two questions that upstream protocols do not yet define:

1. **Was the paid result actually consumed by downstream context?**
2. **How many times was the same payment proof redeemed?**

Existing work (x402-receipts, Vauban IETF drafts, ERC-8183, VCAP, APOP/APASS)
focuses on **receipt format and delivery proof**: "Did the seller send the bytes?"
`gates-spec` focuses on **outcome semantics**: "Did the buyer use the bytes?"

This repository contains the specification, a reference implementation, a
zero-dependency conformance suite, and a proposal path to upstream standards.

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
| **gates-spec** | **Was the result consumed? How many redemptions?** | **This repo** | — |

An HTTP `200` means the response was delivered. It does **not** mean the agent:
- put the result in a prompt,
- passed it to another tool,
- stored it in working memory, or
- showed it to a user.

That gap is idle spend. It is also the gap where the same `payment_proof` can be
redeemed against multiple resources without anyone noticing. `gates-spec`
makes both observable.

---

## What is in this repo

```
gates-spec/
├── SPEC.md                    # normative specification v0.1
├── schema/vsr-v0.1.schema.json # JSON Schema for Verifiable Spend Receipts
├── conformance/vectors/        # signed conformance test vectors
├── packages/
│   ├── core/                   # canonical JSON, Ed25519 sign/verify, VSR builder
│   ├── middleware/             # merchant-side HTTP middleware (counts redemptions)
│   ├── agent-sdk/              # agent-runtime SDK (records consumption)
│   └── conformance/            # test suite, validator, CLI
├── upstream/                   # ready-to-send proposals to x402-receipts, Vauban, ERC-8004
└── examples/                   # minimal runnable demos
```

All packages are **zero-dependency** and use Node native Ed25519 (`crypto`).

---

## Quick start

```bash
git clone https://github.com/ruiruii/gates-spec.git
cd gates-spec
npm install          # links local workspaces
npm test             # runs conformance + e2e tests
npm run vectors      # regenerates conformance/vectors/*.json
npm run verify conformance/vectors/*.json
```

### Merchant middleware (Node/Express-style)

```js
import { createGates, memoryStore } from '@gates-spec/middleware';
import { generateKeyPair } from '@gates-spec/core';

const { publicKey, privateKey } = generateKeyPair();

const gates = createGates({
  resourceId: 'search.v1',
  protocol: 'x402',
  price: { value: '0.010000', currency: 'USDC' },
  publicKey,
  privateKey,
  store: memoryStore(),   // or redisStore(client)
});

const handler = async () => ({ status: 200, body: { ok: true } });
app.get('/search', gates.guard(handler));
```

### Agent SDK

```js
import { createSpend } from '@gates-spec/agent-sdk';
import { generateKeyPair } from '@gates-spec/core';

const agentKeys = generateKeyPair();
const spend = createSpend({
  agentId: 'erc8004:8453:0xAGENT',
  publicKey: agentKeys.publicKey,
  privateKey: agentKeys.privateKey,
  pay: async (challenge, init, url) => {
    // your wallet logic; return the proof string or header map
    return 'payment-proof-bytes';
  },
});

const res = await spend.fetch('https://api.example/search?q=ai');
const receipt = res.gates.consumedBy('task_4829'); // signs consumed=yes
```

### Offline verification

```js
import { verifyVSR } from '@gates-spec/core';

const check = verifyVSR(envelope);
console.log(check.valid, check.level, check.errors, check.warnings);
```

---

## Relationship to adjacent projects

`gates-spec` is **additive**, not competitive.

| Project | Defines | `gates-spec` adds |
|---------|---------|-----------------|
| **x402-receipts** (npm, production) | Receipt format, request hash, delivery status, dual signature, EAS anchor | `consumed` / `consumed_by` / `redeem_count`; multi-rail |
| **IETF draft-vauban-x402-*** | Receipt format, post-quantum signatures, Starknet anchoring, `action_ref` binding | `consumed` / `redeem_count`; protocol-agnostic |
| **ERC-8183** | On-chain escrow, evaluator verdict, task lifecycle | Off-chain non-custodial consumption evidence |
| **VCAP / SwarmSync** | Escrowed settlement, delivery proof, reputation score | Non-escrow, non-scoring; `consumed` / `redeem_count` |
| **APASS / APOP** | Rail-native trust evidence | Cross-rail evidence; outcome semantics |
| **ERC-8004** | Agent identity and payment-proof schema | Reserved fields for `consumed` / `redeem_count` |

---

## Conformance levels

| Level | Required | Meaning |
|-------|----------|---------|
| **L0** | Emit `payment.proof_hash`, `delivery.status`, `result.consumed`, `payment.redeem_count` | Telemetry only |
| **L1** | L0 + signed VSR from one side | Assertion, not attestation |
| **L2** | L1 + merchant signature **and** agent runtime co-signature | `consumed` is attested; `completeness = bilateral` |

---

## Red lines

A conforming implementation **MUST NOT**:

1. Store or transport raw payment proof bodies.
2. Produce trust, credit, or reputation scores.
3. Move funds or act as an escrow.

These rules are structural, not policy.

---

## Roadmap

| Phase | Goal | Owner | Deadline |
|-------|------|-------|----------|
| 1 | Publish `gates-spec v0.1` repo + SPEC.md | Sycee | **DONE** |
| 2 | Propose field alignment to x402-receipts, Vauban, ERC-8004 v2 | Sycee | **DONE** (see below) |
| 3 | First independent implementation adopts `consumed` / `redeem_count` names | x402-receipts / minia2a | **D+30** |
| 4 | Run merchant + agent SDK against Brave / bx402#102 test case | Sycee | **D+30** |
| 5 | Cross-rail support: APOP, alipay-a2m, a2p2 | Sycee / partners | **D+90** |

## Upstream outreach

The objective is **one vocabulary, not a new project**. If another standard adopts these
field names, gates-spec adopts theirs.

| Target | Channel | Status |
|--------|---------|--------|
| x402-receipts (StelarDigital) | GitHub issue | [StelarDigital/x402-receipts#6](https://github.com/StelarDigital/x402-receipts/issues/6) — open |
| ERC-8004 v2 | GitHub issue | [erc-8004/erc-8004-contracts#102](https://github.com/erc-8004/erc-8004-contracts/issues/102) — open |
| Vauban Research (IETF) | email | `research@vauban.tech` — draft in [`upstream/email-vauban-liaison.md`](./upstream/email-vauban-liaison.md) |

Hard external deadline: **Vauban `draft-vauban-x402-stark-receipts` expires 2026-11-29**.
The `consumed` semantic must be published and have at least one adopter before that date,
otherwise Vauban (or another draft) will define the adjacent field first.

---

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) and the [`upstream/`](./upstream) proposals.
All contributions are under Apache-2.0.

## License

Apache-2.0. See [LICENSE](./LICENSE).
