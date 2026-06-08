"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface Stats {
  totalBounties: number;
  totalFindings: number;
  totalEthLocked: string;
}

export default function LandingPage() {
  const [stats, setStats] = useState<Stats>({ totalBounties: 0, totalFindings: 0, totalEthLocked: "0.00" });

  useEffect(() => {
    async function fetchStats() {
      try {
        const [bountiesRes, findingsRes] = await Promise.all([
          fetch(`${API_URL}/bounties`),
          fetch(`${API_URL}/findings`),
        ]);
        const bounties = await bountiesRes.json();
        const findings = await findingsRes.json();
        const totalEth = (bounties as any[])
          .reduce((sum: number, b: any) => sum + parseFloat(b.rewardAmount || "0"), 0)
          .toFixed(2);
        setStats({
          totalBounties: bounties.length,
          totalFindings: findings.length,
          totalEthLocked: totalEth,
        });
      } catch {
        // server not running — keep zeros
      }
    }
    fetchStats();
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans">

      {/* Nav */}
      <nav className="border-b border-zinc-800/60 bg-zinc-950/80 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-linear-to-br from-cyan-500 to-purple-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <span className="font-bold text-lg bg-linear-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">ARES</span>
          </div>
          <div className="flex items-center gap-4">
            <a href="https://github.com" className="text-sm text-zinc-400 hover:text-zinc-200 transition-colors">GitHub</a>
            <Link
              href="/dashboard"
              className="bg-cyan-500 text-black text-sm font-semibold px-4 py-2 rounded-lg hover:bg-cyan-400 transition-colors"
            >
              Launch App
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 bg-linear-to-br from-cyan-500/5 via-transparent to-purple-500/5 pointer-events-none" />
        <div className="absolute top-20 left-1/4 w-96 h-96 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-purple-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-7xl mx-auto px-6 pt-24 pb-20 text-center relative">
          <div className="inline-flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-full px-4 py-1.5 text-xs text-zinc-400 font-mono mb-8">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Live on Mantle Sepolia Testnet
          </div>

          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-bold tracking-tight mb-6 leading-tight">
            <span className="bg-linear-to-r from-cyan-400 via-cyan-300 to-purple-400 bg-clip-text text-transparent">
              Autonomous
            </span>
            <br />
            Bug Bounty Hunter
          </h1>

          <p className="text-lg sm:text-xl text-zinc-400 max-w-2xl mx-auto mb-10 leading-relaxed">
            Ares is an AI agent that continuously audits smart contracts, generates
            proof-of-concept exploits, and submits verified findings on-chain — autonomously.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/dashboard"
              className="bg-linear-to-r from-cyan-500 to-purple-600 text-white font-semibold px-8 py-3.5 rounded-xl hover:from-cyan-400 hover:to-purple-500 transition-all hover:shadow-lg hover:shadow-cyan-500/20 text-base"
            >
              Open Dashboard
            </Link>
            <a
              href="https://github.com"
              className="bg-zinc-900 border border-zinc-800 text-zinc-300 font-semibold px-8 py-3.5 rounded-xl hover:border-zinc-700 hover:text-zinc-100 transition-all text-base"
            >
              View Source
            </a>
          </div>

          {/* Live stats bar */}
          <div className="mt-16 grid grid-cols-3 gap-4 max-w-lg mx-auto">
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4">
              <div className="text-2xl font-bold text-cyan-400">{stats.totalBounties}</div>
              <div className="text-xs text-zinc-500 mt-1">Active Bounties</div>
            </div>
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4">
              <div className="text-2xl font-bold text-rose-400">{stats.totalFindings}</div>
              <div className="text-xs text-zinc-500 mt-1">Findings</div>
            </div>
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4">
              <div className="text-2xl font-bold text-emerald-400">{stats.totalEthLocked}</div>
              <div className="text-xs text-zinc-500 mt-1">ETH Locked</div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="max-w-7xl mx-auto px-6 py-20 border-t border-zinc-900">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold mb-3">How It Works</h2>
          <p className="text-zinc-400">Three steps from bounty creation to payout</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              step: "01",
              title: "Create a Bounty",
              desc: "Protocol owners fund an escrow contract with ETH, set a target contract address, reward amount, and severity threshold.",
              icon: (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ),
              color: "cyan",
            },
            {
              step: "02",
              title: "Ares Audits",
              desc: "On BountyCreated, Ares fetches the contract source via Mantlescan, runs Slither static analysis + Claude RAG reasoning, and decompiles unverified bytecode with Heimdall.",
              icon: (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                </svg>
              ),
              color: "purple",
            },
            {
              step: "03",
              title: "PoC & Payout",
              desc: "Vulnerabilities are encoded as ABI-encoded PoC payloads and submitted on-chain. The escrow oracle auto-verifies the finding and releases the ETH reward.",
              icon: (
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ),
              color: "emerald",
            },
          ].map((item) => (
            <div key={item.step} className="bg-zinc-900/40 border border-zinc-800 rounded-2xl p-6 relative overflow-hidden group hover:border-zinc-700 transition-all">
              <div className={`absolute top-0 right-0 text-7xl font-black opacity-5 leading-none pr-4 pt-2 text-${item.color}-400`}>
                {item.step}
              </div>
              <div className={`h-11 w-11 rounded-xl bg-${item.color}-500/10 border border-${item.color}-500/20 flex items-center justify-center text-${item.color}-400 mb-4`}>
                {item.icon}
              </div>
              <h3 className="font-semibold text-zinc-100 mb-2">{item.title}</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section className="max-w-7xl mx-auto px-6 py-20 border-t border-zinc-900">
        <div className="text-center mb-14">
          <h2 className="text-3xl font-bold mb-3">Built for the Real World</h2>
          <p className="text-zinc-400">Enterprise-grade analysis tools, fully automated</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { title: "Slither Static Analysis", desc: "Industry-standard detector suite finds reentrancy, access control issues, and 80+ vulnerability patterns." },
            { title: "Claude RAG Reasoning", desc: "LLM augmented with 10,000+ real audit findings from Solodit, Sherlock, and public GitHub reports." },
            { title: "Heimdall Decompiler", desc: "Unverified bytecode is decompiled to pseudo-Solidity before analysis — Ares isn't blind to closed-source contracts." },
            { title: "On-chain Reputation", desc: "Every verified finding earns REP on the ReputationLedger contract. False positives cost reputation." },
          ].map((f) => (
            <div key={f.title} className="bg-zinc-900/30 border border-zinc-800/60 rounded-xl p-5 hover:border-zinc-700 transition-all">
              <div className="h-1.5 w-8 bg-linear-to-r from-cyan-500 to-purple-500 rounded-full mb-4" />
              <h4 className="font-semibold text-zinc-100 mb-2 text-sm">{f.title}</h4>
              <p className="text-xs text-zinc-500 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="max-w-7xl mx-auto px-6 py-20 border-t border-zinc-900">
        <div className="bg-linear-to-br from-zinc-900 to-zinc-950 border border-zinc-800 rounded-3xl p-12 text-center relative overflow-hidden">
          <div className="absolute inset-0 bg-linear-to-br from-cyan-500/5 to-purple-500/5 pointer-events-none" />
          <h2 className="text-3xl font-bold mb-4 relative">Ready to deploy a bounty?</h2>
          <p className="text-zinc-400 mb-8 relative">Ares will start auditing the moment your bounty is live on-chain.</p>
          <Link
            href="/dashboard"
            className="relative bg-linear-to-r from-cyan-500 to-purple-600 text-white font-semibold px-10 py-4 rounded-xl hover:from-cyan-400 hover:to-purple-500 transition-all hover:shadow-lg hover:shadow-cyan-500/20 text-base inline-block"
          >
            Open Dashboard →
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-900 py-8">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-zinc-600 font-mono">
          <span>© 2026 Ares Protocol — Autonomous Bug Bounty Hunter</span>
          <span>Deployed on Mantle Sepolia · Built with NestJS, FastAPI &amp; Claude</span>
        </div>
      </footer>

    </div>
  );
}
