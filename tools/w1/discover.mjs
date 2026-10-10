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
    if (!r.ok) return { ok: false, count: 0, origins: [] };
    const doc = await r.json();
    // Discovery directories use different top-level keys: Circle → "items",
    // CDP → "resources", others → "entries" / bare array.
    const items =
      doc?.items ?? doc?.resources ?? doc?.entries ?? doc?.data ?? doc?.results ??
      (Array.isArray(doc) ? doc : []);
    const origins = new Set();
    for (const it of items) {
      const cand =
        it.resource ?? it.origin ?? it.host ?? it.url ?? it.endpoint ?? it.baseUrl ?? it.location ??
        (typeof it === 'string' ? it : null);
      if (!cand) continue;
      try {
        origins.add(new URL(cand).origin);
      } catch {
        /* skip unparseable */
      }
    }
    return { ok: true, count: items.length, origins: [...origins] };
  } catch {
    return { ok: false, count: 0, origins: [] };
  }
}

async function main() {
  const discovery = { sources: [], total_listed: 0, distinct_origins: 0, sampled_origins: [] };
  for (const src of DISCOVERY_SOURCES) {
    const res = await fetchDiscovery(src);
    discovery.sources.push({ url: src, ok: res.ok, count: res.count });
    discovery.total_listed += res.count;
    if (res.origins.length) {
      discovery.distinct_origins = res.origins.length;
      discovery.sampled_origins = res.origins.slice(0, 25);
    }
  }

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

  if (process.argv.includes('--out')) {
    const i = process.argv.indexOf('--out');
    await writeFile(process.argv[i + 1], lines.join('\n') + '\n');
  }
  if (process.argv.includes('--discovery-out')) {
    const i = process.argv.indexOf('--discovery-out');
    await writeFile(process.argv[i + 1], JSON.stringify(discovery, null, 2));
  }

  if (!process.argv.includes('--quiet')) {
    process.stderr.write(
      `[discover] evidence-authority seed: ${lines.length} origin(s)\n` +
        `[discover] discovery: ${discovery.total_listed} resource(s) listed across ${DISCOVERY_SOURCES.length} source(s)\n`,
    );
  }
  // always emit the seed list to stdout (pipeline default)
  process.stdout.write(lines.join('\n') + '\n');
}

main().catch((e) => {
  process.stderr.write(`[discover] error: ${e.message}\n`);
  process.exit(1);
});
