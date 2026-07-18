# Ares Frontend Redesign — "The War Room of an Oracle"

A groundbreaking visual overhaul of the Ares client. Ships one bold idea — Ares as a
war machine running a campaign — executed with discipline across landing, dashboard,
and findings. All current data, wiring, and interactions are preserved; this is a
re-skin + two signature components + reframed copy, **not** a logic rewrite.

Constraints: Next.js 16 (read `node_modules/next/dist/docs/` before coding — breaking
changes vs. training data), Tailwind v4 (`@theme inline` tokens in globals.css),
React 19, Privy + wagmi wiring stays untouched.

---

## 1. The Thesis

Ares is the Greek god of war. The current site says so and then looks like every other
crypto dashboard. The redesign makes the metaphor real and *functional*:

- Vulnerable contracts are **targets** on a live campaign map.
- The audit pipeline is a **kill-chain**: Sight → Judgment → Strike → Spoils.
- Verified findings are **conquests**, logged in bronze that oxidizes to verdigris.
- The agent **hunts** — expressed through a reticle cursor that locks onto targets.

The theme lives in **materials, structure, and motion** — never in clip-art. No cartoon
helmets, no togas. The only figurative nods are the reticle cursor and a single
restrained aegis/laurel motif in the wordmark. Everything else is disciplined
typography, bronze hairlines, and the real data.

---

## 2. Design Tokens

### Palette — warm forge, not cool crypto

Replace cyan/purple (the generic crypto default) with war-god materials. The three
accents form an **earned semantic system**, not decoration:

| Token | Hex | Meaning |
|-------|-----|---------|
| `--ash` (bg) | `#0C0A08` | warm obsidian — a forge, not a screen. Replaces cool `#09090b` |
| `--iron` | `#1A1713` | raised surfaces / panels |
| `--steel` | `#3A3733` | borders, structure, hairlines |
| `--bone` | `#EDE6D6` | carved text, marble |
| `--bronze` | `#C8A24B` | **the agent / active / primary** |
| `--bronze-deep` | `#8A6B2E` | bronze at rest, muted labels |
| `--blood` | `#D6402F` | **vulnerability / critical / strike** (earned, not accent-for-accent) |
| `--verdigris` | `#4A9E86` | **verified / secured / paid** — bronze oxidized = target neutralized |

Severity already maps to color in the data. We re-ground those mappings in the metaphor:
Critical/High → blood scale, Medium → bronze, verified/payout → verdigris. Same data,
truthful color.

### Type — carved + machine, no Geist defaults

Current pairing is Geist Sans + Geist Mono — literally Vercel's default. Replace with:

- **Display: Cinzel** (Google, self-hosted via `next/font`) — inscriptional Roman
  capitals, lettering carved in stone. The monuments, verdicts, hero. Used with
  restraint, uppercase, wide tracking.
- **Machine: IBM Plex Mono** — the oracle/terminal/data layer, labels, addresses,
  the war log. Engineered, humanist.
- **Body: IBM Plex Sans** — pairs natively with Plex Mono, cohesive, not a default.

Type scale is monumental at the top (hero Cinzel `clamp(3rem, 8vw, 7rem)`) and quiet
everywhere else — boldness spent once.

### Structure is information

The page is a **campaign dossier**. A persistent left **campaign spine** (bronze
scroll-progress rail) tracks the kill-chain phase as you descend. Phase markers
(I. SIGHT / II. JUDGMENT / III. STRIKE / IV. SPOILS) are legitimate numbering — the
pipeline genuinely is an ordered sequence, so the markers encode something true.

---

## 3. Signature Elements (spend boldness here)

### A. The Reticle Cursor — "Ares hunts" (requested: cursor reaction)

A custom bronze targeting reticle replaces the pointer. Behavior:
- Free-floating crosshair that trails the pointer with slight easing.
- **Snaps and locks** onto interactive elements marked `[data-target]` (buttons,
  cards, nav) — reticle expands to frame the element, draws a faint aim-line, corner
  ticks appear. A quiet "lock" is the hunt made tactile.
- On click: a brief contraction pulse (the strike).
- One client component (`ReticleCursor`) mounted in root layout → covers all pages.
- **Fallbacks (non-negotiable):** normal cursor on touch devices and when
  `prefers-reduced-motion: reduce` is set. Keyboard focus is unaffected and stays
  fully visible.

### B. The Living War Map — hero signature (built from real data)

The hero is not a headline over a glow. It's a **live campaign map** rendered from the
actual `/bounties` and `/findings` data:
- A pulsing bronze core = the Ares agent, center.
- Each bounty = a target node placed around it; hunt-lines reach out from the core.
- Verified/secured targets glow verdigris; open vulnerabilities pulse blood-red.
- Node count, MNT locked, and findings are the real stats — rendered as map telemetry,
  not template stat-cards.
- Ignites node-by-node on load; static (pre-rendered positions) under reduced-motion.
- SVG + a little canvas for the lines; no new heavy deps.

These two reinforce one idea: a reticle that hunts across a war map. Everything else
stays quiet.

---

## 4. Motion (deliberate, reduced-motion-safe)

| Moment | Motion | Reduced-motion |
|--------|--------|----------------|
| Page load | Cinzel hero "struck/carved" reveal; war map ignites node-by-node | instant, static map |
| Cursor | reticle trail + lock-on | normal cursor |
| Scroll | campaign spine fills bronze; each phase reveals once | no fill anim, content visible |
| Verified finding | bronze→verdigris "conquest" stamp | static verdigris badge |
| Oracle dispatch (terminal) | typed war-log lines | full log shown |

All via CSS + IntersectionObserver where possible. Global
`@media (prefers-reduced-motion: reduce)` kill-switch.

---

## 5. Per-Surface Plan (every data point preserved)

### Landing — `app/page.tsx`
Reframe existing sections into the kill-chain, keep all data & interactions:
- **Hero** → Living War Map (stats: `totalBounties`, `totalFindings`, `totalEthLocked`).
- **Terminal simulator** (4 phases SCANNING/ALERT/EXPLOITING/SETTLED) → "The Oracle's
  Dispatch" war-log. Keep phase buttons, auto-rotation, manual override, code panels.
- **Audit loop** (6 steps) → the campaign kill-chain, tied to the spine. Keep all copy.
- **Calculator playground** → "Campaign Planner" (reward/profile → time/coverage/nodes).
  Keep all math and controls, restyle gauges as bronze/blood meters.
- **Feature grid** (Slither / Claude RAG / Heimdall / Reputation) → "The Arsenal".
  Keep mouse-follow glow, re-tint bronze.
- **CTA + footer** → "Open a Campaign". Keep links/data.

### Dashboard — `app/dashboard/page.tsx`
Re-skin only; **do not touch** fetch logic, 10s polling, wagmi/Privy, create-bounty
tx flow, wrong-network alert.
- 5-stat bar → "War Ledger" strip (bronze/verdigris/blood semantics).
- Tabs (overview/bounties/findings/leaderboard) → same tabs, carved labels.
- Run Ares panel → "Dispatch the Agent" (single/multi mode preserved).
- Escrow list + Live feed → "Targets" + "Campaign Log".
- Findings cards → "Spoils" with conquest stamps on verified.
- Reputation ledger → "Hall of Conquests".
- Create Bounty modal → "Fund a Campaign" (full tx flow untouched).

### Findings — `app/findings/[address]/page.tsx`
- Verdict dossier: each finding as a carved verdict card; severity bar in blood scale.
- Keep description / PoC / remediation / tx links / agent, verdigris VERIFIED stamp.

---

## 6. Build Phases

1. **Foundation** — new tokens + fonts in `globals.css` + `layout.tsx` (next/font:
   Cinzel, IBM Plex Sans/Mono). Reduced-motion kill-switch. *Verify: existing pages
   still render, no cyan/purple left in tokens.*
2. **Reticle cursor** — `ReticleCursor` component in layout, `[data-target]` on
   interactive els. *Verify: touch + reduced-motion fall back to normal cursor.*
3. **War map hero** — `WarMap` component wired to live stats. *Verify: renders with
   API down (zeros) and with data; static under reduced-motion.*
4. **Landing re-skin** — reframe remaining 5 sections + campaign spine.
5. **Dashboard re-skin** — restyle only; smoke-test create-bounty tx + polling.
6. **Findings re-skin** — verdict dossier.
7. **Pass** — mobile (reticle off), keyboard focus visible, Lighthouse, remove one
   accessory (Chanel check).

Reused as-is: all data fetching, wagmi/Privy, polling, tx flows, `logo.png`, routes.
New files: `components/ReticleCursor.tsx`, `components/WarMap.tsx`, spine helper.

---

## 7. Self-critique vs. AI defaults

- Not cluster 1 (cream/serif/terracotta), not cluster 2 (near-black + single acid
  accent — ours is *warm* black + a 3-color *earned* semantic system + inscriptional
  serif), not cluster 3 (broadsheet hairlines).
- Cyan/purple removal is the specific choice for *this* subject; it's the default we're
  escaping, not one we're keeping.
- Risk named: Cinzel + war theme can tip cheesy. Mitigation: theme lives in materials
  and structure, not imagery; keep the existing logo; no figurative war clip-art.
