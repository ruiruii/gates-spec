/**
 * gates-probe — evidence-layer probe core.
 *
 * Given an origin (or a local ledger file), runs a battery of coverage
 * predicates and returns a structured report. The report can be signed with an
 * observer Ed25519 key so it is itself a verifiable artifact (gate B: "we
 * measured, here is the signed record").
 *
 * Zero runtime deps beyond the workspace packages and node:crypto.
 */

import { createPrivateKey, createPublicKey, sign, verify as cryptoVerify } from 'node:crypto';
import { canonicalJSON, loadPrivateKey, loadPublicKey } from '@gates-spec/core';
import { runPredicates, PREDICATE_IDS } from './predicates.mjs';

export const TOOL = 'gates-probe';
export const VERSION = '0.1.0';

const b64u = (buf) => Buffer.from(buf).toString('base64url');

/**
 * @typedef {{
 *   origin: string,
 *   protocol?: string,
 *   adapter?: string,
 *   mode: 'live'|'offline',
 *   predicates: object[],
 *   summary: object,
 *   raw: object,
 *   generated_at: string
 * }} ProbeReport
 */

/**
 * Fetch a full ledger by paging from index 0. Returns every entry plus the
 * pubkey document if the origin exposes one.
 *
 * @param {string} origin
 * @param {(url:string)=>Promise<any>} [fetchImpl] injectable for tests
 */
export async function fetchLedger(origin, fetchImpl = globalThis.fetch) {
  const getJSON = async (url) => {
    const r = await fetchImpl(url);
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  };
  const PAGE = 50;
  const entries = [];
  let from = 0;
  let total = null;
  // Two candidate shapes: /v2/ledger (automaton) and a generic /ledger.
  const ledgerPath = (o) => `${o.replace(/\/$/, '')}/v2/ledger`;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const led = await getJSON(`${ledgerPath(origin)}?from=${from}&limit=${PAGE}`);
    if (total === null) total = led.total ?? null;
    const batch = led.entries ?? [];
    entries.push(...batch);
    if (batch.length < PAGE) break;
    from += batch.length;
    if (entries.length > 100000) break; // hard safety
  }
  let pubkey = null;
  try {
    pubkey = await getJSON(`${origin.replace(/\/$/, '')}/v2/pubkey`);
  } catch {
    /* optional */
  }
  return { entries, pubkey, total };
}

/**
 * Run the probe.
 *
 * @param {{
 *   target?: string,
 *   fromFile?: string,
 *   protocol?: string,
 *   adapter?: string,
 *   fingerprint?: string|null,
 *   attempts?: Array<{txHash:string, resourceId?:string, settled?:boolean}>,
 *   fetchImpl?: (url:string)=>Promise<any>,
 *   loadFile?: (path:string)=>Promise<any>
 * }} opts
 * @returns {Promise<ProbeReport>}
 */
export async function probe(opts = {}) {
  const {
    target,
    fromFile,
    protocol = 'x402',
    adapter = 'automaton',
    fingerprint = null,
    attempts = [],
    fetchImpl = globalThis.fetch,
    loadFile = defaultLoadFile,
  } = opts;

  let ledger;
  let mode;
  if (fromFile) {
    const doc = await loadFile(fromFile);
    ledger = { entries: doc.entries ?? [], pubkey: doc.pubkey ?? doc.keyring ?? null, total: doc.total ?? null };
    mode = 'offline';
  } else if (target) {
    ledger = await fetchLedger(target, fetchImpl);
    mode = 'live';
  } else {
    throw new TypeError('probe: pass either `target` (live) or `fromFile` (offline).');
  }

  const predicates = runPredicates(ledger, { fingerprint, attempts });
  return summarize({
    tool: TOOL,
    version: VERSION,
    generated_at: new Date().toISOString(),
    target: {
      origin: fromFile ? fromFile : target,
      protocol,
      adapter,
      mode,
      fingerprintSupplied: Boolean(fingerprint),
    },
    predicates,
    raw: {
      entryCount: ledger.entries.length,
      totalReported: ledger.total,
    },
  });
}

/** Wrap a probe result with summary counters. */
export function summarize(report) {
  const counts = { pass: 0, gap: 0, fail: 0, pending: 0, info: 0 };
  const levels = { L0: false, L1: false, L2: false };
  for (const p of report.predicates) {
    counts[p.status] = (counts[p.status] ?? 0) + 1;
    levels[p.level] = true;
  }
  const headline =
    counts.fail > 0
      ? `${counts.fail} predicate(s) failed — real defects, not gaps.`
      : counts.pending > 0 && counts.pass === 0 && counts.gap === 0
        ? 'Probing incomplete: supply --fingerprint to exercise the settlement-binding predicates.'
        : counts.gap > 0
          ? `${counts.gap} known gap(s) reported; ${counts.pass} predicate(s) hold.`
          : `All ${counts.pass} predicate(s) hold.`;
  report.summary = {
    total: report.predicates.length,
    ...counts,
    levels,
    headline,
  };
  return report;
}

/* ------------------------------------------------------------------ *
 * Signing — the report is itself a verifiable artifact.
 * ------------------------------------------------------------------ */

/**
 * Sign a report with an observer Ed25519 key.
 * @param {ProbeReport} report
 * @param {string} privateKeyRef `ed25519-priv:<base64url>`
 * @returns {{report: ProbeReport, signature: string, signer: {public_key:string, role:string}}}
 */
export function signReport(report, privateKeyRef) {
  const key = loadPrivateKey(privateKeyRef);
  const pub = createPublicKey(key);
  const payload = canonicalJSON(report);
  const signature = b64u(sign(null, Buffer.from(payload, 'utf8'), key));
  return {
    report,
    signature,
    signer: { public_key: `ed25519:${b64u(pub.export({ type: 'spki', format: 'der' }))}`, role: 'observer' },
  };
}

/**
 * Verify a signed report envelope. Returns {valid, error?}.
 * @param {{report:object, signature:string, signer:{public_key:string}}} envelope
 */
export function verifyReport(envelope) {
  if (!envelope || !envelope.report || typeof envelope.signature !== 'string') {
    return { valid: false, error: 'malformed envelope' };
  }
  try {
    const key = loadPublicKey(envelope.signer.public_key);
    const ok = cryptoVerify(
      null,
      Buffer.from(canonicalJSON(envelope.report), 'utf8'),
      key,
      Buffer.from(envelope.signature, 'base64url'),
    );
    return ok ? { valid: true } : { valid: false, error: 'signature mismatch' };
  } catch (err) {
    return { valid: false, error: `verification error — ${err.message}` };
  }
}

/* ------------------------------------------------------------------ *
 * Human-readable rendering
 * ------------------------------------------------------------------ */

const STATUS_GLYPH = { pass: 'PASS', gap: 'GAP ', fail: 'FAIL', pending: 'PEND', info: 'INFO' };

/**
 * @param {ProbeReport} report
 * @param {{signer?:{public_key:string}, verified?:boolean}} [meta]
 */
export function renderText(report, meta = {}) {
  const t = report.target;
  const lines = [];
  lines.push(`gates-probe v${report.version} — ${t.mode}${t.origin ? ` — ${t.origin}` : ''}`);
  lines.push(`protocol=${t.protocol} adapter=${t.adapter} fingerprint=${t.fingerprintSupplied ? 'yes' : 'no'}`);
  lines.push(`entries=${report.raw.entryCount}${report.raw.totalReported != null ? ` (reported ${report.raw.totalReported})` : ''}`);
  lines.push('');
  for (const p of report.predicates) {
    lines.push(`  [${STATUS_GLYPH[p.status]}] ${p.id}`);
    lines.push(`        ${p.message}`);
  }
  lines.push('');
  lines.push(`SUMMARY: ${report.summary.total} predicates · ${report.summary.pass} pass · ${report.summary.gap} gap · ${report.summary.fail} fail · ${report.summary.pending} pending`);
  lines.push(`LEVELS:  L0=${report.summary.levels.L0 ? '✓' : '·'} L1=${report.summary.levels.L1 ? '✓' : '·'} L2=${report.summary.levels.L2 ? '✓' : '·'}`);
  lines.push(`HEADLINE: ${report.summary.headline}`);
  if (meta.signer) {
    lines.push(`SIGNED:  ${meta.signer.public_key}${meta.verified ? ' (verified)' : ''}`);
  }
  return lines.join('\n');
}

async function defaultLoadFile(path) {
  const { readFile } = await import('node:fs/promises');
  return JSON.parse(await readFile(path, 'utf8'));
}

export { PREDICATE_IDS, runPredicates };
