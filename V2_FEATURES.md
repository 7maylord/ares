# Ares V2 — Feature Roadmap

Planned features, ranked by effort-to-value. Each section is scoped so it can be picked up as an independent unit of work.

---

## 1. Internal CI (half a day)

**What:** GitHub Actions workflow for this repo. No `.github/` exists today despite three idle test suites.

**Build:**
- One workflow, three jobs:
  - `forge test` in `contracts/` (Foundry tests, 100% coverage already)
  - `npm test` in `server/` (Jest specs)
  - `pytest` in `analyzer/` (skip RAG/LLM tests or mock them — no API keys in CI)
- Trigger on push + PR to `main`.

**Skip:** deploy pipelines — Vercel auto-deploys `client/`, Render runs `analyzer/`.

---

## 2. Aderyn Integration (a day)

**What:** Add Cyfrin's Aderyn as a third analysis pass alongside Slither and LLM RAG.

**Build:**
- `analyzer/analyzers/aderyn_runner.py` mirroring `slither_runner.py` (~80 lines):
  - Shell out to `aderyn --output report.json`
  - Map Aderyn's findings into the existing finding schema (detector, severity, location, description)
- Merge into the existing dedupe step in `analyzer/main.py`.
- Add `aderyn` binary to the analyzer Docker image / Render build.

**Why:** Aderyn's detector set differs from Slither's — real signal boost, and "three independent analyses" strengthens the pitch.

---

## 3. Gas Report (rides along with #1 and #2)

Two separate things, both cheap:

**a. For our own contracts (zero code):**
- Add `forge test --gas-report` as a CI step in the workflow from #1.
- Later: gas-diff PR comments if contract work becomes frequent.

**b. As a product feature (categorization change, not a new analyzer):**
- Slither ships optimization detectors; Aderyn reports gas issues. Stop filtering them out.
- Surface them as a separate "Gas / Optimization" section in the finding report (analyzer response + client dashboard rendering).

---

## 4. CI/CD Audit Product — GitHub Action (the big V2 feature)

**What:** Users drop an Ares action into their repo; every push/PR gets an automated smart contract audit with findings as PR annotations and a severity-based merge gate.

**Target UX:**

```yaml
# .github/workflows/ares.yml in the user's repo
- uses: ares-x/audit-action@v1
  with:
    api-key: ${{ secrets.ARES_API_KEY }}
    contracts: src/
    fail-on: high        # block merge on high/critical findings
```

**Key insight:** `POST /analyze` already accepts raw Solidity source directly — no blockchain, bounty, or Mantlescan fetch needed. The CI product is a thin shell around the existing analyzer.

**Build order:**

1. **API-key auth on the audit endpoint** (the only real backend work)
   - `audit.controller.ts` is currently gated on a 2 MNT payment tx — doesn't fit CI cadence.
   - Add: API key entity, NestJS guard, per-key rate limits.
   - Keep the MNT payment path for one-off audits; API keys are a parallel path, not a replacement.

2. **The GitHub Action** (~150 lines, separate repo `ares-x/audit-action`)
   - Composite action: glob `.sol` files → POST to Ares API → write response as **SARIF** → exit non-zero above severity gate.
   - SARIF is load-bearing: GitHub renders it natively in the Security tab and as inline PR annotations — zero UI work.

3. **`--fail-on` severity gate**
   - Trivial to implement; it's what turns a report into a merge gate, and gates are what teams pay for.

**Cost control (decide early):**
- LLM+RAG pass costs Claude tokens per run; CI runs are frequent.
- Default: Slither + Aderyn only (fast, free) on every push; full LLM analysis only on PRs, or gated by `paths:` filter on the contracts dir.
- Make analysis tier a request parameter (`tier: static | full`).

**Monetization note:** this forks the identity — on-chain MNT for bounties vs. API keys/subscription for CI. Both share the same analyzer core; don't force crypto payments into CI workflows.

**Skip for MVP:** full GitHub App (check runs, webhooks, org-wide install). The marketplace Action is 90% of the UX for 10% of the work.

---

## 5. CLI Tooling (build after #4, shares its core)

**What:** `ares audit <path-or-address>` — create audit → poll status → print findings.

**Approach:**
- The GitHub Action *is* a CLI invoked by CI. Build one script ("scan dir → call API → format output") with two entry points: the Action and an `npx`-runnable CLI.
- Lazy first step: a documented `curl` + `cast send` snippet in the README.
- A real published `ares` CLI package only if users ask for it.

---

## 6. PoC Verification (multi-day — the credibility feature)

**What:** Close the "agent grades its own homework" gap. `BountyEscrow` currently auto-verifies findings submitted by the agent itself.

**Build:**
- Generate a Foundry test from the finding's `pocData` / PoC sketch.
- Run it sandboxed against a fork of the target chain (`forge test --fork-url`).
- Only call `escrow.verify()` if the exploit actually executes; otherwise reject and feed back into the RAG loop.

**Why:** this is the difference between "scanner that pays itself" and "autonomous auditor." Biggest lift on this list, biggest change to what the product is. First thing a skeptical judge/investor will poke at.

---

## Suggested Order

1. Internal CI (#1) — smallest diff, fastest payoff
2. Aderyn (#2) + gas surfacing (#3) — ride together
3. GitHub Action product (#4) — API keys → Action → severity gate
4. PoC verification (#6)
5. CLI (#5) — only if demand shows up
