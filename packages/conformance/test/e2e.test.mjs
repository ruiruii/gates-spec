/**
 * End-to-end: merchant middleware + agent SDK over a fake transport.
 *
 * The point of these tests is the claim gates-spec makes that no existing
 * receipt schema can: that one payment proof redeemed many times becomes
 * VISIBLE, and that consumption is attested by the side that can see it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from '@gates-spec/core';
import { createGates, memoryStore } from '@gates-spec/middleware';
import { createSpend, linkReceipts } from '@gates-spec/agent-sdk';
import { verifyVSR } from '@gates-spec/core';

const merchantKeys = generateKeyPair();
const agentKeys = generateKeyPair();

/** Minimal fake transport: runs the merchant handler and returns a real Response. */
function fakeTransport(gates, handler) {
  const guarded = gates.guard(handler);
  return async function fakeFetch(url, init = {}) {
    const headers = {};
    for (const [k, v] of new Headers(init.headers ?? {}).entries()) headers[k.toLowerCase()] = v;
    const req = { method: init.method ?? 'GET', url, headers, query: {} };
    const res = {
      statusCode: 200,
      headers: {},
      body: '',
      writableEnded: false,
      setHeader(k, v) {
        this.headers[k.toLowerCase()] = String(v);
      },
      end(b) {
        this.body = b ?? '';
        this.writableEnded = true;
      },
    };
    await guarded(req, res);
    return new Response(res.body, { status: res.statusCode, headers: res.headers });
  };
}

function makeMerchant() {
  const store = memoryStore();
  const gates = createGates({
    resourceId: 'search.v1',
    protocol: 'x402',
    price: { value: '0.010000', currency: 'USDC' },
    publicKey: merchantKeys.publicKey,
    privateKey: merchantKeys.privateKey,
    agentId: 'erc8004:8453:0xMERCHANT',
    keyId: '2026Q4-01',
    store,
  });
  const handler = async () => ({ status: 200, body: { results: ['a', 'b'] } });
  return { gates, store, transport: fakeTransport(gates, handler) };
}

function makeAgent(transport, { pay } = {}) {
  return createSpend({
    agentId: 'erc8004:8453:0xAGENT',
    publicKey: agentKeys.publicKey,
    privateKey: agentKeys.privateKey,
    fetchImpl: transport,
    pay: pay ?? (async () => 'PROOF-fixed-1234'),
  });
}

test('402 challenge then paid call produces a signed merchant receipt', async () => {
  const { transport } = makeMerchant();
  const spend = makeAgent(transport);

  const res = await spend.fetch('https://api.example/search?q=agent+payments');
  assert.equal(res.status, 200);

  const merchantReceipt = JSON.parse(
    Buffer.from(res.headers.get('x-gates-receipt'), 'base64url').toString('utf8'),
  );
  assert.equal(verifyVSR(merchantReceipt).valid, true);
  assert.equal(merchantReceipt.vsr.payment.redeem_count, 1);
  assert.equal(merchantReceipt.vsr.result.consumed, 'unknown'); // seller cannot see consumption
  assert.equal(merchantReceipt.vsr.signer.role, 'merchant');
});

test('THE CASE: same proof redeemed twice is recorded as redeem_count = 2', async () => {
  const { transport } = makeMerchant();
  const spend = makeAgent(transport);

  const first = await spend.fetch('https://api.example/search?q=one');
  const second = await spend.fetch('https://api.example/search?q=two');

  const r1 = JSON.parse(Buffer.from(first.headers.get('x-gates-receipt'), 'base64url').toString('utf8'));
  const r2 = JSON.parse(Buffer.from(second.headers.get('x-gates-receipt'), 'base64url').toString('utf8'));

  // identical proof hash, different request fingerprints
  assert.equal(r1.vsr.payment.proof_hash, r2.vsr.payment.proof_hash);
  assert.notEqual(r1.vsr.request_fingerprint, r2.vsr.request_fingerprint);

  assert.equal(r1.vsr.payment.redeem_count, 1);
  assert.equal(r2.vsr.payment.redeem_count, 2, 'the second completion of the same proof must be counted');
  assert.deepEqual(r2.vsr.payment.redeem_resources, ['search.v1']);

  // and it is visible to anyone holding the receipt, offline
  const check = verifyVSR(r2);
  assert.equal(check.valid, true);
  assert.ok(check.warnings.some((w) => w.includes('redeem_count = 2')));
});

test('agent attests consumption; linking both sides yields bilateral', async () => {
  const { transport } = makeMerchant();
  const spend = makeAgent(transport);

  const res = await spend.fetch('https://api.example/search?q=consume');
  const merchantEnvelope = JSON.parse(
    Buffer.from(res.headers.get('x-gates-receipt'), 'base64url').toString('utf8'),
  );
  const agentEnvelope = res.gates.consumedBy('task_4829');

  assert.equal(agentEnvelope.vsr.result.consumed, 'yes');
  assert.deepEqual(agentEnvelope.vsr.result.consumed_by, ['task_4829']);
  assert.equal(typeof agentEnvelope.vsr.result.freshness_s, 'number');
  assert.equal(agentEnvelope.vsr.signer.role, 'agent');

  const link = linkReceipts(merchantEnvelope, agentEnvelope);
  assert.deepEqual(link.problems, []);
  assert.equal(link.completeness, 'bilateral');
  assert.equal(agentEnvelope.vsr.completeness, 'bilateral');
});

test('unmarked spend inside a scope is reported as idle spend (consumed = no)', async () => {
  const { transport } = makeMerchant();
  const spend = makeAgent(transport);

  await spend.scope('task_9001', async (fetchPaid) => {
    await fetchPaid('https://api.example/search?q=ignored');
  });

  // scope() finalizes idle spend entries after the task fn returns
  const receipts = spend.receipts();
  const last = receipts[receipts.length - 1];
  assert.equal(last.vsr.result.consumed, 'no');
  assert.equal(last.vsr.signer.role, 'agent');
  const check = verifyVSR(last);
  assert.equal(check.valid, true);
  assert.ok(check.warnings.some((w) => w.includes('idle spend')));
});

test('no payment header -> 402 challenge, no receipt issued', async () => {
  const { transport } = makeMerchant();
  const res = await transport('https://api.example/search?q=nopay');
  assert.equal(res.status, 402);
  assert.equal(res.headers.get('x-gates-receipt'), null);
  const body = await res.json();
  assert.equal(body.gates_spec, 'v0.1');
});

test('receipt never embeds the payment proof, only its hash', async () => {
  const { transport } = makeMerchant();
  const spend = makeAgent(transport, { pay: async () => 'PROOF-super-secret-credential' });
  const res = await spend.fetch('https://api.example/search?q=redline');
  const raw = Buffer.from(res.headers.get('x-gates-receipt'), 'base64url').toString('utf8');
  assert.ok(!raw.includes('PROOF-super-secret-credential'));
  assert.ok(raw.includes('sha256:'));
});
