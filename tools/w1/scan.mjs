#!/usr/bin/env node
/**
 * w1-scan — run gates-probe against every origin from a list and collect results.
 *
 * Input : newline-separated origins (default ./endpoints.txt, "#" comments ok)
 * Output: JSON array of per-origin results (default ./w1-raw.json)
 *
 * Each origin is probed live with a timeout. Unreachable origins are recorded
 * as {ok:false} rather than throwing, so the report always renders.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { probe } from '@gates-spec/probe';

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
  try {
    const report = await probe({ target: origin, fetchImpl: (u) => fetch(u, { signal: ctrl.signal }) });
    return { origin, ok: true, report };
  } catch (e) {
    return { origin, ok: false, error: e.name === 'AbortError' ? `timeout (>${TIMEOUT_MS}ms)` : e.message };
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
    if (r.ok) {
      const s = r.report.summary;
      process.stderr.write(`[scan] ${o} → ${s.headline}\n`);
    } else {
      process.stderr.write(`[scan] ${o} → UNREACHABLE (${r.error})\n`);
    }
    results.push(r);
  }

  const bundle = {
    generated_at: new Date().toISOString(),
    tool: 'gates-probe',
    origins_scanned: origins.length,
    reachable: results.filter((r) => r.ok).length,
    results,
  };
  await writeFile(OUT, JSON.stringify(bundle, null, 2));
  process.stderr.write(`[scan] wrote ${OUT} (${bundle.reachable}/${bundle.origins_scanned} reachable)\n`);
}

main().catch((e) => {
  process.stderr.write(`[scan] error: ${e.message}\n`);
  process.exit(1);
});
