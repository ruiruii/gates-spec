#!/usr/bin/env node
/**
 * w1-report — render the evidence-layer census bundle into a Markdown report.
 *
 * Reads w1-raw.json (produced by scan.mjs) and emits reports/w1.md.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const IN = process.argv.includes('--in')
  ? process.argv[process.argv.indexOf('--in') + 1]
  : join(HERE, 'w1-raw.json');
const OUT = process.argv.includes('--out')
  ? process.argv[process.argv.indexOf('--out') + 1]
  : join(HERE, '..', '..', 'reports', 'w1.md');

import { POSTURE_LABEL } from './surface.mjs';

const POSTURE_ORDER = ['attestation-ledger', 'signed-receipt', 'settlement-only', 'no-evidence', 'unreachable'];

function postureCounts(results) {
  const c = {};
  for (const r of results) c[r.posture || 'unreachable'] = (c[r.posture || 'unreachable'] || 0) + 1;
  return c;
}

function render(bundle) {
  const results = bundle.results || [];
  const counts = postureCounts(results);
  const d = bundle.discovery || {};
  const gen = (bundle.generated_at || new Date().toISOString()).replace('T', ' ').slice(0, 16);
  const reachable = bundle.reachable ?? results.filter((r) => r.reachable).length;

  const lines = [];
  lines.push('# x402 证据层现状报告 · W1');
  lines.push('');
  lines.push(
    `> 生成时间：${gen} · 工具：gates-probe · 证据权威端点：扫描 ${bundle.origins_scanned}（可达 ${reachable} / 不可达 ${bundle.origins_scanned - reachable}）`,
  );
  if (d.total_listed) {
    lines.push(
      `> 生态规模（公开 discovery 目录所列 x402 服务）：${d.total_listed} 个资源，跨 ${d.sources?.length || '?'} 个目录`,
    );
  }
  lines.push('');

  lines.push('## 0. 这不是评分报告');
  lines.push('');
  lines.push(
    '本报告只测量**已发布证据的覆盖度**，不对任何实现者打分。gates-spec 站在**裁判位**——持续判定"谁做了持久可验证存证、谁只结算不存证"，而非拥有标准或托管资产。',
  );
  lines.push('');
  lines.push('| 形态 | 含义 |');
  lines.push('|---|---|');
  lines.push('| `attestation-ledger` | 可读的哈希链账本（automaton 式）——持久、可独立验证的存证 |');
  lines.push('| `signed-receipt` | 公布签名回执 + 密钥文档（bsvkey 式）——每笔交付可离线验证 |');
  lines.push('| `settlement-only` | 可达的 x402 facilitator，但**无持久存证面**（只结算、不存证） |');
  lines.push('| `no-evidence` | 可达但未暴露上述任何证据面 |');
  lines.push('| `unreachable` | 无法连接 |');
  lines.push('');

  lines.push('## 1. 证据层形态分布');
  lines.push('');
  lines.push('下表统计被普查端点各自的证据形态。这正是"全生态证据成熟度"的快照。');
  lines.push('');
  lines.push('| 形态 | 端点数 | 占比 |');
  lines.push('|---|--:|--:|');
  for (const p of POSTURE_ORDER) {
    const n = counts[p] || 0;
    if (!n && p === 'no-evidence') continue;
    const pct = bundle.origins_scanned ? Math.round((n / bundle.origins_scanned) * 100) : 0;
    lines.push(`| ${POSTURE_LABEL[p] || p} | ${n} | ${pct}% |`);
  }
  lines.push('');

  // Core judge finding
  const ledger = counts['attestation-ledger'] || 0;
  const receipt = counts['signed-receipt'] || 0;
  const settleOnly = counts['settlement-only'] || 0;
  lines.push('**裁判结论**：在被普查的公开结算权威中，仅 ' + ledger + ' 个暴露哈希链账本、' + receipt + ' 个暴露签名回执；其余 ' + settleOnly + ' 个 facilitator 只结算、**不提供持久可验证存证**。这正是 gates-spec 证据层要填补的缺口。');
  if (d.total_listed) {
    lines.push(`对比生态规模（${d.total_listed} 个公开 x402 服务）：存证覆盖与结算覆盖之间的落差，就是证据层的市场空间。`);
  }
  lines.push('');

  lines.push('## 2. 逐端点明细');
  lines.push('');
  lines.push('| 端点 | 形态 | 关键面 |');
  lines.push('|---|---|---|');
  for (const r of results) {
    const surf = r.surfaces || {};
    const present = Object.entries(surf)
      .filter(([, v]) => v.present)
      .map(([k]) => k)
      .join(', ');
    const label = POSTURE_LABEL[r.posture] || r.posture || 'unreachable';
    lines.push(`| ${r.origin} | ${label} | ${present || '—'} |`);
  }
  lines.push('');

  // Depth table for attestation-ledger origins (existing 7 predicates)
  const ledgerResults = results.filter((r) => r.posture === 'attestation-ledger' && r.predicates);
  if (ledgerResults.length) {
    lines.push('## 3. 哈希链账本谓词深度（仅 attestation-ledger 形态）');
    lines.push('');
    lines.push('以下为 gates-spec 针对哈希链账本形态的全部谓词。状态：`pass` 成立 · `gap` 预期缺口 · `fail` 真实缺陷 · `pending` 缺信息（如未公布 fingerprint）· `info` 陈述。');
    lines.push('');
    const ids = [...new Set(ledgerResults.flatMap((r) => r.predicates.map((p) => p.id)))];
    lines.push('| 谓词 | ' + ledgerResults.map((r) => r.origin.replace(/^https?:\/\//, '')).join(' | ') + ' |');
    lines.push('|---|' + ledgerResults.map(() => '--:').join('|') + '|');
    for (const id of ids) {
      const row = ledgerResults.map((r) => {
        const p = r.predicates.find((x) => x.id === id);
        return p ? p.status : '—';
      });
      lines.push(`| ${id} | ${row.join(' | ')} |`);
    }
    lines.push('');
    lines.push('*覆盖率 = pass / 可达账本数。这是"覆盖度"，不是质量评分。*');
    lines.push('');
  }

  lines.push('## 4. 判定方法');
  lines.push('');
  lines.push('- **形态分类**：逐端点探测候选面（`/v2/ledger`、`/v2/pubkey`、`/v1/receipt-key`、`/supported`、`/health`），仅当该路径返回 **2xx 且为 JSON 文档** 时才计为"存在"——HTML 落地页/错误页不计为证据面，避免误报。');
  lines.push('- **生态规模**：取自 Circle / CDP 公开 discovery 目录所列 x402 资源数。');
  lines.push('- **哈希链账本谓词**：同《现状报告》原 7 条（hashIntegrity / chainContinuity / keyring.historyAware / contentBinding / settlementLinkage / redeemCountDerivable / settlementTrivalued）。');
  lines.push('- **contentBinding**：统计 `dataHash === sha256("{}")` 的条目占比——"签空对象"测量来源。');
  lines.push('- **settlementLinkage / redeemCountDerivable**：需请求 fingerprint；缺省报 `pending`（已知缺口，非失败）。');
  lines.push('');

  lines.push('## 5. 数据来源与复现');
  lines.push('');
  lines.push('- 端点清单：公开 x402 facilitator + ledger/receipt 服务种子列表（见 `discover.mjs`）。');
  lines.push('- 生态规模：`GET https://api.circle.com/v2/x402/discovery/resources` 等公开目录。');
  lines.push('- 复现：`node tools/w1/discover.mjs --out endpoints.txt --discovery-out discovery.json && node tools/w1/scan.mjs --list endpoints.txt --out w1-raw.json && node tools/w1/report.mjs`');
  lines.push('');

  lines.push('## 6. 已知限制');
  lines.push('');
  lines.push('- 沙箱无法直连大多数端点（DNS 被占位），真实扫描由 GitHub Actions 官方 runner 每周执行并回写本报告。');
  lines.push('- 单点真实账本（automaton-sovereign）的结算绑定半依赖对方公布 request fingerprint；未公布前为 `pending`，属预期缺口。');
  lines.push('- "settlement-only" 仅表示未暴露 gates-spec 所定义的持久存证面，不代表该 facilitator 无其他内部账目——判定的是**公开可验证**的证据。');

  return lines.join('\n') + '\n';
}

async function main() {
  const bundle = JSON.parse(await readFile(IN, 'utf8'));
  const md = render(bundle);
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, md);
  process.stderr.write(`[report] wrote ${OUT} (${md.length} bytes)\n`);
}

main().catch((e) => {
  process.stderr.write(`[report] error: ${e.message}\n`);
  process.exit(1);
});
