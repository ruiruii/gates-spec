# Conformance vectors

This directory contains signed VSR envelopes used by the test suite and by any
independent implementation that wants to verify interoperability.

## Files

| File | Kind | Expected result |
|------|------|---------------|
| `valid-consumed-yes.json` | valid L2 | `consumed = yes`, `redeem_count = 1` |
| `valid-consumed-unknown.json` | valid L1 | `consumed = unknown` — buyer did not instrument downstream |
| `valid-consumed-no-idle-spend.json` | valid L2 | `consumed = no` — delivered but never used |
| `valid-redeem-count-3.json` | valid L2 | `redeem_count = 3` — one proof redeemed three times |
| `valid-agent-side-bilateral.json` | valid L2 | agent runtime co-signs consumption |
| `invalid-missing-consumed.json` | invalid | `result.consumed` is required |
| `invalid-tampered-redeem-count.json` | invalid | signature fails after `redeem_count` is tampered |
| `invalid-embedded-proof.json` | invalid | raw payment credential detected — red line violation |
| `invalid-unsigned-l0.json` | L0 telemetry | no signature; schema requires one |
| `manifest.json` | metadata | expected `level`, `schemaValid`, `signatureValid` for each case |

## Regenerating

```bash
npm run vectors
```

This deterministically rebuilds every vector file and `manifest.json`.

## Verifying against the manifest

```bash
npm run verify
```

This checks each envelope against both the JSON Schema and the semantic rules,
and compares the result to `manifest.json` expectations.
