#!/usr/bin/env node
/**
 * gates-probe CLI
 *
 *   gates-probe probe [TARGET] [options]
 *   gates-probe verify <REPORT.json> [options]
 *   gates-probe batch --list <urls.txt> [options]
 *
 * Examples
 *   node bin/gates-probe.mjs probe https://api.automaton-sovereign.workers.dev
 *   node bin/gates-probe.mjs probe https://example.org --json --out report.json
 *   node bin/gates-probe.mjs probe https://example.org --fingerprint sha256:abc --sign --key ./key.json
 *   node bin/gates-probe.mjs probe --from-file ./ledger.json        # offline
 *   node bin/gates-probe.mjs verify ./report.signed.json
 *   node bin/gates-probe.mjs batch --list ./endpoints.txt --json
 */

import { writeFile, readFile } from 'node:fs/promises';
import { generateKeyPair } from '@gates-spec/core';
import { probe, signReport, verifyReport, renderText } from '../src/index.mjs';

const USAGE = `gates-probe — evidence-layer probe for payment ledgers

Usage:
  gates-probe probe [TARGET] [options]
  gates-probe verify <REPORT.json> [options]
  gates-probe batch --list <urls.txt> [options]

probe options:
  -t, --target <url>      Target origin (alias: positional TARGET)
  -f, --from-file <path>  Offline mode: read a ledger JSON file
      --protocol <name>   x402 (default) | mpp | ap2 | fiat | other
      --adapter <name>    automaton (default) | generic
  -F, --fingerprint <h>   Request fingerprint for the settlement-binding half
      --json              Emit JSON instead of text
      --sign              Sign the report (needs --key, or a throwaway key is made)
      --key <path>        Path to a JSON file with {privateKey:"ed25519-priv:..."}
      --out <path>        Write the report (or signed envelope) to a file
      --quiet             Print only the headline + summary line

verify options:
  <REPORT.json>           A signed report envelope (from --sign --out)

batch options:
      --list <file>       Newline-separated list of target URLs
      --json              Emit a JSON array of per-target results
`;

function parseArgs(argv) {
  const args = argv.slice(2);
  const cmd = args[0];
  const pos = [];
  const opt = {};
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (!a.startsWith('-')) { pos.push(a); continue; }
    const key = a.replace(/^--?/, '');
    const next = args[i + 1];
    if (next === undefined || next.startsWith('-')) { opt[key] = true; continue; }
    opt[key] = next;
    i++;
  }
  return { cmd, pos, opt };
}

function die(msg) {
  process.stderr.write(`${msg}\n${USAGE}\n`);
  process.exit(2);
}

async function loadKey(path) {
  if (!path) return null;
  const j = JSON.parse(await readFile(path, 'utf8'));
  return j.privateKey ?? j.private_key ?? j.key ?? null;
}

function emit(report, { json, out, signed, verified }) {
  const payload = signed ?? report;
  if (out) {
    writeFile(out, JSON.stringify(payload, null, 2)).catch((e) => {
      process.stderr.write(`warn: could not write ${out}: ${e.message}\n`);
    });
  }
  if (json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    process.stdout.write(renderText(report, signed ? { signer: signed.signer, verified } : {}) + '\n');
  }
}

async function cmdProbe(pos, opt) {
  const target = opt.target ?? opt.t ?? pos[0] ?? null;
  const report = await probe({
    target,
    fromFile: opt['from-file'] ?? opt.f,
    protocol: opt.protocol ?? 'x402',
    adapter: opt.adapter ?? 'automaton',
    fingerprint: opt.fingerprint ?? opt.F ?? null,
    attempts: opt.attempts ? JSON.parse(opt.attempts) : [],
  });

  if (opt.quiet) {
    process.stdout.write(`${report.summary.headline}\n`);
    return report;
  }

  if (opt.sign) {
    let key = await loadKey(opt.key);
    let generated = false;
    if (!key) {
      const kp = generateKeyPair();
      key = kp.privateKey;
      generated = true;
    }
    const signed = signReport(report, key);
    const verified = verifyReport(signed).valid;
    emit(report, { json: opt.json, out: opt.out, signed, verified });
    if (generated && !opt.json) {
      process.stderr.write(
        `\n(throwaway key used — rerun with --key to keep signing stable)\n` +
        `  private: ${key}\n  public:  ${signed.signer.public_key}\n`,
      );
    }
    return signed;
  }

  emit(report, { json: opt.json, out: opt.out });
  return report;
}

async function cmdVerify(pos, opt) {
  const file = pos[0];
  if (!file) die('verify needs a report file argument.');
  const envelope = JSON.parse(await readFile(file, 'utf8'));
  const res = verifyReport(envelope);
  if (opt.json) {
    process.stdout.write(JSON.stringify({ valid: res.valid, error: res.error ?? null }) + '\n');
  } else {
    process.stdout.write(res.valid ? 'REPORT VALID — signature verifies.\n' : `REPORT INVALID — ${res.error}\n`);
  }
  process.exit(res.valid ? 0 : 1);
}

async function cmdBatch(pos, opt) {
  const list = opt.list;
  if (!list) die('batch needs --list <urls.txt>.');
  const urls = (await readFile(list, 'utf8'))
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length && !s.startsWith('#'));
  const results = [];
  for (const url of urls) {
    try {
      const r = await probe({ target: url, protocol: opt.protocol ?? 'x402', adapter: opt.adapter ?? 'automaton' });
      results.push({ origin: url, ok: true, summary: r.summary, headline: r.summary.headline });
    } catch (e) {
      results.push({ origin: url, ok: false, error: e.message });
    }
  }
  if (opt.json) process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  else {
    for (const r of results) {
      process.stdout.write(
        r.ok ? `  [OK]   ${r.origin} — ${r.headline}\n` : `  [ERR]  ${r.origin} — ${r.error}\n`,
      );
    }
  }
  return results;
}

async function main() {
  const { cmd, pos, opt } = parseArgs(process.argv);
  if (!cmd || opt.help || opt.h) { process.stdout.write(USAGE); return; }
  try {
    if (cmd === 'probe') await cmdProbe(pos, opt);
    else if (cmd === 'verify') await cmdVerify(pos, opt);
    else if (cmd === 'batch') await cmdBatch(pos, opt);
    else die(`unknown command: ${cmd}`);
  } catch (e) {
    process.stderr.write(`error: ${e.message}\n`);
    process.exit(1);
  }
}

main();
