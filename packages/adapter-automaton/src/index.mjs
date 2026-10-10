/**
 * @gates-spec/adapter-automaton
 *
 * Binds an automaton-sovereign style hash-chained attestation ledger to gates-spec v0.1.
 *
 * Zero dependencies. Node >= 18.
 *
 * ---------------------------------------------------------------------------
 * What this adapter is for
 * ---------------------------------------------------------------------------
 * A ledger that signs `sha256("{}")` proves "we signed something". It does not
 * prove "we signed something *about this*". The entire delta is what `dataHash`
 * covers, and this adapter computes `dataHash` — nothing else.
 *
 *   > "It converts an attestation from 'we signed something' into 'we signed
 *   >  something **about this**'"  — contributor, x402-receipts#6
 *
 * ---------------------------------------------------------------------------
 * §3.1 ingress snapshot — the identity is derived ONCE, then only looked up
 * ---------------------------------------------------------------------------
 * This adapter implements the settlement/refusal identity invariant from
 * x402-receipts §3.1 (proposed in PR #7, authored by @ruiruii):
 *
 *   A payment's settlement/refusal identity is **derived once, at ingress, from
 *   the request as received (canonical form)**, and resolved identically by both
 *   the settle path and the refusal path, bound to `attempt_id`.
 *
 *   *Prohibition:* **no path re-reads `accepts` after ingress.**
 *
 * The structural way to honour that prohibition is to make it *impossible* to
 * violate: `attestSettlement` / `attestRefusal` accept a frozen **snapshot**,
 * never the raw request. The snapshot carries the already-derived `attempt_id`
 * and `fingerprint`; neither path is given the bytes from which to recompute
 * them. A refactor that reintroduces a second read will not compile here —
 * which is exactly what a refactor test is for (see ./test/adapter.test.mjs,
 * "§3.1 acceptance tests").
 *
 * ---------------------------------------------------------------------------
 * What it deliberately does NOT touch
 * ---------------------------------------------------------------------------
 *   - the hash chain      (`hash = sha256(prevHash|timestamp|dataHash)` is theirs)
 *   - the keyring         (`/v2/pubkey`, key rotation, `signedBy: current|historical`)
 *   - the signatures      (ECDSA-P256-SHA256 DER over the ASCII hex of `hash`)
 *   - the payment path    (`verifyPayment`; this adapter is called *by* it)
 *
 * Existing entries keep their `dataHash`. All 33/33 signatures and links stay
 * valid. This is additive by construction, not by promise.
 *
 * ---------------------------------------------------------------------------
 * The two halves, which are not symmetric
 * ---------------------------------------------------------------------------
 *   | half       | subject                | buys                     |
 *   |------------|------------------------|--------------------------|
 *   | settlement | txHash (+attempt_id)   | provenance — this payment |
 *   | refusal    | attempt fingerprint    | a count — `redeem_count`  |
 *
 *   > "txHash-bound entries can never be grouped into a count at all... each
 *   >  attempt carries its own tx."  — contributor, x402-receipts#6
 *
 * Both subject kinds carry `attempt_id` so a settle and its refusals land in
 * the same group. That grouping is the only reason the count is derivable
 * rather than asserted.
 */

import { canonicalJSON, normalizeSettlement, sha256 as sha256Prefixed } from '@gates-spec/core';

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */

/**
 * `sha256("{}")` — the dataHash carried by entries that bind nothing.
 *
 * Recorded from the live ledger: 21 of 33 published entries (indices 12..32)
 * carried exactly this value. `subjectDataHash(undefined)` reproduces it
 * byte-for-byte, which is what makes this adapter backward compatible.
 */
export const EMPTY_DATA_HASH =
  '44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a';

export const SUBJECT_VERSION = 1;

/** The only refusal reason this adapter knows how to bind. */
export const REFUSAL_TX_ALREADY_USED = 'tx_already_used';

/** `redeem_count` is reported per `(fingerprint, window)`. Default window. */
export const DEFAULT_WINDOW_MS = 60_000;

/* ------------------------------------------------------------------ *
 * 0. §3.1 reference composition — the settlement/refusal identity
 * ------------------------------------------------------------------ */

/**
 * Pull the **named, decoded** fields that define an offer out of a request.
 *
 * This is deliberately the decode of the wire object, not the wire object
 * itself. A request may arrive with headers or an array in any order; what
 * matters for identity is the *terms*, expressed as named fields.
 *
 * @param {{method?: string, url: string, params?: Record<string, unknown>, accepts?: Array<unknown>, payTo?: string, amount?: string|number, asset?: string, scheme?: string, resource?: string, timeout?: string|number}} request
 */
function pickOfferFields(request) {
  const r = request ?? {};
  return {
    method: String(r.method ?? 'GET').toUpperCase(),
    url: r.url,
    params: r.params ?? {},
    accepts: Array.isArray(r.accepts) ? r.accepts : [],
    payTo: r.payTo,
    amount: r.amount,
    asset: r.asset,
    scheme: r.scheme,
    resource: r.resource,
    timeout: r.timeout,
  };
}

/**
 * Canonicalize recursively, **sorting array elements by their canonical
 * content**. This is what makes a reorder-within-terms *not* change the
 * digest — the core of §3.1 acceptance test 2.
 *
 * @param {unknown} value
 */
function deepCanonicalize(value) {
  if (Array.isArray(value)) {
    const sorted = value
      .map(deepCanonicalize)
      .sort((a, b) => {
        const sa = canonicalJSON(a);
        const sb = canonicalJSON(b);
        return sa < sb ? -1 : sa > sb ? 1 : 0;
      });
    return sorted;
  }
  if (value && typeof value === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) continue;
      out[key] = deepCanonicalize(value[key]);
    }
    return out;
  }
  return value;
}

/**
 * §3.1 reference composition.
 *
 * The settlement/refusal identity, derived over **decoded, named fields** — and
 * over arrays sorted by content, so a wire reorder (e.g. swapping two `accepts`
 * entries) leaves the identity unchanged. Returns **bare 64-hex** (no prefix).
 *
 *   > "computed over decoded, named fields pulled out of the request object,
 *   >  never over the wire array — wire ordering is not ours to control, and a
 *   >  reorder that changes the digest silently splits or merges a count."
 *
 * @param {object} request
 * @returns {string} 64 lowercase hex chars
 */
export function referenceComposition(request) {
  return sha256Prefixed(canonicalJSON(deepCanonicalize(pickOfferFields(request)))).slice('sha256:'.length);
}

/**
 * §3.1 backward-compatible alias. `fingerprintFor` previously delegated to
 * `requestFingerprint`, which hashed only `{method, url, params}`. §3.1 widens
 * the composition to all offer-relevant named fields and sorts arrays, so the
 * two converge here. Existing callers that pass the same request to both a
 * settle and a refusal are unaffected (the value only needs to be stable
 * within a logical request, which it still is).
 *
 * @param {object} request
 * @returns {string} 64 lowercase hex chars
 */
export function fingerprintFor(request) {
  return referenceComposition(request);
}

/**
 * Derive the ingress snapshot — **once, at ingress**. Everything downstream
 * (settle and refusal) resolves this same `attempt_id`; nothing re-derives it.
 *
 * @param {object} request
 * @param {{now?: () => number, windowMs?: number}} [opts]
 * @returns {{attemptId: string, fingerprint: string, window: number}}
 */
export function deriveIngressSnapshot(request, opts = {}) {
  const now = opts.now ?? Date.now;
  const windowMs = opts.windowMs ?? DEFAULT_WINDOW_MS;
  const fingerprint = referenceComposition(request);
  return {
    attemptId: fingerprint,
    fingerprint,
    window: Math.floor(now() / windowMs),
  };
}

/* ------------------------------------------------------------------ *
 * 1. Subject construction
 * ------------------------------------------------------------------ */

/**
 * Subject for the settlement half — binds *this payment*.
 *
 * @param {{attemptId: string, fingerprint: string, txHash: string, resourceId?: string, amount?: {value: string, currency: string}}} input
 */
export function buildSettlementSubject(input) {
  if (!input?.fingerprint) throw new TypeError('buildSettlementSubject: fingerprint is required');
  if (!input?.attemptId) throw new TypeError('buildSettlementSubject: attemptId is required');
  if (!input?.txHash) throw new TypeError('buildSettlementSubject: txHash is required');
  /** @type {Record<string, unknown>} */
  const s = {
    kind: 'gates/settlement',
    v: SUBJECT_VERSION,
    attempt_id: input.attemptId,
    fingerprint: input.fingerprint,
    txHash: normalizeTxHash(input.txHash),
  };
  if (input.resourceId) s.resourceId = input.resourceId;
  if (input.amount) s.amount = input.amount;
  return s;
}

/**
 * Subject for the refusal half — binds *this logical request*.
 *
 * The `attemptId`, not the tx, is what makes the count derivable: attempt 1
 * settles, attempt 2 is refused, both carry the same `attemptId`, and
 * `redeem_count` is the number of entries under it.
 *
 * @param {{attemptId: string, fingerprint: string, txHash: string, reason?: string}} input
 */
export function buildRefusalSubject(input) {
  if (!input?.fingerprint) throw new TypeError('buildRefusalSubject: fingerprint is required');
  if (!input?.attemptId) throw new TypeError('buildRefusalSubject: attemptId is required');
  if (!input?.txHash) throw new TypeError('buildRefusalSubject: txHash is required');
  return {
    kind: 'gates/refusal',
    v: SUBJECT_VERSION,
    attempt_id: input.attemptId,
    fingerprint: input.fingerprint,
    txHash: normalizeTxHash(input.txHash),
    reason: input.reason ?? REFUSAL_TX_ALREADY_USED,
  };
}

/**
 * `dataHash` for a subject — the only value handed to the ledger's append.
 *
 * `sha256(canonicalJSON(subject))`, lowercase hex, **no `sha256:` prefix** —
 * matching the ledger's existing format.
 *
 * Passing no subject yields `sha256("{}")` = `EMPTY_DATA_HASH`, so an entry
 * written without a subject is byte-identical to the entries already published.
 *
 * @param {Record<string, unknown>} [subject]
 * @returns {string} 64 lowercase hex chars
 */
export function subjectDataHash(subject) {
  return sha256Prefixed(canonicalJSON(subject ?? {})).slice('sha256:'.length);
}

function normalizeTxHash(txHash) {
  return String(txHash).trim().toLowerCase();
}

/* ------------------------------------------------------------------ *
 * 2. Idempotency keys (G1 — two keys, two jobs)
 * ------------------------------------------------------------------ */

/**
 * `sha256(txHash ‖ nonce)` — bounds **one attempt**.
 * Kills replay of the same attempt.
 */
export function attemptKey({ txHash, nonce }) {
  if (!txHash) throw new TypeError('attemptKey: txHash is required');
  return subjectDataHash({ a: normalizeTxHash(txHash), n: String(nonce ?? '') });
}

/**
 * `sha256(fingerprint)` — the **grouping key** for one logical request.
 *
 * ⚠️  This is a group key, **not** an idempotency key. Using it as an "append
 * only if absent" claim makes `redeem_count` permanently 1 and destroys the
 * very property the field exists for. (See the correction block in `gate()`.)
 */
export function requestKey(fingerprint) {
  if (!fingerprint) throw new TypeError('requestKey: fingerprint is required');
  return subjectDataHash({ r: String(fingerprint) });
}

/* ------------------------------------------------------------------ *
 * 3. Guard store
 * ------------------------------------------------------------------ */

/**
 * In-process guard store. Single-instance only; for multi-instance deployments
 * implement the same interface over D1 / Durable Objects / Redis.
 *
 * ⚠️  **Concurrency caveat that matters for G1.** Eventually-consistent KV
 * (Cloudflare Workers KV, and most edge KV) is *not* safe for the idempotency
 * claim: two concurrent attempts can each read "absent" and both append, which
 * is exactly the write-amplification the contributor asked to bound. Use a
 * strongly-consistent store (D1 transaction, Durable Object, Redis `SET NX`)
 * for `claim()` in production.
 */
export function memoryGuardStore() {
  /** @type {Map<string, {expiresAt: number}>} */
  const claims = new Map();
  /** @type {Map<string, {start: number, count: number}>} */
  const windows = new Map();
  /** @type {Map<string, Array<{dataHash: string, kind: string, txHash: string, at: number}>>} */
  const groups = new Map();
  /** @type {Array<object>} */
  const events = [];

  const sweep = () => {
    const now = Date.now();
    for (const [k, v] of claims) if (v.expiresAt <= now) claims.delete(k);
  };

  return {
    /**
     * Append to a logical-request group **within a window**. Never rejects —
     * the group is how `redeem_count` is counted, so refusing to grow it would
     * pin the count at 1. Keyed `${fingerprint}|${window}` so the count is
     * per `(fingerprint, window)` as §3.1 implies.
     * @param {string} groupKey
     * @param {{dataHash: string, kind: string, txHash: string}} entry
     * @returns {Promise<{size: number}>}
     */
    async group(groupKey, entry) {
      const g = groups.get(groupKey) ?? [];
      g.push({ ...entry, at: Date.now() });
      groups.set(groupKey, g);
      return { size: g.length };
    },
    /**
     * @param {string} groupKey
     * @returns {Promise<Array<{dataHash: string, kind: string, txHash: string, at: number}>>}
     */
    async groups(groupKey) {
      return groups.get(groupKey) ?? [];
    },
    /** @returns {Map<string, Array<object>>} the full group index (for cross-window counts) */
    allGroups() {
      return groups;
    },
    /**
     * @param {string} key
     * @param {number} ttlMs
     * @returns {Promise<{fresh: boolean}>} fresh=false means "already claimed"
     */
    async claim(key, ttlMs) {
      sweep();
      const hit = claims.get(key);
      if (hit && hit.expiresAt > Date.now()) return { fresh: false };
      claims.set(key, { expiresAt: Date.now() + ttlMs });
      return { fresh: true };
    },
    /**
     * Fixed-window counter. The cap is a blast-radius lever, not a rate limiter.
     * @param {string} bucket
     * @param {number} windowMs
     * @param {number} limit
     */
    async bump(bucket, windowMs, limit) {
      const now = Date.now();
      const w = windows.get(bucket);
      if (!w || now - w.start >= windowMs) {
        windows.set(bucket, { start: now, count: 1 });
        return { count: 1, allowed: 1 <= limit };
      }
      w.count += 1;
      return { count: w.count, allowed: w.count <= limit };
    },
    /** Record a standalone event (e.g. "announcement changed mid-attempt"). */
    recordEvent(ev) {
      events.push(ev);
      return { index: events.length - 1 };
    },
    /** @returns {Array<object>} */
    listEvents() {
      return events.slice();
    },
  };
}

/* ------------------------------------------------------------------ *
 * 4. The adapter
 * ------------------------------------------------------------------ */

/**
 * @typedef {'appended'|'duplicate_attempt'|'rate_limited'|'not_settled'|'settlement_unverifiable'} AppendReason
 */

/**
 * @typedef {object} AppendResult
 * @property {boolean} appended
 * @property {AppendReason} reason       — why a write did or did not happen; every
 *   non-`appended` result is explainable, which is the point of G1–G3
 * @property {string} dataHash
 * @property {Record<string, unknown>} subject
 * @property {'settlement'|'refusal'} half
 * @property {number} [redeemCount] — present when appended; the running count
 *   for this logical request **within its window** after this write
 */

/**
 * Create the adapter.
 *
 * @param {{
 *   append: (dataHashHex: string, meta: Record<string, unknown>) => Promise<unknown>,
 *   store?: ReturnType<typeof memoryGuardStore>,
 *   settlementFor: (txHash: string) => Promise<{status: 'settled'|'in_flight'|'absent', blockNumber?: number, confirmations?: number}|null|undefined>,
 *   cap?: { perPayerPerWindow: number, windowMs: number },
 *   claimTtlMs?: number,
 *   now?: () => number,
 * }} config
 */
export function createAutomatonAdapter(config) {
  const {
    append,
    store = memoryGuardStore(),
    settlementFor,
    cap = { perPayerPerWindow: 5, windowMs: DEFAULT_WINDOW_MS },
    claimTtlMs = 24 * 60 * 60 * 1000,
  } = config;

  if (typeof append !== 'function') throw new TypeError('createAutomatonAdapter: append() is required');
  if (typeof settlementFor !== 'function') {
    throw new TypeError('createAutomatonAdapter: settlementFor() is required (G2 — on-chain check before the append)');
  }

  /**
   * The shared gate. Order is deliberate:
   *
   *   G1 (idempotency) → G3 (cap) → G2 (on-chain) → append → group
   *
   * Idempotency first because a duplicate must not consume quota or an RPC
   * call. The cap second because it is cheap and must stand in front of the
   * RPC — otherwise a stranger can spend your RPC budget at the rate they
   * choose. The on-chain check last because it is the expensive one, and
   * because nothing before it needs to be trusted.
   *
   * ---------------------------------------------------------------------
   * ⚠️  CORRECTION TO THE THREAT-MODEL DRAFT — found while implementing it
   * ---------------------------------------------------------------------
   * The draft specified two dedup keys, both "append only if absent":
   *
   *     | `(txHash | nonce)`        | bounds one attempt          |
   *     | request fingerprint       | bounds one logical request  |
   *
   * The second one cannot work as written. A settle and its refusal share a
   * fingerprint by construction — that sharing is the *only* reason the group
   * exists. If the fingerprint key also blocks the append, the refusal never
   * gets written, the group never exceeds one entry, and `redeem_count` is
   * pinned at 1 forever. The guardrail would destroy the property it was
   * introduced to create.
   *
   * The two keys are therefore doing different jobs, but not the two jobs the
   * draft says:
   *
   *     attempt key  → idempotency  (blocks; makes it once-per-attempt)
   *     request key  → grouping     (never blocks; makes the count derivable)
   *
   * Which leaves exactly one bound on ledger growth: **G3**. The draft already
   * called the per-payer per-window cap "the backstop, not a nicety". Having
   * implemented it, that is understated — G3 is not the backstop behind dedup,
   * it is the **only** write bound in the design. Everything else is
   * idempotency or grouping.
   *
   * @param {Record<string, unknown>} subject
   * @param {{payer?: string, txHash: string, nonce?: string, fingerprint: string, window: number, half: 'settlement'|'refusal'}} ctx
   * @returns {Promise<AppendResult>}
   */
  async function gate(subject, ctx) {
    const dataHash = subjectDataHash(subject);

    // --- G1: dedup by (txHash | nonce) — bounds one attempt --------------
    // The only blocking dedup key. Kills replay of the same attempt.
    const aKey = attemptKey({ txHash: ctx.txHash, nonce: ctx.nonce });
    const a = await store.claim(aKey, claimTtlMs);
    if (!a.fresh) return { appended: false, reason: 'duplicate_attempt', dataHash, subject, half: ctx.half };

    // --- G3: per-payer per-window cap — THE ONLY WRITE BOUND --------------
    // Not a nicety: a stranger can mint a fresh logical request per write, so
    // neither dedup key bounds the adversary. This does.
    if (ctx.payer) {
      const bucket = `payer:${String(ctx.payer).toLowerCase()}`;
      const b = await store.bump(bucket, cap.windowMs, cap.perPayerPerWindow);
      if (!b.allowed) {
        return { appended: false, reason: 'rate_limited', dataHash, subject, half: ctx.half };
      }
    }

    // --- G2: on-chain check BEFORE the append -----------------------------
    // Requires `settled`, not merely "not absent". This is safe — and stronger
    // than it first looks — because a `tx_already_used` refusal and an
    // in-flight settlement are mutually exclusive: a tx cannot simultaneously
    // be already-spent and still pending. So demanding `settled` here rejects
    // forged refusals (claiming a tx was spent when it never settled) without
    // ever rejecting a genuine one.
    const st = await settlementFor(ctx.txHash);
    if (!st || st.status === undefined || st.status === null) {
      return { appended: false, reason: 'settlement_unverifiable', dataHash, subject, half: ctx.half };
    }
    if (st.status !== 'settled') {
      return { appended: false, reason: 'not_settled', dataHash, subject, half: ctx.half };
    }

    await append(dataHash, { subject, ...ctx, settlement: st });

    // --- group by (fingerprint | window) — makes redeem_count derivable ----
    // Never blocks. Attempt 1 settles, attempt 2 is refused, both land here.
    const g = await store.group(`${ctx.fingerprint}|${ctx.window}`, {
      dataHash,
      kind: ctx.half,
      txHash: ctx.txHash,
    });

    return { appended: true, reason: 'appended', dataHash, subject, half: ctx.half, redeemCount: g.size };
  }

  /**
   * Assert a frozen §3.1 ingress snapshot (not the raw request) — structurally
   * enforces "no path re-reads `accepts` after ingress".
   * @param {object} snapshot
   * @param {{txHash: string, nonce?: string, payer?: string, resourceId?: string, amount?: object, reason?: string}} input
   * @returns {Promise<AppendResult>}
   */
  function requireSnapshot(snapshot, where) {
    if (!snapshot || typeof snapshot !== 'object' || !snapshot.fingerprint || !snapshot.attemptId) {
      throw new TypeError(`createAutomatonAdapter.${where}: first argument must be a §3.1 ingress snapshot from deriveIngressSnapshot() — pass the snapshot, not the raw request`);
    }
  }

  return {
    /**
     * Settlement half. `subject = txHash` (+attempt_id) — binds this payment.
     * @returns {Promise<AppendResult>}
     */
    attestSettlement(snapshot, input) {
      requireSnapshot(snapshot, 'attestSettlement');
      const subject = buildSettlementSubject({
        attemptId: snapshot.attemptId,
        fingerprint: snapshot.fingerprint,
        txHash: input.txHash,
        resourceId: input.resourceId,
        amount: input.amount,
      });
      return gate(subject, { ...input, fingerprint: snapshot.fingerprint, window: snapshot.window, half: 'settlement' });
    },

    /**
     * Refusal half. Resolves the **same** `attempt_id` as a settlement for the
     * same snapshot — this is acceptance test 1 of §3.1.
     * @returns {Promise<AppendResult>}
     */
    attestRefusal(snapshot, input) {
      requireSnapshot(snapshot, 'attestRefusal');
      const subject = buildRefusalSubject({
        attemptId: snapshot.attemptId,
        fingerprint: snapshot.fingerprint,
        txHash: input.txHash,
        reason: input.reason,
      });
      return gate(subject, { ...input, fingerprint: snapshot.fingerprint, window: snapshot.window, half: 'refusal' });
    },

    /**
     * Record a mid-attempt terms change as a standalone announcement event —
     * never folded into the identity as a count divergence (§3.1 consequence 3).
     *
     * @param {object} snapshot the snapshot AFTER the change (new identity)
     * @param {{field: string, from: unknown, to: unknown}} detail
     */
    announceTermsChange(snapshot, detail) {
      requireSnapshot(snapshot, 'announceTermsChange');
      return store.recordEvent({
        type: 'announcement_changed_mid_attempt',
        fingerprint: snapshot.fingerprint,
        window: snapshot.window,
        field: detail.field,
        from: detail.from,
        to: detail.to,
        at: Date.now(),
      });
    },

    /**
     * `redeem_count` for a logical request **per `(fingerprint, window)`**.
     *
     * @param {string} fingerprint
     * @param {{window?: number}} [opts]
     * @returns {Promise<{redeemCount: number, entries: Array<object>}>}
     */
    async redeemCount(fingerprint, opts = {}) {
      /** @type {Array<object>} */
      const entries = [];
      if (opts.window !== undefined) {
        entries.push(...(await store.groups(`${fingerprint}|${opts.window}`)));
      } else {
        for (const [k, v] of store.allGroups()) {
          if (k.startsWith(`${fingerprint}|`)) entries.push(...v);
        }
      }
      return { redeemCount: entries.length, entries };
    },

    /** Expose the guard config so an auditor can see the parameters in force. */
    guardrails: () => ({ ...cap, claimTtlMs, windowMs: cap.windowMs }),
  };
}

/* ------------------------------------------------------------------ *
 * 5. Wire mapping — `X-Payment-Settled`
 * ------------------------------------------------------------------ */

/**
 * The mapping the origin actually runs. Documented here because it is cited
 * from the thread, **not** from the origin's OpenAPI — which currently
 * documents `enum: ["true"]` and undersells `queued`, and omits
 * `/v1/verify-payment` from `paths` entirely. Both are known defects on the
 * origin's side, disclosed by the contributor.
 */
export const SETTLEMENT_WIRE_MAP = {
  true: 'settled',
  queued: 'in_flight',
  '(header absent, status 200)': 'in_flight',
  '(header absent, status 402)': 'absent',
};

/**
 * Map an origin response onto the gates-spec settlement enum.
 *
 * ⚠️  A wire absent header does **not** always mean `in_flight`. On this origin
 * it means two different things depending on the status:
 *
 *   - `402` — the unpaid challenge. That is `absent`: no payment at all.
 *   - `200` without the header — the seller could not determine state. Per
 *     SPEC §5.1 that is `in_flight`: "not yet observable" is not "not settled".
 *
 * Collapsing the two is precisely the false statement SPEC §5.1 exists to
 * prevent, so the status code is part of the mapping.
 *
 * @param {{status: number, headers?: Record<string, string|undefined>}} res
 * @returns {'settled'|'in_flight'|'absent'}
 */
export function settlementFromAutomaton(res) {
  const headers = res?.headers ?? {};
  const wire = headers['x-payment-settled'] ?? headers['X-Payment-Settled'];
  if (Number(res?.status) === 402) return 'absent';
  return normalizeSettlement(wire);
}

/* ------------------------------------------------------------------ *
 * 6. Read side — deriving `redeem_count` from a published ledger
 * ------------------------------------------------------------------ */

/**
 * Enumerate every `dataHash` a given logical request could have produced.
 *
 * Necessary because the ledger publishes only `dataHash` — the preimage is
 * never stored with the entry — so a count cannot be computed by inspecting
 * entries alone. It has to be enumerated from the attempts the caller knows
 * about and matched against the ledger.
 *
 * @param {{fingerprint: string, attempts: Array<{txHash: string, resourceId?: string, amount?: object, reason?: string, settled?: boolean}>}} input
 * @returns {Array<{dataHash: string, kind: string, txHash: string}>}
 */
export function candidateDataHashes({ fingerprint, attempts = [] }) {
  /** @type {Array<{dataHash: string, kind: string, txHash: string}>} */
  const out = [];
  for (const a of attempts) {
    const base = { attemptId: fingerprint, fingerprint, txHash: a.txHash };
    if (a.settled !== false) {
      out.push({
        dataHash: subjectDataHash(buildSettlementSubject({ ...base, resourceId: a.resourceId, amount: a.amount })),
        kind: 'settlement',
        txHash: a.txHash,
      });
    }
    out.push({
      dataHash: subjectDataHash(buildRefusalSubject({ ...base, reason: a.reason })),
      kind: 'refusal',
      txHash: a.txHash,
    });
  }
  return out;
}

/**
 * Derive `redeem_count` for a logical request **from the published ledger**,
 * independently of any local index. This is the assertion that turns RW-001's
 * red half green: it either finds bound entries or it does not, and it reports
 * which.
 *
 * @param {Array<{index: number, dataHash: string}>} entries
 * @param {{fingerprint: string, attempts: Array<object>}} input
 * @returns {{redeemCount: number, matched: Array<{index: number, kind: string, txHash: string}>,
 *            boundToFingerprint: boolean, forms: Array<object>}}
 */
export function deriveRedeemCount(entries, { fingerprint, attempts }) {
  const forms = candidateDataHashes({ fingerprint, attempts });
  const byHash = new Map(forms.map((f) => [f.dataHash, f]));
  /** @type {Array<{index: number, kind: string, txHash: string}>} */
  const matched = [];
  for (const e of entries ?? []) {
    const f = byHash.get(e.dataHash);
    if (f) matched.push({ index: e.index, kind: f.kind, txHash: f.txHash });
  }
  return {
    redeemCount: matched.length,
    matched,
    boundToFingerprint: matched.length > 0,
    forms,
  };
}

/**
 * Report how much of a ledger actually binds content.
 *
 * On the ledger recorded in RW-001 this returns 21/33 empty — the measurement
 * behind the claim "64% of attestations sign an empty object".
 *
 * @param {Array<{index: number, dataHash: string}>} entries
 */
export function contentBindingRatio(entries) {
  const list = entries ?? [];
  const empty = list.filter((e) => e.dataHash === EMPTY_DATA_HASH);
  return {
    total: list.length,
    empty: empty.length,
    bound: list.length - empty.length,
    emptyIndices: empty.map((e) => e.index),
    ratio: list.length ? (list.length - empty.length) / list.length : 0,
  };
}
