#!/usr/bin/env node
/**
 * w1-scan — run the evidence-layer census against two endpoint populations:
 *
 *   1. authorities — settlement authorities (facilitators + ledger / receipt
 *      services) from endpoints.txt. For attestation-ledger origins we also run
 *      the full gates-spec predicate battery (depth measurement).
 *   2. sellers     — resource servers listed in the public x402 discovery
 *      directories (sellers.txt). We only ask the evidence question
 *      ("do you run your own ledger / receipt key?") and never the
 *      facilitator-specific probes.
 *
 * Input : endpoints.txt (authorities), sellers.txt (sellers)
 * Output: JSON bundle (default ./w1-raw.json) consumable by report.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { probe } from '@gates-spec/probe';
import { probeSurfaces } from './surface.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const LIST = process.argv.includes('--list')
  ? process.argv[process.argv.indexOf('--list') + 1]
  : HERE + 'endpoints.txt';
const SELLERS = process.argv.includes('--sellers')
  ? process.argv[process.argv.indexOf('--sellers') + 1]
  : HERE + 'sellers.txt';
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : HERE + 'w1-raw.json';
const TIMEOUT_MS = Number(process.env.W1_PROBE_TIMEOUT_MS || 20000);

async function probeAuthority(origin) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const fetchImpl = (u) => fetch(u, { signal: ctrl.signal });
  try {
    const surf = await probeSurfaces(origin, fetchImpl, { timeoutMs: Math.min(8000, TIMEOUT_MS), knownFacilitator: true });
    let predicates = null;
    let summary = null;
    let entryCount = null;
    if (surf.posture === 'attestation-ledger') {
      try {
        const report = await probe({ target: origin, fetchImpl });
        predicates = report.predicates;
        summary = report.summary;
        entryCount = report.raw.entryCount;
      } catch (e) {
        surf.note = `ledger probe failed: ${e.message}`;
      }
    }
    return { origin, ...surf, predicates, summary, entryCount };
  } catch (e) {
    return { origin, posture: 'unreachable', reachable: false, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

async function probeSeller(origin, timeoutMs = 6000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const fetchImpl = (u) => fetch(u, { signal: ctrl.signal });
  try {
    // Sellers run no facilitator endpoints; only ask the evidence question.
    const surf = await probeSurfaces(origin, fetchImpl, { timeoutMs, evidenceOnly: true });
    return { origin, ...surf };
  } catch (e) {
    return { origin, posture: 'unreachable', reachable: false, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

// Minimal concurrency pool so 50+ seller origins don't take 10 minutes.
async function pool(items, worker, size = 10) {
  const out = new Array(items.length);
  let i = 0;
  async function next() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await worker(items[idx], idx);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, next));
  return out;
}

function readLines(path) {
  return readFile(path, 'utf8')
    .then((t) =>
      t
        .split('\n')
        .map((s) => s.trim())
        .filter((s) => s && !s.startsWith('#')),
    )
    .catch(() => []);
}

async function main() {
  const authorityOrigins = await readLines(LIST);
  const sellerOrigins = await readLines(SELLERS);

  process.stderr.write(`[scan] authorities: ${authorityOrigins.length}, sellers: ${sellerOrigins.length}\n`);

  const authorityResults = [];
  for (const o of authorityOrigins) {
    const r = await probeAuthority(o);
    process.stderr.write(`[scan] authority ${o} → ${r.posture || 'unreachable'}\n`);
    authorityResults.push(r);
  }

  const sellerResults = await pool(sellerOrigins, async (o) => {
    const r = await probeSeller(o);
    process.stderr.write(`[scan] seller ${o} → ${r.posture || 'unreachable'}\n`);
    return r;
  });
  const sellerDone = sellerResults.filter(Boolean).length;
  process.stderr.write(`[scan] sellers done: ${sellerDone}\n`);

  const discoveryRaw = await readFile(HERE + 'discovery.json', 'utf8').catch(() => '{}');
  let discovery = {};
  try {
    discovery = JSON.parse(discoveryRaw);
  } catch {
    discovery = {};
  }

  const bundle = {
    generated_at: new Date().toISOString(),
    tool: 'gates-probe',
    discovery,
    authority: {
      origins_scanned: authorityOrigins.length,
      reachable: authorityResults.filter((r) => r.reachable).length,
      results: authorityResults,
    },
    seller: {
      origins_scanned: sellerOrigins.length,
      reachable: sellerResults.filter((r) => r.reachable).length,
      results: sellerResults,
    },
  };
  await writeFile(OUT, JSON.stringify(bundle, null, 2));
  process.stderr.write(`[scan] wrote ${OUT}\n`);
}

main().catch((e) => {
  process.stderr.write(`[scan] error: ${e.message}\n`);
  process.exit(1);
});
