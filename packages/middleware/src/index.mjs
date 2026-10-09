/**
 * @gates-spec/middleware — resource-side (merchant) reference implementation.
 *
 * What this adds to an existing 402 handler:
 *   - counts how many times the SAME payment proof gets completed  -> redeem_count
 *   - records delivery status and timestamp
 *   - issues a signed VSR on every completed call
 *   - exports OTel `agent.spend.*` span attributes
 *
 * What it deliberately does NOT do:
 *   - move funds, verify the rail signature, or decide whether to accept payment
 *   - score anyone
 *   - store the payment proof (only its hash)
 */

import {
  buildVSR,
  canonicalJSON,
  nowISO,
  requestFingerprint,
  sha256,
  signVSR,
  toSpanAttributes,
} from '@gates-spec/core';

/* ------------------------------------------------------------------ *
 * Redemption store
 * ------------------------------------------------------------------ */

/**
 * In-process store. Single-instance only.
 * For multi-instance deployments implement the same interface over Redis.
 */
export function memoryStore() {
  /** @type {Map<string, {count: number, resources: Set<string>, firstSeen: string}>} */
  const map = new Map();
  return {
    async incr(proofHash, resourceId) {
      let rec = map.get(proofHash);
      if (!rec) {
        rec = { count: 0, resources: new Set(), firstSeen: nowISO() };
        map.set(proofHash, rec);
      }
      rec.count += 1;
      if (resourceId) rec.resources.add(resourceId);
      return { count: rec.count, resources: [...rec.resources], firstSeen: rec.firstSeen };
    },
    async get(proofHash) {
      const rec = map.get(proofHash);
      if (!rec) return null;
      return { count: rec.count, resources: [...rec.resources], firstSeen: rec.firstSeen };
    },
  };
}

/**
 * Redis-backed store. `client` must expose `incr`, `sadd`, `smembers`, `get`, `setnx`.
 * @param {any} client
 */
export function redisStore(client, { prefix = 'gates:proof:', ttlDays = 90 } = {}) {
  const ttl = Math.round(ttlDays * 86400);
  return {
    async incr(proofHash, resourceId) {
      const key = prefix + proofHash;
      const count = await client.incr(key);
      if (count === 1) await client.expire(key, ttl);
      const resKey = `${key}:resources`;
      if (resourceId) {
        await client.sadd(resKey, resourceId);
        await client.expire(resKey, ttl);
      }
      const resources = await client.smembers(resKey);
      const firstSeen = (await client.get(`${key}:first`)) ?? nowISO();
      if (!(await client.get(`${key}:first`))) {
        await client.set(`${key}:first`, firstSeen, 'EX', ttl);
      }
      return { count: Number(count), resources, firstSeen };
    },
    async get(proofHash) {
      const key = prefix + proofHash;
      const raw = await client.get(key);
      if (raw === null || raw === undefined) return null;
      return {
        count: Number(raw),
        resources: await client.smembers(`${key}:resources`),
        firstSeen: (await client.get(`${key}:first`)) ?? nowISO(),
      };
    },
  };
}

/* ------------------------------------------------------------------ *
 * Middleware factory
 * ------------------------------------------------------------------ */

const PAYMENT_HEADERS = ['payment-signature', 'x-payment', 'x-payment-signature', 'payment-proof'];

/**
 * @param {{
 *   resourceId: string,
 *   protocol?: string,
 *   price?: {value: string, currency: string},
 *   publicKey: string,
 *   privateKey: string,
 *   agentId?: string,
 *   keyId?: string,
 *   store?: ReturnType<typeof memoryStore>,
 *   onSpan?: (attrs: Record<string, unknown>) => void,
 *   attachReceipt?: boolean,
 *   verifyPayment?: (proofHeaderValue: string, req: any) => Promise<{ok: boolean, tradeNo?: string, reason?: string}>,
 *   resourceFor?: (req: any) => string,
 * }} config
 */
export function createGates(config) {
  const store = config.store ?? memoryStore();
  const protocol = config.protocol ?? 'x402';
  const attachReceipt = config.attachReceipt ?? false;

  function readProof(req) {
    const headers = req?.headers ?? {};
    for (const h of PAYMENT_HEADERS) {
      const v = headers[h] ?? headers[h.toUpperCase()];
      if (v) return Array.isArray(v) ? v[0] : v;
    }
    return null;
  }

  function challenge(req, res) {
    const body = {
      error: 'payment_required',
      gates_spec: 'v0.1',
      resource: config.resourceId,
      accepts: [
        {
          protocol,
          price: config.price ?? { value: '0.010000', currency: 'USDC' },
          note: 'Include a payment proof. gates-spec only records its hash.',
        },
      ],
    };
    res.statusCode = 402;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(body));
  }

  /**
   * Wrap a paid handler. Handler signature: `(req, res) => Promise<{status?: number, body: unknown}>`
   * or a plain Node/Express handler that writes to `res` itself.
   */
  function guard(handler) {
    return async function gatesGuarded(req, res) {
      const proof = readProof(req);
      if (!proof) return challenge(req, res);

      const resourceId = config.resourceFor?.(req) ?? config.resourceId;
      const proofHash = sha256(proof);
      const proofSeenAt = nowISO();

      // --- redemption counting happens BEFORE we decide anything else ---
      const { count, resources, firstSeen } = await store.incr(proofHash, resourceId);

      if (config.verifyPayment) {
        const verdict = await config.verifyPayment(proof, req);
        if (!verdict.ok) {
          res.statusCode = 402;
          res.setHeader('content-type', 'application/json');
          res.setHeader('x-gates-proof-hash', proofHash);
          res.end(JSON.stringify({ error: 'payment_rejected', reason: verdict.reason }));
          return;
        }
      }

      const completeSeenAt = nowISO();
      const fingerprint = requestFingerprint({
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        params: req.query ?? {},
      });

      // capture the handler's output without changing its behaviour
      let captured = null;
      const originalEnd = res.end.bind(res);
      let wrote = false;
      const outHeaders = {};
      res.setHeader('x-gates-proof-hash', proofHash);
      res.setHeader('x-gates-redeem-count', String(count));

      const result = await handler(req, res);

      if (result && typeof result === 'object' && 'body' in result) {
        captured = result;
      }
      wrote = res.writableEnded === true;

      const deliveredAt = nowISO();
      const deliveryStatus = captured
        ? (captured.status ?? 200) < 400
          ? 'delivered'
          : 'failed'
        : wrote
          ? 'delivered'
          : 'delivered';

      // Consumption is observable only by the buyer runtime, not by the seller.
      // Per SPEC §5.3, a merchant-signed VSR MUST set result.consumed = 'unknown'.
      // The buyer attests consumption with its own signature via @gates-spec/agent-sdk
      // (role 'agent'); linkReceipts() binds the two sides into bilateral evidence.
      const consumed = 'unknown';
      const consumedBy = undefined;

      const completeness = 'unilateral_merchant';

      const vsr = buildVSR({
        protocol,
        resourceId,
        proofHash,
        redeemCount: count,
        redeemResources: resources,
        deliveryStatus,
        deliveredAt,
        consumed,
        consumedBy,
        consumedAt: consumed === 'yes' ? deliveredAt : undefined,
        requestFingerprint: fingerprint,
        proofSeenAt: firstSeen ?? proofSeenAt,
        completeSeenAt,
        amount: config.price,
        publicKey: config.publicKey,
        agentId: config.agentId,
        keyId: config.keyId,
        role: 'merchant',
        completeness,
      });

      const envelope = signVSR(vsr, config.privateKey);
      const encoded = Buffer.from(canonicalJSON(envelope), 'utf8').toString('base64url');

      res.setHeader('x-gates-receipt', encoded);
      res.setHeader('x-gates-receipt-url', `https://gates-spec.dev/v1/receipt/${proofHash.slice(7, 23)}`);
      for (const [k, v] of Object.entries(outHeaders)) res.setHeader(k, v);

      config.onSpan?.(toSpanAttributes(vsr));

      if (captured && !wrote) {
        res.statusCode = captured.status ?? 200;
        res.setHeader('content-type', 'application/json');
        const payload = attachReceipt
          ? { ...(typeof captured.body === 'object' ? captured.body : { data: captured.body }), _gates: envelope }
          : captured.body;
        res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
      }
      return envelope;
    };
  }

  return { guard, store, readProof };
}

export { buildVSR, signVSR, toSpanAttributes } from '@gates-spec/core';
