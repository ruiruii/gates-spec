import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EMPTY_DATA_HASH, deriveRedeemCount } from '@gates-spec/adapter-automaton';
import { generateKeyPair } from '@gates-spec/core';
import {
  probe,
  signReport,
  verifyReport,
  runPredicates,
} from '../src/index.mjs';
import {
  predicateHashIntegrity,
  predicateChainContinuity,
  predicateKeyHistoryAware,
  predicateContentBinding,
  predicateSettlementTrivalued,
} from '../src/predicates.mjs';

const reHash = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const SHA = (hex) => `sha256:${hex}`;
const FP = SHA('a'.repeat(64));
const ATTEMPTS = [{ txHash: SHA('b'.repeat(64)).replace('sha256:', '0x'), resourceId: 'search.v1', settled: true }];
const FORMS = deriveRedeemCount([], { fingerprint: FP, attempts: ATTEMPTS }).forms;

function entry(i, prevHash, dataHash, extra = {}) {
  const timestamp = new Date(Date.UTC(2026, 8, 30, 12, 21, i)).toISOString();
  return { index: i, prevHash, timestamp, dataHash, ...extra, hash: reHash(`${prevHash}|${timestamp}|${dataHash}`) };
}

/** A clean ledger: contiguous, hashes correct, history published, one bound entry. */
function goodLedger() {
  const e0 = entry(0, SHA('0'.repeat(64)), EMPTY_DATA_HASH, { keyId: 'k1', signature: 'x' });
  const e1 = entry(1, e0.hash, FORMS[0].dataHash, { keyId: 'k1', signature: 'x' });
  const e2 = entry(2, e1.hash, SHA('c'.repeat(64)), { keyId: 'k1', signature: 'x' });
  return {
    entries: [e0, e1, e2],
    pubkey: { keyId: 'k1', algorithm: 'ECDSA-P256-SHA256', history: [{ keyId: 'k0', publicKey: 'pem' }] },
    total: 3,
  };
}

const FIX = {
  async loadFile(p) {
    return JSON.parse(JSON.stringify(GOOD));
  },
};
const GOOD = goodLedger();

test('P1 hashIntegrity: passes on a correctly-constructed ledger', () => {
  const p = predicateHashIntegrity(GOOD.entries);
  assert.equal(p.status, 'pass');
  assert.equal(p.level, 'L0');
});

test('P1 hashIntegrity: fails when an entry hash is wrong', () => {
  const bad = GOOD.entries.map((e, i) => (i === 0 ? { ...e, hash: reHash('tampered') } : e));
  const p = predicateHashIntegrity(bad);
  assert.equal(p.status, 'fail');
});

test('P2 chainContinuity: detects a broken prevHash link', () => {
  const broken = GOOD.entries.map((e, i) => (i === 2 ? { ...e, prevHash: 'sha256:' + '9'.repeat(64) } : e));
  const p = predicateChainContinuity(broken);
  assert.equal(p.status, 'fail');
});

test('P3 keyHistoryAware: passes when history is published', () => {
  assert.equal(predicateKeyHistoryAware(GOOD.pubkey).status, 'pass');
});

test('P3 keyHistoryAware: pending without a pubkey document', () => {
  assert.equal(predicateKeyHistoryAware(null).status, 'pending');
});

test('P4 contentBinding: reports a gap when empty-object entries exist', () => {
  const p = predicateContentBinding(GOOD.entries);
  assert.equal(p.status, 'gap');
  assert.equal(p.evidence.empty, 1);
  assert.equal(p.evidence.total, 3);
});

test('P4 contentBinding: passes when no entry signs an empty object', () => {
  const clean = GOOD.entries.map((e) => ({ ...e, dataHash: SHA('d'.repeat(64)) }));
  assert.equal(predicateContentBinding(clean).status, 'pass');
});

test('P5/P6 settlement linkage: pending without a fingerprint', () => {
  const preds = runPredicates(GOOD, { fingerprint: null, attempts: [] });
  const link = preds.find((p) => p.id === 'evidence.settlementLinkage');
  const red = preds.find((p) => p.id === 'evidence.redeemCountDerivable');
  assert.equal(link.status, 'pending');
  assert.equal(red.status, 'pending');
});

test('P5/P6 settlement linkage: binds when a fingerprinted entry is present', () => {
  const preds = runPredicates(GOOD, { fingerprint: FP, attempts: ATTEMPTS });
  const link = preds.find((p) => p.id === 'evidence.settlementLinkage');
  const red = preds.find((p) => p.id === 'evidence.redeemCountDerivable');
  assert.equal(link.status, 'pass');
  assert.equal(red.status, 'pass');
  assert.equal(link.evidence.redeemCount, 1);
});

test('P7 settlement trivaluation: info when no status field exists', () => {
  const p = runPredicates(GOOD, {}).find((x) => x.id === 'evidence.settlementTrivalued');
  assert.equal(p.status, 'info');
});

test('P7 settlement trivaluation: pass when a settlement field is present', () => {
  const ents = [{ index: 0, prevHash: 'x', dataHash: 'y', settlementStatus: 'settled' }];
  const p = predicateSettlementTrivalued(ents);
  assert.equal(p.status, 'pass');
  assert.equal(p.evidence.distribution.settled, 1);
});

test('probe offline: runs all predicates and summarizes', async () => {
  const report = await probe({ fromFile: 'ledger.json', loadFile: FIX.loadFile });
  assert.equal(report.target.mode, 'offline');
  assert.equal(report.predicates.length, 7);
  assert.equal(report.summary.total, 7);
  // With our good ledger + fingerprint: linkage passes, so no failure.
  const withFp = await probe({ fromFile: 'ledger.json', fingerprint: FP, attempts: ATTEMPTS, loadFile: FIX.loadFile });
  assert.equal(withFp.summary.fail, 0);
  assert.ok(withFp.summary.levels.L2);
});

test('sign + verify round-trips; tampering breaks verification', () => {
  const report = {
    tool: 'gates-probe',
    version: '0.1.0',
    generated_at: new Date().toISOString(),
    target: { origin: 'x', protocol: 'x402', adapter: 'automaton', mode: 'offline', fingerprintSupplied: false },
    predicates: [{ id: 'p', status: 'pass', level: 'L0', message: 'ok' }],
    raw: { entryCount: 1 },
  };
  const kp = generateKeyPair();
  const signed = signReport(report, kp.privateKey);
  assert.equal(verifyReport(signed).valid, true);

  const tampered = JSON.parse(JSON.stringify(signed));
  tampered.report.predicates[0].status = 'fail';
  assert.equal(verifyReport(tampered).valid, false);

  assert.equal(verifyReport({ report, signature: 'x' }).valid, false);
});

test('probe requires a target or a file', async () => {
  await assert.rejects(() => probe({}), /target|fromFile/);
});
