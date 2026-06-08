# Ares Dashboard (Next.js)

The user-facing dashboard for the Ares autonomous bug bounty platform.

## Features

- **Connect wallet** — Privy wallet connection (injected or embedded wallet)
- **Create Bounty** — Submit an on-chain bounty transaction via `BountyPool.createBounty()`
- **Run Ares Agent** — Manually target a contract address for analysis
- **Bounty tracker** — Live status of all bounties (PENDING → ANALYZING → VULNERABLE/SECURE → SUBMITTED)
- **Findings log** — All submitted vulnerability findings with severity and tx hash
- **Event feed** — Real-time system event log

## Stack

- Next.js 15 (App Router)
- Tailwind CSS v4
- Privy (`@privy-io/react-auth` + `@privy-io/wagmi`) for wallet connection
- wagmi v2 + viem for on-chain writes
- Chain: Mantle Sepolia (chain ID 5003)

## Setup

```bash
cp .env.local.sample .env.local   # fill in values
pnpm install
pnpm run dev   # starts on port 3000
```

## Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_API_URL` | NestJS server URL (default: `http://localhost:3001`) |
| `NEXT_PUBLIC_POOL_ADDRESS` | Deployed `BountyPool` contract address |
| `NEXT_PUBLIC_PRIVY_APP_ID` | Privy app ID from [dashboard.privy.io](https://dashboard.privy.io) |
