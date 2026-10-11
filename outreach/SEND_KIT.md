# 发送工具包（复制粘贴即用）

弹药已备齐。下面是三件"对外动作"的成品文案，复制粘贴即可。**发完这三件，才叫推进。**

| # | 动作 | 文案 | 附件/链接 |
|---|---|---|---|
| 1 | 邮件 → automaton | §1 | `automaton-deep-profile.md` |
| 2 | 邮件 → bsvkey | §2 | `bsvkey-deep-profile.md` |
| 3 | x402 Slack 首帖 | §3 | `reports/w1-en.md` |

**公开链接（三处都要用）：**
- 英文普查报告：`https://github.com/ruiruii/gates-spec/blob/main/reports/w1-en.md`
- 方法/盲区/申诉：`https://github.com/ruiruii/gates-spec/blob/main/TRANSPARENCY.en.md`
- 原始实测数据：`https://raw.githubusercontent.com/ruiruii/gates-spec/main/tools/w1/w1-raw.json`

---

## 1. 邮件 → automaton

**Subject:** You're 1 of only 2 — independent attestation profile for automaton

> Hi —
>
> I run gates-probe, a weekly independent census of verifiable evidence in the public x402 ecosystem. Latest run: **150 resources selling, 77 endpoints live, and only 2 (3%) expose evidence an independent party can verify.** automaton is one of the two.
>
> Your ledger passes hash integrity, chain continuity, and history-aware keyring — genuinely rare. Two findings worth your time:
>
> - **`evidence.contentBinding`: gap.** 22 of 34 entries (64.7%) sign an empty object (`dataHash === sha256("{}")`). Notably the 22 are **contiguous at indices 12–33** — the first 12 bind content correctly, then binding stops. That pattern looks like a regression rather than a design choice, which means it should be recoverable.
> - **Two predicates are `pending`, not failed.** Both need a published request fingerprint. That's a gap in what's published, not a defect in your implementation — publish the scheme and they'd likely convert to `pass`.
>
> Full profile attached; everything in it is reproducible from your public endpoints.
>
> **What I'd like:** to certify automaton as `gates-probe Verified` — the first attestation-ledger implementation in the ecosystem to hold it. Annual certification $3k–$10k depending on scope, including quarterly re-scoring and a published profile you can cite in RFPs and compliance responses.
>
> To be explicit about how this works: **payment does not affect any published score.** Your contentBinding gap stays published as a gap until it is closed. That's the entire basis of our credibility.
>
> Open to a 30-minute call? Happy to walk through the predicate-level output.
>
> — [name]

---

## 2. 邮件 → bsvkey

**Subject:** The only signed-receipt implementation we found — profile + one question

> Hi —
>
> I run gates-probe, a weekly independent census of verifiable evidence in the public x402 ecosystem. Latest run: **150 resources selling, 77 endpoints live, 2 (3%) expose verifiable evidence.** bsvkey is one of the two — and **the only signed-receipt implementation** we found. The other evidence-bearing endpoint uses a hash-chain ledger.
>
> What we verified: you publish a receipt key document, which is what makes offline verification possible in principle. In a market where **0 of 60 seller origins** run any evidence surface and **14 of 17** settlement authorities settle without attesting, that's a real differentiator.
>
> I want to be straight about our own limits: our seven-dimension receipt assessment is **mostly unverified** for you — we list 1 verified and 6 unverified rather than implying more than we know. Profile attached.
>
> **One question:** would you send 2–3 sample receipts (redacted is fine) or a link to the receipt format documentation? We'll return the full seven-dimension assessment **at no cost**, and then discuss `gates-probe Verified` certification if it's useful to you.
>
> Same disclosure as above: certification buys depth, re-scoring and the right to cite the mark — never a favourable result. Anything we can't verify is published as unverified.
>
> — [name]

---

## 3. x402 Slack 首帖

**加入：** `https://join.slack.com/t/x402workspace/shared_invite/zt-49ug1ivvr-M5LYYp_eZ4OD3lA5n2qM1g`
**建议频道：** `#general`（若不合适，问管理员该发哪里）

> Hi all — I've been running a weekly independent census of **verifiable evidence across the public x402 ecosystem** and wanted to share the data, since it may be useful to the working groups.
>
> Latest run (2026-10-10, 77 endpoints):
>
> - 150 resources listed across the Circle and CDP discovery directories, 60 distinct seller origins
> - **2 of 77 endpoints (≈3%) expose persistent, verifiable evidence** — one hash-chain ledger, one signed-receipt service
> - **0 of 60 seller origins** run their own attestation surface
> - **14 of 17** settlement authorities settle without attesting
>
> One thing the data surfaced that I think is worth a discussion: where evidence *does* exist, existence isn't the same as quality. In the one live ledger, **22 of 34 entries sign an empty object** (`sha256("{}")`) — a valid signature that commits to nothing. The 22 are contiguous from index 12 onward, so it looks like a regression rather than a design choice.
>
> Report, method, blind spots and raw data are all public:
> - Report: `https://github.com/ruiruii/gates-spec/blob/main/reports/w1-en.md`
> - Method, blind spots, appeals: `https://github.com/ruiruii/gates-spec/blob/main/TRANSPARENCY.en.md`
> - Raw measurements: `tools/w1/w1-raw.json` in the same repo
>
> **Question:** is there an existing place to discuss *evidence/attestation quality* as a topic? I see Domain Discovery, Identity, Tax and Card Acceptance, but nothing covering attestation — happy to help scope it if that's useful. Also happy to be corrected on any call: there's an open appeals process and I'd rather be wrong in public than right in private.

> **为什么这帖这么写**：① 先给数据不自我介绍（社区反感推销）；② 主动说"可被纠正"——这正是裁判位姿态，也是最容易建立信任的一句；③ 最后那句"没有 attestation 工作组、我愿意帮忙起"就是卡位的真实动作（见 `FOUNDATION_PLAYBOOK.md`）。

---

## 发完之后

- 任一封回信 → 按 `FIRST_REVENUE.md` 推进报价；
- Slack 有人回应 attestation 议题 → 进入 `FOUNDATION_PLAYBOOK.md` 第 4–5 步（抢建议题、成为默认发言人）；
- **Circle Grants**：申请书已就绪，只需补 §10 团队段即可提交（链接用上面的公开链接）。

> 判断进展的单位是**"发出几封、提交几份"**，不是"写了几份"。
