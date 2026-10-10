#!/usr/bin/env node
/**
 * w1-report — turn a w1-raw.json scan bundle into the x402 evidence-layer
 * status report (Markdown).
 *
 * Design rule (inherited from gates-probe): we report COVERAGE, never a score.
 * The report answers "how much of the ecosystem's published evidence covers
 * each property?" — not "who is good or bad".
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = process.argv.includes('--in')
  ? process.argv[process.argv.indexOf('--in') + 1]
  : join(HERE, 'w1-raw.json');
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : join(HERE, '..', '..', 'reports', 'w1.md');

const PREDICATES = [
  ['ledger.hashIntegrity', 'L0', 'Hash integrity — every entry recomputes from its inputs'],
  ['ledger.chainContinuity', 'L0', 'Chain continuity — prevHash links + contiguous indices'],
  ['keyring.historyAware', 'L0', 'Key history published — retired keys resolvable by id'],
  ['evidence.contentBinding', 'L0/L1', 'Content binding — entries carry a real payload, not sha256("{}")'],
  ['evidence.settlementLinkage', 'L1/L2', 'Settlement linkage — an entry binds the request via a gates subject'],
  ['evidence.redeemCountDerivable', 'L0/L1', 'Redeem-count derivability — counts derived, not asserted'],
  ['evidence.settlementTrivalued', 'L1', 'Settlement trivaluation — a three-value settlement predicate is exposed'],
];

const STATUS_ORDER = ['pass', 'gap', 'fail', 'pending', 'info'];

function tally(bundle) {
  const byId = {};
  for (const [id, level, title] of PREDICATES) byId[id] = { id, level, title, pass: 0, gap: 0, fail: 0, pending: 0, info: 0, n: 0 };
  let reach = 0;
  for (const r of bundle.results) {
    if (!r.ok) continue;
    reach++;
    for (const p of r.report.predicates) {
      const t = byId[p.id];
      if (!t) continue;
      t[p.status] = (t[p.status] ?? 0) + 1;
      t.n++;
    }
  }
  return { byId, reach };
}

function pct(n, d) {
  return d ? `${Math.round((n / d) * 100)}%` : '—';
}

function render(bundle) {
  const { byId, reach } = tally(bundle);
  const total = bundle.origins_scanned ?? bundle.results.length;
  const unreach = total - reach;
  const when = new Date(bundle.generated_at).toISOString().slice(0, 16).replace('T', ' ');

  const lines = [];
  lines.push('# x402 证据层现状报告 · W1');
  lines.push('');
  lines.push(`> 生成时间：${when} · 工具：gates-probe · 覆盖端点：${total}（可达 ${reach} / 不可达 ${unreach}）`);
  lines.push('');
  lines.push('## 0. 这不是评分报告');
  lines.push('');
  lines.push('本报告只测量**已发布证据的覆盖度**，不对任何实现者打分。每条谓词回答一个问题：');
  lines.push('*这条账本公开的证据，是否覆盖了该属性？* 状态含义：`pass` 成立 · `gap` 已知且预期缺失的缺口 ·');
  lines.push('`fail` 本应成立却不成立（真实缺陷）· `pending` 本次缺少信息（如未提供 fingerprint）· `info` 仅陈述。');
  lines.push('');
  lines.push('> 战略定位：gates-spec 站在**裁判位**——持续判定"谁符合、谁不符合"，而非拥有标准或托管资产。');
  lines.push('');
  lines.push('## 1. 生态级覆盖分布');
  lines.push('');
  lines.push('下表统计**可达账本**中每条谓词的成立情况。这正是一张"全生态证据成熟度"的快照。');
  lines.push('');
  lines.push('| 谓词 | 层级 | pass | gap | fail | pending | info | 覆盖率* |');
  lines.push('|---|---|--:|--:|--:|--:|--:|--:|');
  for (const [id] of PREDICATES) {
    const t = byId[id];
    if (!t) continue;
    lines.push(
      `| \`${t.id}\` | ${t.level} | ${t.pass} | ${t.gap} | ${t.fail} | ${t.pending} | ${t.info} | ${pct(t.pass, t.n)} |`,
    );
  }
  lines.push('');
  lines.push('*\*覆盖率 = pass / 可达账本数。这只是"覆盖度"，不是质量评分。*');
  lines.push('');
  if (reach === 0) {
    lines.push('> ⚠️ **本版为首次生成，沙箱无法直连公开账本（DNS 被占位），故实时体检表为空。** 该表由');
    lines.push('> GitHub Actions 官方 runner 每周自动执行 `discover → scan → report` 后回写，下一轮运行即填充真实数据。');
    lines.push('');
  }
  lines.push('## 2. 逐端点明细');
  lines.push('');
  lines.push('| 端点 | 可达 | headline |');
  lines.push('|---|---|---|');
  for (const r of bundle.results) {
    if (r.ok) {
      lines.push(`| ${r.origin} | ✓ | ${r.report.summary.headline} |`);  // ` (keep markdown table clean)
    } else {
      lines.push(`| ${r.origin} | ✗ | 不可达：${r.error} |`);  // ` (keep markdown table clean)
    }
  }
  lines.push('');
  lines.push('## 3. 判定方法');
  lines.push('');
  lines.push('- **hashIntegrity**：逐条用 `(prevHash, timestamp, dataHash)` 重算 `hash`，验证链完整性。');
  lines.push('- **chainContinuity**：`prevHash` 指向前一条且 index 连续。');
  lines.push('- **keyring.historyAware**：pubkey 文档是否附带已退役密钥历史（否则仅当前密钥的验证器会拒绝历史合法条目）。');
  lines.push('- **contentBinding**：统计 `dataHash === sha256("{}")` 的条目占比——这正是"64% 签空对象"测量的来源。');
  lines.push('- **settlementLinkage / redeemCountDerivable**：需请求 fingerprint；缺省报 `pending`（已知缺口，非失败）。');
  lines.push('- **settlementTrivalued**：条目是否暴露三值结算谓词（`settled`/`in_flight`/`absent`）。');
  lines.push('');
  lines.push('## 4. 数据来源与复现');
  lines.push('');
  lines.push('- 端点清单来自 CDP discovery（`GET {base}/v2/x402/discovery/resources`）+ 已知公开账本种子列表。');
  lines.push('- 复现：`node tools/w1/discover.mjs --out endpoints.txt && node tools/w1/scan.mjs --list endpoints.txt && node tools/w1/report.mjs`');
  lines.push('- 或直接在任意账本上单点体检：`npx @gates-spec/probe probe <origin>`。');
  lines.push('');
  lines.push('## 5. 已知限制');
  lines.push('');
  lines.push('- 单点真实向量（automaton-sovereign）的结算绑定半（settlementLinkage）依赖对方公布 request fingerprint；');
  lines.push('  未公布前该半为 `pending`，属预期缺口，不计入缺陷。');
  lines.push('- 沙箱无法直连该端点（DNS 被占位），真实扫描由 GitHub Actions 官方 runner 每周执行并回写本报告。');
  lines.push('');
  return lines.join('\n');
}

async function main() {
  const bundle = JSON.parse(await readFile(IN, 'utf8'));
  const md = render(bundle);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, md);
  process.stderr.write(`[report] wrote ${OUT} (${bundle.reachable ?? '?'}/${bundle.origins_scanned ?? '?'} reachable)\n`);
  process.stdout.write(md + '\n');
}

main().catch((e) => {
  process.stderr.write(`[report] error: ${e.message}\n`);
  process.exit(1);
});
