#!/usr/bin/env node
/**
 * w1-discover — enumerate x402 evidence-layer endpoints to probe.
 *
 * Primary source: the CDP discovery directory
 *   GET {BASE}/v2/x402/discovery/resources  (paginated; seller auto-listed on
 *   first settlement, no registration).
 * Fallback: a curated seed list of known public ledgers, so the scan still
 * produces coverage when discovery is unreachable or empty.
 *
 * Emits a newline-separated list of origins to stdout (and optionally --out).
 */

import { writeFile } from 'node:fs/promises';

const BASE = process.env.W1_DISCOVERY_BASE || 'https://api.automaton-sovereign.workers.dev';
// Seed = the one known automaton-sovereign-style public ledger. CDP discovery
// is the real source of the broader list; the seed only guarantees we never
// scan zero endpoints when discovery is unreachable or empty.
const SEED = ['https://api.automaton-sovereign.workers.dev'];

/**
 * @param {string} origin
 * @param {(u:string)=>Promise<any>} [fetchImpl]
 */
async function fetchDiscovery(origin, fetchImpl = globalThis.fetch) {
  const out = [];
  let from = 0;
  const LIMIT = 50;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let doc;
    try {
      const r = await fetchImpl(`${origin.replace(/\/$/, '')}/v2/x402/discovery/resources?from=${from}&limit=${LIMIT}`);
      if (!r.ok) break;
      doc = await r.json();
    } catch {
      break;
    }
    const items = doc?.entries ?? doc?.resources ?? doc?.items ?? (Array.isArray(doc) ? doc : []);
    if (!items.length) break;
    for (const it of items) {
      const cand =
        it.origin ?? it.host ?? it.url ?? it.endpoint ?? it.baseUrl ?? it.location ??
        (typeof it === 'string' ? it : null);
      if (cand) out.push(String(cand).replace(/\/$/, ''));
    }
    if (items.length < LIMIT) break;
    from += items.length;
    if (out.length > 100000) break;
  }
  return out;
}

function originOf(s) {
  try {
    return new URL(s).origin;
  } catch {
    return s.startsWith('http') ? s : `https://${s}`;
  }
}

async function main() {
  const seen = new Set();
  const push = (o) => {
    const origin = originOf(o);
    if (!seen.has(origin)) {
      seen.add(origin);
      process.stdout.write(origin + '\n');
    }
  };

  let discovered = [];
  try {
    discovered = await fetchDiscovery(BASE);
  } catch {
    /* unreachable — fall through to seed */
  }
  if (discovered.length) {
    process.stderr.write(`[discover] CDP discovery @ ${BASE}: ${discovered.length} resource(s)\n`);
    discovered.forEach(push);
  } else {
    process.stderr.write(`[discover] CDP discovery empty/unreachable @ ${BASE}; using seed list\n`);
  }
  // seed always appended (deduped) so known ledgers are never missed
  SEED.forEach(push);

  if (process.argv.includes('--out')) {
    const i = process.argv.indexOf('--out');
    const dest = process.argv[i + 1];
    await writeFile(dest, [...seen].join('\n') + '\n');
    process.stderr.write(`[discover] wrote ${seen.size} origin(s) to ${dest}\n`);
  }
}

main().catch((e) => {
  process.stderr.write(`[discover] error: ${e.message}\n`);
  process.exit(1);
});
