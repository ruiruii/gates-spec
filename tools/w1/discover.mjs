#!/usr/bin/env node
/**
 * w1-discover — enumerate x402 evidence-authority endpoints to probe, and
 * report the live ecosystem size from the public x402 discovery directories.
 *
 * Two outputs:
 *   1. endpoints.txt  — origins of settlement authorities (facilitators +
 *      ledger / receipt services) that the evidence-layer census scans.
 *   2. discovery.json — live ecosystem size from Circle / CDP discovery
 *      (how many x402 services are published), used as the "population"
 *      backdrop for the evidence-coverage finding.
 *
 * The evidence layer is about *attestation*, not settlement. Settlement
 * authorities (facilitators) are the natural publishers of durable evidence;
 * nearly all of them today settle without attesting. That gap is what
 * gates-spec measures.
 */

import { writeFile } from 'node:fs/promises';

// Public x402 discovery directories (list sellers / resource servers).
const DISCOVERY_SOURCES = [
  'https://api.circle.com/v2/x402/discovery/resources',
  'https://api.cdp.coinbase.com/platform/v2/x402/discovery/resources',
];

// Settlement authorities + evidence publishers to census for evidence posture.
// automaton-sovereign = reference hash-chained ledger; bsvkey = signed-receipt
// service; the rest are public x402 facilitators (settle, typically no ledger).
const EVIDENCE_SEED = [
  'https://api.automaton-sovereign.workers.dev', // reference hash-chained ledger
  'https://inference.bsvkey.com', // signed delivery receipts + receipt-key
  'https://x402.org/facilitator', // Coinbase official
  'https://api.cdp.coinbase.com', // CDP
  'https://facilitator.payai.network',
  'https://facilitator.corbits.dev',
  'https://facilitator.x402.rs',
  'https://x402.dexter.cash',
  'https://facilitator.heurist.xyz',
  'https://gateway.kobaru.io',
  'https://facilitator.mogami.tech',
  'https://api.live.nevermined.app',
  'https://pay.openfacilitator.io',
  'https://x402.solpay.cash',
  'https://x402.primer.systems',
  'https://facilitator.xechoai.xyz',
  'https://api.x402.celo.org',
];

/**
 * @param {string} url
 * @param {(u:string)=>Promise<any>} [fetchImpl]
 */
async function fetchDiscovery(url, fetchImpl = globalThis.fetch) {
  try {
    const r = await fetchImpl(url, { headers: { accept: 'application/json' } });
    if (!r.ok) return { ok: false, count: 0, items: [] };
    const doc = await r.json();
    // Discovery directories use different top-level keys: Circle → "items",
    // CDP → "resources", others → "entries" / bare array.
    const items =
      doc?.items ?? doc?.resources ?? doc?.entries ?? doc?.data ?? doc?.results ??
      (Array.isArray(doc) ? doc : []);
    return { ok: true, count: items.length, items };
  } catch {
    return { ok: false, count: 0, items: [] };
  }
}

// Extract seller (resource-server) origins from discovery items, plus the
// facilitator each seller delegates settlement to (when the directory exposes
// it). Sellers are the population we contrast against evidence coverage.
function extractSellers(items) {
  const byOrigin = new Map(); // origin -> { origin, resources:[], facilitators:Set }
  let totalResources = 0;
  for (const it of items) {
    const cand =
      it.resource ?? it.origin ?? it.host ?? it.url ?? it.endpoint ?? it.baseUrl ?? it.location ??
      (typeof it === 'string' ? it : null);
    if (!cand) continue;
    let origin;
    try {
      origin = new URL(cand).origin;
    } catch {
      continue;
    }
    totalResources += 1;
    if (!byOrigin.has(origin)) byOrigin.set(origin, { origin, resources: [], facilitators: new Set() });
    const e = byOrigin.get(origin);
    e.resources.push(cand);
    for (const acc of it.accepts ?? []) {
      const f = acc?.facilitator;
      if (typeof f === 'string' && f) {
        try {
          e.facilitators.add(new URL(f).origin);
        } catch {
          e.facilitators.add(f);
        }
      }
    }
  }
  const sellers = [...byOrigin.values()].map((e) => ({
    origin: e.origin,
    resourceCount: e.resources.length,
    sampleResource: e.resources[0],
    facilitators: [...e.facilitators],
  }));
  sellers.sort((a, b) => b.resourceCount - a.resourceCount || a.origin.localeCompare(b.origin));
  return { sellers, totalResources };
}

async function main() {
  const discovery = { sources: [], total_listed: 0, distinct_origins: 0, sellers: [], sampled_origins: [] };
  let allItems = [];
  for (const src of DISCOVERY_SOURCES) {
    const res = await fetchDiscovery(src);
    discovery.sources.push({ url: src, ok: res.ok, count: res.count });
    discovery.total_listed += res.count;
    if (res.ok) allItems = allItems.concat(res.items);
  }

  const { sellers, totalResources } = extractSellers(allItems);
  discovery.sellers = sellers;
  discovery.distinct_origins = sellers.length;

  // dedupe seed
  const seen = new Set();
  const lines = [];
  for (const o of EVIDENCE_SEED) {
    const origin = o.replace(/\/$/, '');
    if (!seen.has(origin)) {
      seen.add(origin);
      lines.push(origin);
    }
  }

  // seller origins list (deduped against the authority seed)
  const sellerLines = sellers.map((s) => s.origin).filter((o) => !seen.has(o));

  if (process.argv.includes('--out')) {
    const i = process.argv.indexOf('--out');
    await writeFile(process.argv[i + 1], lines.join('\n') + '\n');
  }
  if (process.argv.includes('--sellers-out')) {
    const i = process.argv.indexOf('--sellers-out');
    await writeFile(process.argv[i + 1], sellerLines.join('\n') + '\n');
  }
  if (process.argv.includes('--discovery-out')) {
    const i = process.argv.indexOf('--discovery-out');
    await writeFile(process.argv[i + 1], JSON.stringify(discovery, null, 2));
  }

  if (!process.argv.includes('--quiet')) {
    process.stderr.write(
      `[discover] evidence-authority seed: ${lines.length} origin(s)\n` +
        `[discover] discovery: ${discovery.total_listed} resource(s), ${sellers.length} distinct seller origin(s)\n` +
        `[discover] seller endpoints to census (excl. authorities): ${sellerLines.length}\n`,
    );
  }
  // always emit the authority seed list to stdout (pipeline default)
  process.stdout.write(lines.join('\n') + '\n');
}

main().catch((e) => {
  process.stderr.write(`[discover] error: ${e.message}\n`);
  process.exit(1);
});
