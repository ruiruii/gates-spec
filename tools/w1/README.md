# tools/w1 — x402 证据层现状报告（W1）管线

路乙的交付物：`gates-probe` 的批量扫描 → 《x402 证据层现状报告》。三步走：

```
discover.mjs  →  endpoints.txt   (CDP discovery + 已知账本种子)
scan.mjs      →  w1-raw.json     (逐端点跑 gates-probe，带超时与不可达容错)
report.mjs    →  reports/w1.md   (聚合为生态级覆盖分布 + 逐端点明细)
```

## 本地跑

```bash
node tools/w1/discover.mjs --out tools/w1/endpoints.txt
node tools/w1/scan.mjs --list tools/w1/endpoints.txt --out tools/w1/w1-raw.json
node tools/w1/report.mjs
```

> 沙箱无法直连公开账本（DNS 被占位），本地只会得到"不可达"的诚实记录。
> **真实数据由 `.github/workflows/w1.yml` 在 GitHub Actions 官方 runner 上每周一 04:23 UTC 自动产出并回写 `reports/w1.md`。**

## 设计纪律

- **测覆盖度，不打分**。报告只回答"这条账本公开的证据是否覆盖某属性"，不对任何实现者评级。
- 不可达端点记为 `UNREACHABLE` 而非失败，报告永远能渲染。
- CDP discovery 不可达时退回已知账本种子，保证至少扫描一个真实向量。

## 环境变量

- `W1_DISCOVERY_BASE`：CDP discovery 基址（默认 `https://api.automaton-sovereign.workers.dev`）。
- `W1_PROBE_TIMEOUT_MS`：单端点探针超时（默认 20000）。
