/**
 * @gates-spec/adapter-automaton tests.
 *
 * The first test is the one that matters most: if `subjectDataHash()` with no
 * subject does not reproduce `sha256("{}")`, this adapter breaks every entry
 * the origin has already published, and the whole "additive" claim is false.
 *
 * The block titled "§3.1 acceptance tests" is the implementation-side evidence
 * for x402-receipts PR #7 (the settlement/refusal identity invariant). These
 * three tests are word-for-word the ones the PR lists as "fail today if a
 * second read exists" — here they are runnable, and they pass.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EMPTY_DATA_HASH,
  attemptKey,
  buildRefusalSubject,
  buildSettlementSubject,
  candidateDataHashes,
  contentBindingRatio,
  createAutomatonAdapter,
  deriveIngressSnapshot,
  deriveRedeemCount,
  fingerprintFor,
  memoryGuardStore,
  referenceComposition,
  requestKey,
  settlementFromAutomaton,
  subjectDataHash,
} from '../src/index.mjs';

const TX_A = '0x3bf944626e3429c7acf1bbc135d82cd73d8e74fec2de4dd03e93a269993d62d8';
const TX_B = '0x1111111111111111111111111111111111111111111111111111111111111111';
const TX_C = '0x2222222222222222222222222222222222222222222222222222222222222222';

/** A stub append that records what it was handed, exactly like a ledger would. */
function recorder() {
  const calls = [];
  return { calls, append: async (dataHash, meta) => { calls.push({ dataHash, meta }); return { index: calls.length }; } };
}

function settledAdapter(extra = {}) {
  return createAutomatonAdapter({
    append: recorder().append,
    store: memoryGuardStore(),
    settlementFor: async () => ({ status: 'settled' }),
    ...extra,
  });
}

/* ------------------------------------------------------------------ *
 * 1. Backward compatibility — the load-bearing test
 * ------------------------------------------------------------------ */

test('subjectDataHash() with no subject reproduces sha256("{}")', () => {
  assert.equal(subjectDataHash(), EMPTY_DATA_HASH);
  assert.equal(subjectDataHash(undefined), EMPTY_DATA_HASH);
  assert.equal(subjectDataHash({}), EMPTY_DATA_HASH);
  assert.equal(EMPTY_DATA_HASH.length, 64);
  // The value recorded from the live ledger (indices 12..32) is exactly this.
  assert.equal(EMPTY_DATA_HASH, '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
});

test('dataHash is bare lowercase hex (64 chars), no sha256: prefix', () => {
  const snap = deriveIngressSnapshot({ method: 'GET', url: 'https://api.example/search', params: { q: 'ai' } });
  const h = subjectDataHash(buildSettlementSubject({ attemptId: snap.attemptId, fingerprint: snap.fingerprint, txHash: TX_A }));
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.ok(!h.startsWith('sha256:'));
});

test('canonical ordering: key insertion order does not change the hash', () => {
  const a = subjectDataHash({ kind: 'x', txHash: TX_A, v: 1, fingerprint: 'fp' });
  const b = subjectDataHash({ v: 1, fingerprint: 'fp', kind: 'x', txHash: TX_A });
  assert.equal(a, b);
});

/* ------------------------------------------------------------------ *
 * 2. §3.1 acceptance tests — the implementation-side evidence for PR #7
 * ------------------------------------------------------------------ */

test('§3.1 (1): one settle + N refusals for the same attempt ⇒ attempt_id AND digest byte-identical at both sites', async () => {
  const snap = deriveIngressSnapshot({ method: 'GET', url: 'https://api.example/search', params: { q: 'ai' } });
  const a = settledAdapter();
  const s = await a.attestSettlement(snap, { txHash: TX_A, nonce: '0xaa' });
  const r1 = await a.attestRefusal(snap, { txHash: TX_B, nonce: '0xbb' });
  const r2 = await a.attestRefusal(snap, { txHash: TX_C, nonce: '0xcc' });

  // The identity both paths resolved — derived once at ingress, never recomputed.
  assert.equal(s.subject.attempt_id, r1.subject.attempt_id);
  assert.equal(s.subject.attempt_id, r2.subject.attempt_id);
  assert.equal(s.subject.attempt_id, snap.fingerprint, 'the digest is the attempt_id; it is byte-identical at both sites');

  // Different subjects (different txHash), same identity.
  assert.notEqual(subjectDataHash(s.subject), subjectDataHash(r1.subject));
  assert.deepEqual(
    [s.subject.kind, r1.subject.kind, r2.subject.kind],
    ['gates/settlement', 'gates/refusal', 'gates/refusal'],
  );
});

test('§3.1 (2): permuting `accepts` without changing terms ⇒ digest unchanged (canonical, not wire)', () => {
  const a = { method: 'GET', url: 'https://api.example/offer', accepts: ['application/json', 'text/html'] };
  const b = { method: 'GET', url: 'https://api.example/offer', accepts: ['text/html', 'application/json'] };
  assert.equal(referenceComposition(a), referenceComposition(b), 'reorder-within-terms preserves identity');
  // And the alias agrees with the canonical composition.
  assert.equal(fingerprintFor(a), referenceComposition(a));
});

test('§3.1 (3): changing `amount` mid-attempt ⇒ new fingerprint + announcement event, not a count divergence', async () => {
  const before = { method: 'GET', url: 'https://api.example/pay', params: { id: 1 }, amount: '1.00' };
  const after = { method: 'GET', url: 'https://api.example/pay', params: { id: 1 }, amount: '2.00' };
  const snap1 = deriveIngressSnapshot(before);
  const snap2 = deriveIngressSnapshot(after);

  // A genuine terms change yields a new identity.
  assert.notEqual(snap1.fingerprint, snap2.fingerprint, 'new amount ⇒ new fingerprint');

  const store = memoryGuardStore();
  const a = createAutomatonAdapter({
    append: recorder().append,
    store,
    settlementFor: async () => ({ status: 'settled' }),
  });

  // The original attempt settles under identity 1.
  await a.attestSettlement(snap1, { txHash: TX_A, nonce: 'n1' });

  // The mid-attempt change is surfaced as an announcement event...
  a.announceTermsChange(snap2, { field: 'amount', from: '1.00', to: '2.00' });
  const evs = store.listEvents();
  assert.equal(evs.length, 1);
  assert.equal(evs[0].type, 'announcement_changed_mid_attempt');
  assert.equal(evs[0].fingerprint, snap2.fingerprint);

  // ...and is NEVER folded into identity 1 as a count divergence.
  const c1 = await a.redeemCount(snap1.fingerprint, { window: snap1.window });
  const c2 = await a.redeemCount(snap2.fingerprint, { window: snap2.window });
  assert.equal(c1.redeemCount, 1, 'identity 1 keeps its own count');
  assert.equal(c2.redeemCount, 0, 'the changed terms are a separate identity — not merged into 1');
});

test('§3.1 structural enforcement: a raw request (not a snapshot) is rejected', () => {
  const a = settledAdapter();
  const req = { method: 'GET', url: 'https://x', params: {} };
  assert.throws(() => a.attestSettlement(req, { txHash: TX_A, nonce: 'n' }), /snapshot/);
  assert.throws(() => a.attestRefusal(req, { txHash: TX_A, nonce: 'n' }), /snapshot/);
});

/* ------------------------------------------------------------------ *
 * 3. Subjects
 * ------------------------------------------------------------------ */

test('settlement and refusal subjects are distinguishable and both carry attempt_id + fingerprint', () => {
  const snap = deriveIngressSnapshot({ method: 'GET', url: 'https://api.example/search', params: { q: 'ai' } });
  const s = buildSettlementSubject({ attemptId: snap.attemptId, fingerprint: snap.fingerprint, txHash: TX_A, resourceId: 'search.v1' });
  const r = buildRefusalSubject({ attemptId: snap.attemptId, fingerprint: snap.fingerprint, txHash: TX_B });
  assert.equal(s.kind, 'gates/settlement');
  assert.equal(r.kind, 'gates/refusal');
  assert.equal(s.attempt_id, snap.attemptId);
  assert.equal(r.attempt_id, snap.attemptId);
  assert.equal(s.fingerprint, snap.fingerprint);
  assert.equal(r.fingerprint, snap.fingerprint);
  assert.notEqual(subjectDataHash(s), subjectDataHash(r));
});

test('txHash is normalised to lowercase so casing cannot split a group', () => {
  const snap = deriveIngressSnapshot({ method: 'GET', url: 'https://x', params: {} });
  const a = subjectDataHash(buildSettlementSubject({ attemptId: snap.attemptId, fingerprint: snap.fingerprint, txHash: TX_A }));
  const b = subjectDataHash(buildSettlementSubject({ attemptId: snap.attemptId, fingerprint: snap.fingerprint, txHash: TX_A.toUpperCase() }));
  assert.equal(a, b);
});

test('subject builders reject a missing attempt_id / fingerprint / txHash', () => {
  assert.throws(() => buildSettlementSubject({ txHash: TX_A }), /fingerprint/);
  assert.throws(() => buildSettlementSubject({ attemptId: 'x', fingerprint: 'fp' }), /txHash/);
  assert.throws(() => buildRefusalSubject({ fingerprint: 'fp', txHash: TX_A }), /attemptId/);
});

/* ------------------------------------------------------------------ *
 * 4. G1 — idempotency, two keys doing two different jobs
 * ------------------------------------------------------------------ */

test('G1a: the same (txHash, nonce) appends exactly once', async () => {
  const { calls, append } = recorder();
  const a = createAutomatonAdapter({ append, store: memoryGuardStore(), settlementFor: async () => ({ status: 'settled' }) });
  const snap = deriveIngressSnapshot({ method: 'GET', url: 'https://x', params: {} });
  const input = { txHash: TX_A, nonce: '0xaa', payer: '0xpayer' };
  const r1 = await a.attestSettlement(snap, input);
  const r2 = await a.attestSettlement(snap, input);
  assert.equal(r1.appended, true);
  assert.equal(r2.appended, false);
  assert.equal(r2.reason, 'duplicate_attempt');
  assert.equal(calls.length, 1);
});

test('the request key groups, it does not block: attempt 1 settles, attempt 2 is refused', async () => {
  const { calls, append } = recorder();
  const a = createAutomatonAdapter({ append, store: memoryGuardStore(), settlementFor: async () => ({ status: 'settled' }) });
  const snap = deriveIngressSnapshot({ method: 'GET', url: 'https://x', params: {} });
  const first = await a.attestSettlement(snap, { txHash: TX_A, nonce: '0xaa' });
  const second = await a.attestRefusal(snap, { txHash: TX_B, nonce: '0xbb' });
  assert.equal(first.appended, true);
  assert.equal(second.appended, true, 'if the request key blocked, redeem_count would be pinned at 1');
  assert.equal(second.reason, 'appended');
  assert.equal(calls.length, 2);
  assert.equal(second.redeemCount, 2);
});

test('redeem_count is the number of bound entries under the fingerprint, per window', async () => {
  const { append } = recorder();
  const a = createAutomatonAdapter({
    append,
    store: memoryGuardStore(),
    settlementFor: async () => ({ status: 'settled' }),
    cap: { perPayerPerWindow: 10, windowMs: 60_000 },
  });
  const snap = deriveIngressSnapshot({ method: 'GET', url: 'https://x', params: {} });
  await a.attestSettlement(snap, { txHash: TX_A, nonce: 'n1' });
  await a.attestRefusal(snap, { txHash: TX_B, nonce: 'n2' });
  await a.attestRefusal(snap, { txHash: TX_C, nonce: 'n3' });
  const { redeemCount, entries } = await a.redeemCount(snap.fingerprint, { window: snap.window });
  assert.equal(redeemCount, 3);
  assert.deepEqual(entries.map((e) => e.kind), ['settlement', 'refusal', 'refusal']);
  // A different logical request has its own group.
  const other = deriveIngressSnapshot({ method: 'GET', url: 'https://other' });
  assert.equal((await a.redeemCount(other.fingerprint, { window: other.window })).redeemCount, 0);
});

test('G1 keys are distinct and stable', () => {
  const k1 = attemptKey({ txHash: TX_A, nonce: '0xaa' });
  const k2 = attemptKey({ txHash: TX_A, nonce: '0xbb' });
  assert.notEqual(k1, k2);
  assert.equal(k1, attemptKey({ txHash: TX_A, nonce: '0xaa' }));
  const snap = deriveIngressSnapshot({ method: 'GET', url: 'https://x', params: {} });
  assert.equal(requestKey(snap.fingerprint), requestKey(snap.fingerprint));
  const other = deriveIngressSnapshot({ method: 'GET', url: 'https://other' });
  assert.notEqual(requestKey(snap.fingerprint), requestKey(other.fingerprint));
});

/* ------------------------------------------------------------------ *
 * 5. G3 — per-payer per-window cap is the backstop, not a nicety
 * ------------------------------------------------------------------ */

test('G3: a stranger minting fresh logical requests is still capped per payer per window', async () => {
  const { calls, append } = recorder();
  const a = createAutomatonAdapter({
    append,
    store: memoryGuardStore(),
    settlementFor: async () => ({ status: 'settled' }),
    cap: { perPayerPerWindow: 3, windowMs: 60_000 },
  });
  const reasons = [];
  for (let i = 0; i < 5; i++) {
    // Every attempt is a brand-new fingerprint — dedup cannot see this attacker.
    const snap = deriveIngressSnapshot({ method: 'GET', url: 'https://x/' + i });
    const r = await a.attestRefusal(snap, { txHash: '0x' + String(i + 1).padStart(64, '0'), nonce: '0x' + String(i), payer: '0xattacker' });
    reasons.push(r.reason);
  }
  assert.deepEqual(reasons, ['appended', 'appended', 'appended', 'rate_limited', 'rate_limited']);
  assert.equal(calls.length, 3, 'the ledger grows by 3, not by 5 — the cap is the bound');
});

test('G3 is per-payer: one payer being capped does not block another', async () => {
  const { append } = recorder();
  const a = createAutomatonAdapter({
    append,
    store: memoryGuardStore(),
    settlementFor: async () => ({ status: 'settled' }),
    cap: { perPayerPerWindow: 1, windowMs: 60_000 },
  });
  const snap = deriveIngressSnapshot({ method: 'GET', url: 'https://x', params: {} });
  const one = await a.attestRefusal(snap, { txHash: TX_A, nonce: 'a', payer: '0xalice' });
  const two = await a.attestRefusal(snap, { txHash: TX_B, nonce: 'b', payer: '0xalice' });
  assert.equal(one.reason, 'appended');
  assert.equal(two.reason, 'rate_limited', 'same payer, cap is 1');
  // A different payer has an independent bucket.
  const three = await a.attestRefusal(snap, { txHash: TX_B, nonce: 'c', payer: '0xbob' });
  assert.equal(three.reason, 'appended');
});

/* ------------------------------------------------------------------ *
 * 6. G2 — on-chain check before the append
 * ------------------------------------------------------------------ */

test('G2: a refusal for a tx that never settled is dropped, not recorded', async () => {
  const { calls, append } = recorder();
  const a = createAutomatonAdapter({ append, store: memoryGuardStore(), settlementFor: async () => ({ status: 'absent' }) });
  const snap = deriveIngressSnapshot({ method: 'GET', url: 'https://x', params: {} });
  const r = await a.attestRefusal(snap, { txHash: TX_B, nonce: '0xbb' });
  assert.equal(r.appended, false);
  assert.equal(r.reason, 'not_settled');
  assert.equal(calls.length, 0);
});

test('G2: in_flight is not settled — a tx cannot be both already-spent and pending', async () => {
  const { calls, append } = recorder();
  const a = createAutomatonAdapter({ append, store: memoryGuardStore(), settlementFor: async () => ({ status: 'in_flight' }) });
  const snap = deriveIngressSnapshot({ method: 'GET', url: 'https://x', params: {} });
  const r = await a.attestSettlement(snap, { txHash: TX_A, nonce: '0xaa' });
  assert.equal(r.appended, false);
  assert.equal(r.reason, 'not_settled');
  assert.equal(calls.length, 0);
});

test('G2: an unverifiable settlement (RPC failure) fails closed', async () => {
  const { calls, append } = recorder();
  const a = createAutomatonAdapter({ append, store: memoryGuardStore(), settlementFor: async () => null });
  const snap = deriveIngressSnapshot({ method: 'GET', url: 'https://x', params: {} });
  const r = await a.attestSettlement(snap, { txHash: TX_A, nonce: '0xaa' });
  assert.equal(r.appended, false);
  assert.equal(r.reason, 'settlement_unverifiable');
  assert.equal(calls.length, 0);
});

test('G2 runs before the append: a dropped write leaves no entry', async () => {
  const { calls, append } = recorder();
  const a = createAutomatonAdapter({ append, store: memoryGuardStore(), settlementFor: async () => ({ status: 'absent' }) });
  const snap = deriveIngressSnapshot({ method: 'GET', url: 'https://x', params: {} });
  const r = await a.attestRefusal(snap, { txHash: TX_B, nonce: 'n1', payer: '0xp' });
  assert.equal(r.appended, false);
  assert.equal(calls.length, 0);
  assert.equal((await a.redeemCount(snap.fingerprint, { window: snap.window })).redeemCount, 0, 'a dropped attempt must not inflate the count');
});

/* ------------------------------------------------------------------ *
 * 7. Wire mapping
 * ------------------------------------------------------------------ */

test('X-Payment-Settled maps onto the three-value enum', () => {
  assert.equal(settlementFromAutomaton({ status: 200, headers: { 'x-payment-settled': 'true' } }), 'settled');
  assert.equal(settlementFromAutomaton({ status: 200, headers: { 'x-payment-settled': 'queued' } }), 'in_flight');
});

test('an absent header means absent only on a 402 — on a 200 it is in_flight', () => {
  assert.equal(settlementFromAutomaton({ status: 402, headers: {} }), 'absent');
  assert.equal(settlementFromAutomaton({ status: 200, headers: {} }), 'in_flight');
});

test('the fourth wire case: an already-settled proof re-presented is a 402 refusal', () => {
  assert.equal(
    settlementFromAutomaton({ status: 402, headers: {}, body: { reason: 'tx_already_used' } }),
    'absent',
  );
});

/* ------------------------------------------------------------------ *
 * 8. Read side
 * ------------------------------------------------------------------ */

test('redeem_count is derived from a published ledger, not asserted', () => {
  const snap = deriveIngressSnapshot({ method: 'GET', url: 'https://api.example/search', params: { q: 'ai' } });
  const attempts = [{ txHash: TX_A, resourceId: 'search.v1', settled: true }, { txHash: TX_B }];
  const forms = candidateDataHashes({ fingerprint: snap.fingerprint, attempts });
  // Build a ledger containing exactly those three bound entries.
  const entries = forms.map((f, i) => ({ index: i, dataHash: f.dataHash }));
  const out = deriveRedeemCount(entries, { fingerprint: snap.fingerprint, attempts });
  assert.equal(out.redeemCount, forms.length);
  assert.equal(out.boundToFingerprint, true);
});

test('RW-001 red half: a ledger of empty dataHashes binds nothing', () => {
  const snap = deriveIngressSnapshot({ method: 'GET', url: 'https://x', params: {} });
  const entries = Array.from({ length: 33 }, (_, i) => ({ index: i, dataHash: EMPTY_DATA_HASH }));
  const out = deriveRedeemCount(entries, { fingerprint: snap.fingerprint, attempts: [{ txHash: TX_A }] });
  assert.equal(out.redeemCount, 0);
  assert.equal(out.boundToFingerprint, false, 'this is the gap RW-001 exists to record');
});

test('contentBindingRatio reproduces the 21/33 measurement', () => {
  const entries = Array.from({ length: 33 }, (_, i) => ({
    index: i,
    dataHash: i >= 12 ? EMPTY_DATA_HASH : 'a'.repeat(64),
  }));
  const r = contentBindingRatio(entries);
  assert.equal(r.total, 33);
  assert.equal(r.empty, 21);
  assert.equal(r.bound, 12);
  assert.deepEqual(r.emptyIndices.slice(0, 3), [12, 13, 14]);
  assert.ok(Math.abs(r.ratio - 12 / 33) < 1e-9);
});

/* ------------------------------------------------------------------ *
 * 9. Integrity: nothing about the chain, keys or signatures is touched
 * ------------------------------------------------------------------ */

test('the adapter hands the ledger a dataHash and nothing else that it signs', async () => {
  const { calls, append } = recorder();
  const a = createAutomatonAdapter({
    append,
    store: memoryGuardStore(),
    settlementFor: async () => ({ status: 'settled', blockNumber: 51984731 }),
  });
  const snap = deriveIngressSnapshot({ method: 'GET', url: 'https://x', params: {} });
  await a.attestSettlement(snap, { txHash: TX_A, nonce: '0xaa' });
  assert.equal(calls.length, 1);
  assert.equal(typeof calls[0].dataHash, 'string');
  assert.match(calls[0].dataHash, /^[0-9a-f]{64}$/);
  // The meta is context for the caller, not part of the signed preimage.
  assert.equal(calls[0].meta.settlement.blockNumber, 51984731);
});

test('config errors fail loudly rather than silently skipping a guardrail', () => {
  assert.throws(() => createAutomatonAdapter({ append: async () => {} }), /settlementFor/);
  assert.throws(() => createAutomatonAdapter({ settlementFor: async () => ({}) }), /append/);
});

/* ------------------------------------------------------------------ *
 * 10. RW-001 closing: the same assertion flips without being rewritten
 * ------------------------------------------------------------------ */

test('RW-001 closes: binding a subject flips the red half green, with no change to the assertion', () => {
  const snap = deriveIngressSnapshot({ method: 'GET', url: 'https://api.example/search', params: { q: 'ai' } });
  // A ledger shaped exactly like the one recorded in RW-001: 33 entries,
  // indices 12..32 carrying sha256("{}"), indices 0..11 carrying a dataHash in
  // the origin's own (pre-adapter) format.
  const originFormat = (i) => ('f'.repeat(63) + (i % 10));
  const today = Array.from({ length: 33 }, (_, i) => ({
    index: i,
    dataHash: i >= 12 ? EMPTY_DATA_HASH : originFormat(i),
  }));

  const attempts = [{ txHash: TX_A, resourceId: 'search.v1', settled: true }];

  // --- today: the assertion is the one RW-001 runs, and it reads unbound ---
  const before = deriveRedeemCount(today, { fingerprint: snap.fingerprint, attempts });
  assert.equal(before.boundToFingerprint, false, 'red half: nothing binds the logical request');
  assert.equal(contentBindingRatio(today).empty, 21, 'red half: 21/33 sign an empty object');

  // --- after the origin ships the fingerprint half: one entry now carries the
  //     dataHash the adapter would have produced for that same attempt -------
  const after = today.map((e) =>
    e.index === 20
      ? { ...e, dataHash: subjectDataHash(buildSettlementSubject({ attemptId: snap.attemptId, fingerprint: snap.fingerprint, txHash: TX_A, resourceId: 'search.v1' })) }
      : e,
  );
  const closed = deriveRedeemCount(after, { fingerprint: snap.fingerprint, attempts });

  // The identical assertion, run against the changed ledger. No rewrite.
  assert.equal(closed.boundToFingerprint, true, 'green half: the same assertion now passes');
  assert.equal(closed.redeemCount, 1);
  assert.deepEqual(closed.matched, [{ index: 20, kind: 'settlement', txHash: TX_A }]);

  // And a refused second attempt on the same fingerprint counts alongside it.
  const withRefusal = after.map((e) =>
    e.index === 21
      ? { ...e, dataHash: subjectDataHash(buildRefusalSubject({ attemptId: snap.attemptId, fingerprint: snap.fingerprint, txHash: TX_B })) }
      : e,
  );
  const counted = deriveRedeemCount(withRefusal, {
    fingerprint: snap.fingerprint,
    attempts: [{ txHash: TX_A, resourceId: 'search.v1', settled: true }, { txHash: TX_B }],
  });
  assert.equal(counted.redeemCount, 2, 'attempt 1 settled + attempt 2 refused = 2');
  assert.deepEqual(counted.matched.map((m) => m.kind), ['settlement', 'refusal']);
});
