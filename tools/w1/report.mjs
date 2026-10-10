#!/usr/bin/env node
/**
 * w1-report — render the two-layer evidence-layer census bundle into Markdown.
 *
 * Reads w1-raw.json (produced by scan.mjs) and emits reports/w1.md.
 *
 * Two layers:
 *   - authority: settlement authorities (facilitators + ledgers/receipts)
 *   - seller:    resource servers from the public x402 discovery directories
 *
 * The report's punchline is the gap between ecosystem size (how many public
 * x402 endpoints exist) and evidence coverage (how few publish durable,
 * verifiable attestation of settlement).
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
  const authority = bundle.authority || { results: [], origins_scanned: 0, reachable: 0 };
  const seller = bundle.seller || { results: [], origins_scanned: 0, reachable: 0 };
  const aResults = authority.results || [];
  const sResults = seller.results || [];
  const d = bundle.discovery || {};
  const gen = (bundle.generated_at || new Date().toISOString()).replace('T', ' ').slice(0, 16);

  const aCounts = postureCounts(aResults);
  const sCounts = postureCounts(sResults);

  // Population = union of authority origins + seller origins (dedupe overlap).
  const popSet = new Set();
  for (const r of aResults) popSet.add(r.origin);
  for (const r of sResults) popSet.add(r.origin);
  const population = popSet.size;

  // Evidence-exposing = anything that publishes a durable, verifiable surface.
  const evidenceExposing =
    (aCounts['attestation-ledger'] || 0) +
    (aCounts['signed-receipt'] || 0) +
    (sCounts['attestation-ledger'] || 0) +
    (sCounts['signed-receipt'] || 0);

  const lines = [];
  lines.push('# x402 证据层现状报告 · W1');
  lines.push('');
  lines.push(
    `> 生成时间：${gen} · 工具：gates-probe · 普查端点：权威层 ${authority.origins_scanned}（可达 ${authority.reachable}）｜卖家层 ${seller.origins_scanned}（可达 ${seller.reachable}）`,
  );
  if (d.total_listed) {
    lines.push(
      `> 生态规模（公开 discovery 目录所列 x402 资源）：${d.total_listed} 个资源，跨 ${d.sources?.length || '?'} 个目录、${d.distinct_origins || '?'} 个卖家 origin`,
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
  lines.push('| `no-evidence` | 可达但未暴露上述任何证据面（卖家层常态） |');
  lines.push('| `unreachable` | 无法连接 |');
  lines.push('');

  // ── Punchline: ecosystem size vs evidence coverage ────────────────────────
  lines.push('## 1. 生态规模 vs 存证覆盖（核心结论）');
  lines.push('');
  lines.push('| 维度 | 数量 |');
  lines.push('|---|--:|');
  lines.push(`| 公开 x402 资源（卖家提供的受保护端点） | ${d.total_listed || '?'} |`);
  lines.push(`| 去重卖家 origin | ${d.distinct_origins || '?'} |`);
  lines.push(`| 结算权威（facilitator + 账本/回执服务） | ${authority.origins_scanned} |`);
  lines.push(`| **普查总端点（去重并集）** | **${population}** |`);
  lines.push(`| **暴露持久可验证存证的端点** | **${evidenceExposing}** |`);
  lines.push('');
  const coveragePct = population ? Math.round((evidenceExposing / population) * 100) : 0;
  lines.push(
    `**结论**：公开 x402 生态里已有 **${d.total_listed || '?'}** 个资源在卖、至少 **${population}** 个结算/出售端点在线，但其中只有 **${evidenceExposing}** 个（${coveragePct}%）暴露持久可验证的证据面——其余全部"只结算、不存证"。这就是 gates-spec 证据层要填补的市场空间。`,
  );
  lines.push('');

  // ── Authority layer distribution ───────────────────────────────────────────
  lines.push('## 2. 权威层形态分布（17 个 facilitator / 账本 / 回执服务）');
  lines.push('');
  lines.push('下表统计结算权威各自的证据形态。');
  lines.push('');
  lines.push('| 形态 | 端点数 | 占比 |');
  lines.push('|---|--:|--:|');
  for (const p of POSTURE_ORDER) {
    const n = aCounts[p] || 0;
    if (!n) continue;
    const pct = authority.origins_scanned ? Math.round((n / authority.origins_scanned) * 100) : 0;
    lines.push(`| ${POSTURE_LABEL[p] || p} | ${n} | ${pct}% |`);
  }
  lines.push('');
  lines.push(
    `**裁判结论**：在被普查的公开结算权威中，仅 ${(aCounts['attestation-ledger'] || 0)} 个暴露哈希链账本、${(aCounts['signed-receipt'] || 0)} 个暴露签名回执；其余 ${(aCounts['settlement-only'] || 0)} 个 facilitator 只结算、**不提供持久可验证存证**。`,
  );
  lines.push('');

  // ── Seller layer distribution ──────────────────────────────────────────────
  lines.push('## 3. 卖家层普查（公开 discovery 目录所列资源服务器）');
  lines.push('');
  if (seller.origins_scanned) {
    lines.push(
      `对 ${seller.origins_scanned} 个去重卖家 origin 逐一探测其是否**自建**持久存证面（哈希链账本 / 签名回执）。卖家通常把结算委托给 facilitator，自身不跑账本——下面验证这一假设。`,
    );
    lines.push('');
    lines.push('| 形态 | 端点数 | 占比 |');
    lines.push('|---|--:|--:|');
    for (const p of POSTURE_ORDER) {
      const n = sCounts[p] || 0;
      if (!n) continue;
      const pct = seller.origins_scanned ? Math.round((n / seller.origins_scanned) * 100) : 0;
      lines.push(`| ${POSTURE_LABEL[p] || p} | ${n} | ${pct}% |`);
    }
    lines.push('');
    const sEvidence = (sCounts['attestation-ledger'] || 0) + (sCounts['signed-receipt'] || 0);
    lines.push(
      `**结论**：卖家层里自建存证面的端点为 **${sEvidence}** 个。绝大多数卖家可达但暴露无证据面（no-evidence），印证了"存证责任完全落在 facilitator 一侧、而 facilitator 也几乎不存证"的结构性缺口。`,
    );
  } else {
    lines.push('_本次 discovery 未返回可解析的卖家清单（端点不可达或格式变更），卖家层暂缺。_');
  }
  lines.push('');

  // ── Ledger depth table (authority attestation-ledger only) ─────────────────
  const ledgerResults = aResults.filter((r) => r.posture === 'attestation-ledger' && r.predicates);
  if (ledgerResults.length) {
    lines.push('## 4. 哈希链账本谓词深度（仅 attestation-ledger 形态）');
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

  // ── Per-endpoint detail ────────────────────────────────────────────────────
  lines.push('## 5. 逐端点明细');
  lines.push('');
  lines.push('**权威层**');
  lines.push('');
  lines.push('| 端点 | 形态 | 关键面 |');
  lines.push('|---|---|---|');
  for (const r of aResults) {
    const surf = r.surfaces || {};
    const present = Object.entries(surf)
      .filter(([, v]) => v.present)
      .map(([k]) => k)
      .join(', ');
    const label = POSTURE_LABEL[r.posture] || r.posture || 'unreachable';
    lines.push(`| ${r.origin} | ${label} | ${present || '—'} |`);
  }
  lines.push('');
  if (seller.origins_scanned) {
    lines.push('**卖家层**（仅列非 unreachable；按资源数降序取前 30）');
    lines.push('');
    lines.push('| 端点 | 形态 | 资源数 | 所用 facilitator |');
    lines.push('|---|---|--:|---|');
    const sellersMeta = (d.sellers || []).reduce((m, s) => ((m[s.origin] = s), m), {});
    const shown = sResults
      .filter((r) => r.posture !== 'unreachable')
      .sort((x, y) => (sellersMeta[y.origin]?.resourceCount || 0) - (sellersMeta[x.origin]?.resourceCount || 0))
      .slice(0, 30);
    for (const r of shown) {
      const meta = sellersMeta[r.origin] || {};
      const label = POSTURE_LABEL[r.posture] || r.posture || 'unreachable';
      const facs = (meta.facilitators || []).map((f) => f.replace(/^https?:\/\//, '')).join(', ') || '—';
      lines.push(`| ${r.origin} | ${label} | ${meta.resourceCount || '?'} | ${facs} |`);
    }
    lines.push('');
  }

  // ── Method ─────────────────────────────────────────────────────────────────
  lines.push('## 6. 判定方法');
  lines.push('');
  lines.push('- **形态分类**：逐端点探测候选面（`/v2/ledger`、`/v2/pubkey`、`/v1/receipt-key`；权威层另加 `/supported`、`/health`）。仅当该路径返回 **2xx 且为 JSON 文档** 时才计为"证据面存在"——HTML 落地页/错误页不计，避免误报。');
  lines.push('- **可达性**：只要任一被探路径返回了 HTTP 响应（含 404）即视为可达；全部无响应才算不可达——避免把"活但不存证"的卖家误判为宕机。');
  lines.push('- **卖家层**只问证据问题（是否自建账本/回执），不问 facilitator 专属端点。');
  lines.push('- **生态规模**：取自 Circle / CDP 公开 discovery 目录所列 x402 资源数及去重卖家 origin。');
  lines.push('- **哈希链账本谓词**：同《现状报告》原 7 条（hashIntegrity / chainContinuity / keyring.historyAware / contentBinding / settlementLinkage / redeemCountDerivable / settlementTrivalued）。');
  lines.push('- **contentBinding**：统计 `dataHash === sha256("{}")` 的条目占比——"签空对象"测量来源。');
  lines.push('- **settlementLinkage / redeemCountDerivable**：需请求 fingerprint；缺省报 `pending`（已知缺口，非失败）。');
  lines.push('');

  lines.push('## 7. 数据来源与复现');
  lines.push('');
  lines.push('- 端点清单：公开 x402 facilitator + ledger/receipt 服务种子（`discover.mjs` 的 `EVIDENCE_SEED`）。');
  lines.push('- 卖家清单：Circle / CDP 公开 discovery 目录所列资源服务器的去重 origin。');
  lines.push('- 生态规模：`GET https://api.circle.com/v2/x402/discovery/resources` 等公开目录。');
  lines.push('- 复现：');
  lines.push('  ```');
  lines.push('  node tools/w1/discover.mjs --out endpoints.txt --sellers-out sellers.txt --discovery-out discovery.json');
  lines.push('  node tools/w1/scan.mjs --list endpoints.txt --sellers sellers.txt --out w1-raw.json');
  lines.push('  node tools/w1/report.mjs');
  lines.push('  ```');
  lines.push('');

  lines.push('## 8. 已知限制');
  lines.push('');
  lines.push('- 沙箱无法直连大多数端点（DNS 被占位），真实扫描由 GitHub Actions 官方 runner 每周执行并回写本报告。');
  lines.push('- 单点真实账本（automaton-sovereign）的结算绑定半依赖对方公布 request fingerprint；未公布前为 `pending`，属预期缺口。');
  lines.push('- "settlement-only" / "no-evidence" 仅表示未暴露 gates-spec 所定义的持久存证面，不代表该端点无其他内部账目——判定的是**公开可验证**的证据。');

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
