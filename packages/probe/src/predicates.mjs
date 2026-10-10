/**
 * Coverage predicates for an evidence-layer probe.
 *
 * Design rule: a predicate MEASURES coverage. It never scores the implementer.
 * Status vocabulary:
 *   pass     — the predicate holds (good)
 *   gap      — a known, expected-to-be-missing gap (the point of a known-gap vector)
 *   fail     — should hold but does not (a real defect)
 *   pending  — needs information this run did not have (e.g. no fingerprint)
 *   info     — informational, no pass/fail semantics
 *
 * `level` is the evidence-layer maturity this predicate speaks to, not a grade
 * for the target: L0 = payment only, L1 = consumption predicate present,
 * L2 = bilaterally verifiable.
 */

import { createHash, createPublicKey, verify as cryptoVerify } from 'node:crypto';
import { contentBindingRatio, deriveRedeemCount } from '@gates-spec/adapter-automaton';
import { normalizeSettlement } from '@gates-spec/core';

const reHash = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * @typedef {{
 *   id: string,
 *   title: string,
 *   status: 'pass'|'gap'|'fail'|'pending'|'info',
 *   level: 'L0'|'L1'|'L2',
 *   message: string,
 *   evidence?: unknown
 * }} Predicate
 */

/**
 * Recompute an entry's hash the way the chain defines it and compare.
 * @param {{index:number, prevHash:string, timestamp:string, dataHash:string, hash:string}} e
 */
function recomputeHash(e) {
  return reHash(`${e.prevHash}|${e.timestamp}|${e.dataHash}`) === e.hash;
}

/** P1 — every entry's hash recomputes from (prevHash, timestamp, dataHash). */
export function predicateHashIntegrity(entries) {
  if (!entries.length) return pending('ledger.hashIntegrity', 'No entries fetched.');
  let matched = 0;
  const bad = [];
  for (const e of entries) {
    if (recomputeHash(e)) matched++;
    else bad.push(e.index);
  }
  const ok = matched === entries.length;
  return {
    id: 'ledger.hashIntegrity',
    title: 'Hash integrity — every entry recomputes from its inputs',
    status: ok ? 'pass' : 'fail',
    level: 'L0',
    message: ok
      ? `All ${entries.length} entries recompute.`
      : `${entries.length - matched}/${entries.length} entries do not recompute (indices ${bad.slice(0, 10).join(', ')}${bad.length > 10 ? '…' : ''}).`,
    evidence: { matched, total: entries.length, badIndices: bad },
  };
}

/** P2 — prevHash links each entry to its predecessor; indices are contiguous. */
export function predicateChainContinuity(entries) {
  if (!entries.length) return pending('ledger.chainContinuity', 'No entries fetched.');
  const sorted = [...entries].sort((a, b) => a.index - b.index);
  const contiguous = sorted.every((e, i) => e.index === i);
  const broken = [];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].prevHash !== sorted[i - 1].hash) broken.push(sorted[i].index);
  }
  const ok = contiguous && broken.length === 0;
  return {
    id: 'ledger.chainContinuity',
    title: 'Chain continuity — prevHash links to predecessor; indices contiguous',
    status: ok ? 'pass' : 'fail',
    level: 'L0',
    message: ok
      ? `Indices 0..${sorted.length - 1} contiguous; all prevHash links hold.`
      : `contiguous=${contiguous}, brokenLinks=${broken.length ? broken.join(', ') : 'none'}.`,
    evidence: { contiguous, brokenIndices: broken, span: [sorted[0].index, sorted[sorted.length - 1].index] },
  };
}

/** P3 — verifier resolves signing keys by id against current + history (not current-only). */
export function predicateKeyHistoryAware(pubkey) {
  if (!pubkey || !pubkey.keyId) return pending('keyring.historyAware', 'No pubkey document fetched.');
  const history = Array.isArray(pubkey.history) ? pubkey.history : [];
  const ok = history.length > 0;
  return {
    id: 'keyring.historyAware',
    title: 'Key history published — verifier can resolve retired keys by id',
    status: ok ? 'pass' : 'gap',
    level: 'L0',
    message: ok
      ? `${history.length} retired key(s) published alongside current ${pubkey.keyId}.`
      : `Only current key ${pubkey.keyId} published; no history → a current-key-only verifier rejects valid historical entries.`,
    evidence: { currentKeyId: pubkey.keyId, retiredCount: history.length },
  };
}

/**
 * P4 — content binding: how many entries sign an EMPTY object (sha256("{}")).
 * Independent of gates-spec: an empty-object attestation proves "we signed
 * something", not "we signed something about this payment".
 */
export function predicateContentBinding(entries) {
  if (!entries.length) return pending('evidence.contentBinding', 'No entries fetched.');
  const r = contentBindingRatio(entries);
  const ratio = r.ratio;
  // 0 empty → strong binding; >0 → some attestations sign nothing.
  const status = r.empty === 0 ? 'pass' : ratio <= 0.5 ? 'gap' : 'gap';
  return {
    id: 'evidence.contentBinding',
    title: 'Content binding — entries carry a real payload, not sha256("{}")',
    status,
    level: r.empty === 0 ? 'L1' : 'L0',
    message: `${r.empty}/${r.total} entries sign an empty object (bound ${r.bound}, ratio ${ratio.toFixed(3)})${
      r.emptyIndices.length ? ` at indices ${r.emptyIndices[0]}..${r.emptyIndices[r.emptyIndices.length - 1]}` : ''
    }.`,
    evidence: r,
  };
}

/**
 * P5 — settlement linkage: does any entry bind a logical request via a gates
 * subject? Needs the request fingerprint; reports pending without it.
 * @param {object[]} entries
 * @param {{fingerprint?:string|null, attempts?:Array<{txHash:string, resourceId?:string, settled?:boolean}>}} opts
 */
export function predicateSettlementLinkage(entries, opts = {}) {
  const { fingerprint = null, attempts = [] } = opts;
  if (!fingerprint) {
    return {
      id: 'evidence.settlementLinkage',
      title: 'Settlement linkage — an entry binds this payment via a gates subject',
      status: 'pending',
      level: 'L2',
      message:
        'No request fingerprint supplied — the settlement-binding half cannot be tested. Provide --fingerprint or --binding.',
      evidence: { reason: 'missing_fingerprint' },
    };
  }
  if (!entries.length) return pending('evidence.settlementLinkage', 'No entries fetched.');
  const derived = deriveRedeemCount(entries, { fingerprint, attempts });
  const ok = derived.boundToFingerprint;
  return {
    id: 'evidence.settlementLinkage',
    title: 'Settlement linkage — an entry binds this payment via a gates subject',
    status: ok ? 'pass' : 'gap',
    level: ok ? 'L2' : 'L1',
    message: ok
      ? `redeem_count=${derived.redeemCount}; ${derived.matched.length} entry/ies bind the fingerprint.`
      : 'Chain reproduces; settlement link not yet present (known-gap vector).',
    evidence: derived,
  };
}

/**
 * P6 — redeem-count derivability: the ledger exposes enough structure that a
 * count is derivable rather than asserted. Mirrors P5 but reports the structural
 * capability even when no specific fingerprint is in scope.
 */
export function predicateRedeemCountDerivable(entries, opts = {}) {
  const { fingerprint = null, attempts = [] } = opts;
  if (!entries.length) return pending('evidence.redeemCountDerivable', 'No entries fetched.');
  if (!fingerprint) {
    return {
      id: 'evidence.redeemCountDerivable',
      title: 'Redeem-count derivability — counts are derived, not asserted',
      status: 'pending',
      level: 'L1',
      message:
        'No fingerprint in scope; cannot confirm a count is derivable for a concrete request. Provide --fingerprint to exercise it.',
      evidence: { reason: 'missing_fingerprint' },
    };
  }
  const derived = deriveRedeemCount(entries, { fingerprint, attempts });
  return {
    id: 'evidence.redeemCountDerivable',
    title: 'Redeem-count derivability — counts are derived, not asserted',
    status: derived.boundToFingerprint ? 'pass' : 'gap',
    level: derived.boundToFingerprint ? 'L1' : 'L0',
    message: derived.boundToFingerprint
      ? `Count derivable: redeem_count=${derived.redeemCount} from ${derived.matched.length} matched entr${derived.matched.length === 1 ? 'y' : 'ies'}.`
      : 'No entry carries a fingerprint-bound subject; count would be asserted, not derived.',
    evidence: derived,
  };
}

/**
 * P7 — settlement trivaluation: entries expose a field the spec maps onto the
 * three-value settlement predicate (settled | in_flight | absent). If the ledger
 * carries no such field, report info rather than fail — many signature ledgers
 * do not double as settlement-status ledgers.
 */
export function predicateSettlementTrivalued(entries) {
  if (!entries.length) return pending('evidence.settlementTrivalued', 'No entries fetched.');
  const field = ['settlementStatus', 'settlement_status', 'status', 'settled'];
  const found = new Set();
  const values = {};
  for (const e of entries) {
    for (const f of field) {
      if (e[f] !== undefined) {
        found.add(f);
        const norm = normalizeSettlement(e[f]);
        values[norm] = (values[norm] ?? 0) + 1;
      }
    }
  }
  if (found.size === 0) {
    return {
      id: 'evidence.settlementTrivalued',
      title: 'Settlement trivaluation — a three-value settlement predicate is exposed',
      status: 'info',
      level: 'L1',
      message:
        'Ledger entries carry no settlement-status field; trivaluation is not observable here (common for signature ledgers).',
      evidence: { observedFields: [] },
    };
  }
  const seen = Object.keys(values);
  return {
    id: 'evidence.settlementTrivalued',
    title: 'Settlement trivaluation — a three-value settlement predicate is exposed',
    status: 'pass',
    level: 'L1',
    message: `Settlement values observed across entries: ${seen.join(', ')}.`,
    evidence: { fields: [...found], distribution: values },
  };
}

export const PREDICATE_IDS = [
  'ledger.hashIntegrity',
  'ledger.chainContinuity',
  'keyring.historyAware',
  'evidence.contentBinding',
  'evidence.settlementLinkage',
  'evidence.redeemCountDerivable',
  'evidence.settlementTrivalued',
];

/**
 * Run the full predicate battery.
 * @param {{entries:object[], pubkey?:object}} ledger
 * @param {{fingerprint?:string|null, attempts?:Array}} opts
 * @returns {Predicate[]}
 */
export function runPredicates(ledger, opts = {}) {
  const { entries = [], pubkey } = ledger;
  return [
    predicateHashIntegrity(entries),
    predicateChainContinuity(entries),
    predicateKeyHistoryAware(pubkey),
    predicateContentBinding(entries),
    predicateSettlementLinkage(entries, opts),
    predicateRedeemCountDerivable(entries, opts),
    predicateSettlementTrivalued(entries),
  ];
}

function pending(id, msg) {
  return { id, title: id, status: 'pending', level: 'L0', message: msg };
}

/** Verify a single entry's ECDSA-P256-SHA256 (DER) signature over ASCII-hex hash. */
export function verifyEntrySignature(entry, pem) {
  try {
    return cryptoVerify(
      'sha256',
      Buffer.from(entry.hash, 'ascii'),
      { key: createPublicKey(pem), dsaEncoding: 'der' },
      Buffer.from(entry.signature, 'base64'),
    );
  } catch {
    return false;
  }
}
