#!/usr/bin/env node
/**
 * w1-scan — run the evidence-layer census against every origin from a list.
 *
 * For each origin:
 *   - classify its evidence-layer posture (probeSurfaces)
 *   - if it exposes a hash-chained attestation ledger, also run the full
 *     gates-spec predicate battery (depth measurement)
 *
 * Input : newline-separated origins (default ./endpoints.txt, "#" comments ok)
 * Output: JSON bundle (default ./w1-raw.json) consumable by report.mjs
 */

import { readFile, writeFile } from 'node:fs/promises';
import { probe } from '@gates-spec/probe';
import { probeSurfaces } from './surface.mjs';

const LIST = process.argv.includes('--list')
  ? process.argv[process.argv.indexOf('--list') + 1]
  : new URL('./endpoints.txt', import.meta.url).pathname;
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : new URL('./w1-raw.json', import.meta.url).pathname;
const TIMEOUT_MS = Number(process.env.W1_PROBE_TIMEOUT_MS || 20000);

async function probeWithTimeout(origin) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const fetchImpl = (u) => fetch(u, { signal: ctrl.signal });
  try {
    const surf = await probeSurfaces(origin, fetchImpl, { timeoutMs: Math.min(8000, TIMEOUT_MS) });
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

async function main() {
  const text = await readFile(LIST, 'utf8');
  const origins = text
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s && !s.startsWith('#'));

  process.stderr.write(`[scan] probing ${origins.length} origin(s)…\n`);
  const results = [];
  for (const o of origins) {
    const r = await probeWithTimeout(o);
    const tag = r.posture || 'unreachable';
    process.stderr.write(`[scan] ${o} → ${tag}\n`);
    results.push(r);
  }

  const discoveryRaw = await readFile(new URL('./discovery.json', import.meta.url), 'utf8').catch(() => '{}');
  let discovery = {};
  try {
    discovery = JSON.parse(discoveryRaw);
  } catch {
    discovery = {};
  }

  const bundle = {
    generated_at: new Date().toISOString(),
    tool: 'gates-probe',
    origins_scanned: origins.length,
    reachable: results.filter((r) => r.reachable).length,
    discovery,
    results,
  };
  await writeFile(OUT, JSON.stringify(bundle, null, 2));
  process.stderr.write(`[scan] wrote ${OUT}\n`);
}

main().catch((e) => {
  process.stderr.write(`[scan] error: ${e.message}\n`);
  process.exit(1);
});
