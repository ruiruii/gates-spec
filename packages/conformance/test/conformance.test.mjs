import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEnvelope } from '../src/index.mjs';
import { canonicalJSON, generateKeyPair, sha256, signVSR, verifyVSR, buildVSR, normalizeSettlement } from '@gates-spec/core';

const VECTORS = new URL('../../../conformance/vectors/', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('manifest.json', VECTORS), 'utf8'));

test('canonical JSON sorts keys recursively and has no whitespace', () => {
  const a = canonicalJSON({ b: 1, a: { d: 2, c: 3 } });
  assert.equal(a, '{"a":{"c":3,"d":2},"b":1}');
});

test('sha256 prefix format', () => {
  assert.match(sha256('abc'), /^sha256:[0-9a-f]{64}$/);
});

test('signature round-trips and survives canonical reordering', () => {
  const { publicKey, privateKey } = generateKeyPair();
  const vsr = buildVSR({
    protocol: 'x402',
    resourceId: 'r',
    proofHash: sha256('p'),
    redeemCount: 1,
    publicKey,
    role: 'merchant',
  });
  const env = signVSR(vsr, privateKey);
  assert.equal(verifyVSR(env).valid, true);
  // reorder keys in a literal copy -> must still verify
  const shuffled = { vsr: Object.fromEntries(Object.entries(env.vsr).reverse()), signature: env.signature };
  assert.equal(verifyVSR(shuffled).valid, true);
});

test('tampering with redeem_count breaks the signature', () => {
  const { publicKey, privateKey } = generateKeyPair();
  const env = signVSR(
    buildVSR({ protocol: 'x402', resourceId: 'r', proofHash: sha256('p'), redeemCount: 3, publicKey, role: 'merchant' }),
    privateKey,
  );
  env.vsr.payment.redeem_count = 1;
  const r = verifyVSR(env);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some((e) => e.startsWith('signature')));
});

test('unknown is never treated as yes', () => {
  const { publicKey, privateKey } = generateKeyPair();
  const env = signVSR(
    buildVSR({ protocol: 'x402', resourceId: 'r', proofHash: sha256('p'), redeemCount: 1, consumed: 'unknown', publicKey, role: 'merchant' }),
    privateKey,
  );
  const r = verifyVSR(env);
  assert.equal(r.valid, true);
  assert.notEqual(env.vsr.result.consumed, 'yes');
  assert.ok(r.warnings.some((w) => w.includes('unknown')));
});

test('redeem_count > 1 raises a warning but stays valid', () => {
  const { publicKey, privateKey } = generateKeyPair();
  const env = signVSR(
    buildVSR({ protocol: 'x402', resourceId: 'r', proofHash: sha256('p'), redeemCount: 4, publicKey, role: 'merchant' }),
    privateKey,
  );
  const r = verifyVSR(env);
  assert.equal(r.valid, true);
  assert.ok(r.warnings.some((w) => w.includes('redeem_count = 4')));
});

test('settlement predicate: in_flight is unproven, not refuted', () => {
  const { publicKey, privateKey } = generateKeyPair();
  const env = signVSR(
    buildVSR({ protocol: 'x402', resourceId: 'r', proofHash: sha256('p'), redeemCount: 1, settlementStatus: 'in_flight', deliveryStatus: 'delivered', publicKey, role: 'merchant' }),
    privateKey,
  );
  const r = verifyVSR(env);
  assert.equal(r.valid, true, 'the envelope is coherent; only the payment leg is undecided');
  assert.equal(r.settlement.status, 'in_flight');
  assert.equal(r.settlement.finalized, false);
  assert.equal(r.settlement.consistency, 'incomplete');
  assert.ok(r.warnings.some((w) => w.includes('unproven')));

  // fail-closed: a verifier that needs a settled payment must be able to say no,
  // with a reason that is distinguishable from "refuted"
  const strict = verifyVSR(env, { requireSettled: true });
  assert.equal(strict.valid, false);
  assert.ok(strict.errors.some((e) => e.includes('in_flight')));
});

test('settlement predicate: delivered with absent settlement is a contradiction', () => {
  const { publicKey, privateKey } = generateKeyPair();
  const env = signVSR(
    buildVSR({ protocol: 'x402', resourceId: 'r', proofHash: sha256('p'), redeemCount: 1, settlementStatus: 'absent', deliveryStatus: 'delivered', publicKey, role: 'merchant' }),
    privateKey,
  );
  const r = verifyVSR(env);
  assert.equal(r.valid, false);
  assert.equal(r.settlement.consistency, 'contradiction');
  assert.ok(r.errors.some((e) => e.includes('contradiction')));
  // opt-out exists for sellers that knowingly fulfil without payment
  assert.equal(verifyVSR(env, { allowUnpaidDelivery: true }).valid, true);
});

test('settlement predicate defaults to in_flight, never absent', () => {
  const { publicKey, privateKey } = generateKeyPair();
  const env = signVSR(
    buildVSR({ protocol: 'x402', resourceId: 'r', proofHash: sha256('p'), redeemCount: 1, publicKey, role: 'merchant' }),
    privateKey,
  );
  assert.equal(env.vsr.payment.settlement_status, 'in_flight');
  assert.equal(verifyVSR(env).settlement.status, 'in_flight');
});

test('wire values map onto the spec enum: true -> settled, queued -> in_flight', () => {
  assert.equal(normalizeSettlement(true), 'settled');
  assert.equal(normalizeSettlement('true'), 'settled');
  assert.equal(normalizeSettlement('queued'), 'in_flight');
  assert.equal(normalizeSettlement(false), 'absent');
  assert.equal(normalizeSettlement('absent'), 'absent');
  // no signal at all is not "no payment"
  assert.equal(normalizeSettlement(undefined), 'in_flight');
  assert.equal(normalizeSettlement('garbage'), 'in_flight');
});

test(`conformance vectors (${manifest.cases.length} cases)`, () => {
  for (const c of manifest.cases) {
    const doc = JSON.parse(readFileSync(new URL(c.file, VECTORS), 'utf8'));
    const r = checkEnvelope(doc);
    assert.equal(r.schemaValid, c.schemaValid, `${c.file}: schemaValid`);
    assert.equal(r.signatureValid, c.signatureValid, `${c.file}: signatureValid`);
    assert.equal(r.level, c.level, `${c.file}: level`);
  }
});
