#!/usr/bin/env node
/**
 * gates-conformance CLI
 *
 *   node src/cli.mjs verify <file.json> [...]   run full conformance check
 *   node src/cli.mjs span   <file.json>         print agent.spend.* span attributes
 *   node src/cli.mjs gen-vectors                (re)generate conformance/vectors
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkEnvelope } from './index.mjs';
import { buildVSR, generateKeyPair, nowISO, sha256, signVSR } from '@gates-spec/core';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const VECTORS = resolve(repoRoot, 'conformance/vectors');

const [, , cmd, ...args] = process.argv;

switch (cmd) {
  case 'verify':
    runVerify(args);
    break;
  case 'span':
    runSpan(args);
    break;
  case 'gen-vectors':
    genVectors();
    break;
  default:
    process.stdout.write(`usage: gates-conformance <verify|span|gen-vectors> [files...]\n`);
    process.exit(1);
}

function runVerify(args) {
  const useManifest = args.includes('--manifest');
  const files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) {
    process.stderr.write('verify: no input files\n');
    process.exit(1);
  }
  /** @type {Map<string, any>} */
  let expectations = new Map();
  if (useManifest) {
    try {
      const m = JSON.parse(readFileSync(resolve(process.cwd(), 'conformance/vectors/manifest.json'), 'utf8'));
      for (const c of m.cases) expectations.set(c.file, c);
    } catch {}
  }

  let failed = 0;
  for (const file of files) {
    const envelope = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));
    const report = checkEnvelope(envelope);
    const exp = expectations.get(file);
    const expectedValid = exp
      ? exp.schemaValid && exp.signatureValid && exp.level !== 'invalid'
      : true;
    const actualValid = report.schemaValid && report.signatureValid && report.level !== 'invalid';
    const matches =
      !exp ||
      (report.schemaValid === exp.schemaValid &&
        report.signatureValid === exp.signatureValid &&
        report.level === exp.level);
    const status = matches ? 'PASS' : 'FAIL';
    if (!matches) failed++;
    process.stdout.write(
      `${status}  ${file}\n` +
        `      level=${report.level} schema=${report.schemaValid} signature=${report.signatureValid}\n`,
    );
    if (exp) {
      process.stdout.write(
        `      expected level=${exp.level} schema=${exp.schemaValid} signature=${exp.signatureValid}\n`,
      );
    }
    for (const e of report.schemaErrors) process.stdout.write(`      schema:   ${e}\n`);
    for (const e of report.semanticErrors) process.stdout.write(`      semantic: ${e}\n`);
    for (const w of report.warnings) process.stdout.write(`      warning:  ${w}\n`);
  }
  process.exit(failed ? 1 : 0);
}

function runSpan(files) {
  for (const file of files) {
    const envelope = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf8'));
    process.stdout.write(JSON.stringify(checkEnvelope(envelope).spanAttributes, null, 2) + '\n');
  }
}

/* ------------------------------------------------------------------ *
 * Vector generation
 * ------------------------------------------------------------------ */

function genVectors() {
  mkdirSync(VECTORS, { recursive: true });
  const keys = generateKeyPair();
  const proof = 'PAYMENT-SIGNATURE:deadbeef'; // illustrative only; never stored
  const proofHash = sha256(proof);

  /** @type {Array<{name: string, build: () => any, expect: any}>} */
  const cases = [
    {
      name: 'valid-consumed-yes',
      expect: { schemaValid: true, signatureValid: true, level: 'L2', note: 'bilateral hint present' },
      build: () => envelope(buildVSR({
        protocol: 'x402',
        resourceId: 'search.v1',
        proofHash,
        redeemCount: 1,
        redeemResources: ['search.v1'],
        deliveryStatus: 'delivered',
        deliveredAt: '2026-10-09T12:00:01.800Z',
        consumed: 'yes',
        consumedBy: ['task_4829'],
        consumedAt: '2026-10-09T12:00:05.100Z',
        requestFingerprint: sha256('GET /search {"q":"agent payments"}'),
        proofSeenAt: '2026-10-09T12:00:00.000Z',
        completeSeenAt: '2026-10-09T12:00:01.200Z',
        amount: { value: '0.010000', currency: 'USDC' },
        bytes: 4821,
        publicKey: keys.publicKey,
        agentId: 'erc8004:8453:0x9a1f',
        keyId: '2026Q4-01',
        role: 'merchant',
        completeness: 'bilateral',
      })),
    },
    {
      name: 'valid-consumed-unknown',
      expect: { schemaValid: true, signatureValid: true, level: 'L1', note: 'no downstream instrumentation' },
      build: () => envelope(buildVSR({
        protocol: 'x402',
        resourceId: 'search.v1',
        proofHash,
        redeemCount: 1,
        deliveryStatus: 'delivered',
        deliveredAt: '2026-10-09T12:00:01.800Z',
        consumed: 'unknown',
        publicKey: keys.publicKey,
        role: 'merchant',
        completeness: 'unilateral_merchant',
      })),
    },
    {
      name: 'valid-consumed-no-idle-spend',
      expect: { schemaValid: true, signatureValid: true, level: 'L2', note: 'delivered, never referenced' },
      build: () => envelope(buildVSR({
        protocol: 'x402',
        resourceId: 'search.v1',
        proofHash,
        redeemCount: 1,
        deliveryStatus: 'delivered',
        deliveredAt: '2026-10-09T12:00:01.800Z',
        consumed: 'no',
        publicKey: keys.publicKey,
        role: 'agent',
        completeness: 'bilateral',
      })),
    },
    {
      name: 'valid-redeem-count-3',
      expect: { schemaValid: true, signatureValid: true, level: 'L2', note: 'one proof, three completions' },
      build: () => envelope(buildVSR({
        protocol: 'x402',
        resourceId: 'search.v1',
        proofHash,
        redeemCount: 3,
        redeemResources: ['search.v1', 'fetch.v1', 'summarize.v1'],
        deliveryStatus: 'delivered',
        deliveredAt: '2026-10-09T12:00:09.800Z',
        consumed: 'yes',
        consumedBy: ['task_4829', 'task_4830'],
        consumedAt: '2026-10-09T12:00:12.100Z',
        publicKey: keys.publicKey,
        role: 'merchant',
        completeness: 'bilateral',
      })),
    },
    {
      // The whole point of gates-spec: the seller never sees consumption.
      // This receipt is signed by the agent runtime instead.
      name: 'valid-agent-side-bilateral',
      expect: { schemaValid: true, signatureValid: true, level: 'L2', note: 'agent attests consumption' },
      build: () => envelope(buildVSR({
        protocol: 'x402',
        resourceId: 'search.v1',
        proofHash,
        redeemCount: 1,
        deliveryStatus: 'delivered',
        deliveredAt: '2026-10-09T12:00:01.800Z',
        consumed: 'yes',
        consumedBy: ['task_4829'],
        consumedAt: '2026-10-09T12:00:05.100Z',
        publicKey: keys.publicKey,
        agentId: 'erc8004:8453:0x9a1f',
        role: 'agent',
        completeness: 'bilateral',
      })),
    },
    {
      name: 'invalid-missing-consumed',
      expect: { schemaValid: false, signatureValid: true, level: 'invalid', note: 'result.consumed is MUST; signature itself is valid' },
      build: () => {
        const vsr = buildVSR({
          protocol: 'x402',
          resourceId: 'search.v1',
          proofHash,
          redeemCount: 1,
          publicKey: keys.publicKey,
          role: 'merchant',
        });
        delete vsr.result.consumed;
        return envelope(vsr);
      },
    },
    {
      name: 'invalid-tampered-redeem-count',
      expect: { schemaValid: true, signatureValid: false, level: 'invalid', note: 'redeem_count 3 -> 1 after signing' },
      build: () => {
        const env = envelope(buildVSR({
          protocol: 'x402',
          resourceId: 'search.v1',
          proofHash,
          redeemCount: 3,
          publicKey: keys.publicKey,
          role: 'merchant',
        }));
        env.vsr.payment.redeem_count = 1;
        return env;
      },
    },
    {
      name: 'invalid-embedded-proof',
      expect: { schemaValid: true, signatureValid: true, level: 'invalid', note: 'raw credential hidden in _vendor — red line caught by semantic check' },
      build: () => envelope(buildVSR({
        protocol: 'x402',
        resourceId: 'search.v1',
        proofHash,
        redeemCount: 1,
        publicKey: keys.publicKey,
        role: 'merchant',
        extra: { _vendor: { payment_proof: proof } },
      })),
    },
    {
      name: 'invalid-unsigned-l0',
      expect: { schemaValid: false, signatureValid: false, level: 'L0', note: 'signature is required by the schema; without it, only L0 telemetry' },
      build: () => ({ vsr: buildVSR({
        protocol: 'x402',
        resourceId: 'search.v1',
        proofHash,
        redeemCount: 1,
        consumed: 'unknown',
        publicKey: keys.publicKey,
        role: 'merchant',
      }) }),
    },
  ];

  function envelope(vsr) {
    return signVSR(vsr, keys.privateKey);
  }

  const manifest = { version: 'gates-spec/v0.1', generatedAt: nowISO(), cases: [] };
  for (const c of cases) {
    const doc = c.build();
    writeFileSync(resolve(VECTORS, `${c.name}.json`), JSON.stringify(doc, null, 2) + '\n');
    manifest.cases.push({ file: `${c.name}.json`, ...c.expect });
    process.stdout.write(`wrote ${c.name}.json\n`);
  }
  writeFileSync(resolve(VECTORS, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  process.stdout.write(`wrote manifest.json (${manifest.cases.length} cases)\n`);
}
