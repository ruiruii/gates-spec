#!/usr/bin/env node
/**
 * w1-surface — classify an origin's evidence-layer posture.
 *
 * gates-spec judges the *evidence layer*: who publishes durable, verifiable
 * attestation of settlement, and who merely settles without attesting.
 *
 * This module probes a small set of candidate "surfaces" per origin and
 * classifies the posture:
 *
 *   attestation-ledger  — a hash-chained ledger is readable (automaton /v2/ledger)
 *   signed-receipt      — a signed delivery-receipt key document is published
 *                         (bsvkey-style /v1/receipt-key)
 *   settlement-only     — reachable x402 facilitator, but no durable attestation
 *                         surface (settles, does not attest)
 *   no-evidence         — reachable, but exposes none of the above
 *   unreachable         — could not connect at all
 *
 * It is intentionally schema-agnostic: it does not assume any one ledger
 * shape. The full gates-spec predicates are run separately, only on
 * attestation-ledger origins.
 */

const SURFACES = [
  { id: 'ledger', url: (o) => `${o.replace(/\/$/, '')}/v2/ledger?from=0&limit=1`, kind: 'attestation-ledger' },
  { id: 'keyring', url: (o) => `${o.replace(/\/$/, '')}/v2/pubkey`, kind: 'attestation-ledger' },
  { id: 'receiptKey', url: (o) => `${o.replace(/\/$/, '')}/v1/receipt-key`, kind: 'signed-receipt' },
  { id: 'facilitatorSupported', url: (o) => `${o.replace(/\/$/, '')}/supported`, kind: 'settlement-only' },
  { id: 'facilitatorHealth', url: (o) => `${o.replace(/\/$/, '')}/health`, kind: 'settlement-only' },
];

async function timedGet(fetchImpl, url, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { method: 'GET', signal: ctrl.signal, redirect: 'manual' });
    let body = null;
    let isJson = false;
    try {
      body = await r.text();
      JSON.parse(body);
      isJson = true;
    } catch {
      /* non-JSON body (HTML landing page, plain text, etc.) */
    }
    const ok = r.status >= 200 && r.status < 400;
    // A surface "exists" only if it returns a 2xx *JSON* document — an HTML
    // landing/error page at a guessed path must not be counted as evidence.
    return { ok, isJson, present: ok && isJson, status: r.status };
  } catch (e) {
    return { ok: false, isJson: false, present: false, status: 0, error: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(t);
  }
}

/**
 * @param {string} origin
 * @param {(url:string)=>Promise<any>} [fetchImpl]
 * @param {{timeoutMs?:number, knownFacilitator?:boolean}} [opts]
 */
export async function probeSurfaces(origin, fetchImpl = globalThis.fetch, opts = {}) {
  const timeoutMs = opts.timeoutMs || 8000;
  const surfaces = {};
  for (const s of SURFACES) {
    const res = await timedGet(fetchImpl, s.url(origin), timeoutMs);
    surfaces[s.id] = { present: res.present, status: res.status, kind: s.kind };
  }

  const ledgerPresent = surfaces.ledger.present;
  const receiptPresent = surfaces.receiptKey.present;
  const facilitatorPresent = surfaces.facilitatorSupported.present || surfaces.facilitatorHealth.present;
  const reachable = Object.values(surfaces).some((s) => s.present);

  let posture;
  if (ledgerPresent) posture = 'attestation-ledger';
  else if (receiptPresent) posture = 'signed-receipt';
  else if (facilitatorPresent) posture = 'settlement-only';
  else if (!reachable) posture = 'unreachable';
  else if (opts.knownFacilitator) posture = 'settlement-only';
  else posture = 'no-evidence';

  return { origin, posture, reachable, surfaces };
}

export const POSTURE_LABEL = {
  'attestation-ledger': '哈希链账本（持久可验证存证）',
  'signed-receipt': '签名回执 + 密钥文档',
  'settlement-only': '仅结算（不存证）',
  'no-evidence': '可达但无证据面',
  unreachable: '不可达',
};
