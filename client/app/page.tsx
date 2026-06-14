"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState, useRef } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

interface Stats {
  totalBounties: number;
  totalFindings: number;
  totalEthLocked: string;
}

// Logs for simulated terminal
const SCANNING_LOGS = [
  "[Ares Agent v1.0.4] Daemon initialized successfully.",
  "[ChainWatcher] Monitoring new escrow bounty on Mantle Sepolia...",
  "[ChainWatcher] Detected Bounty ID #19 | Target: 0x71C...4b9e",
  "[Ares Scanner] Fetching target source code via Mantlescan...",
  "[Ares Scanner] Decompiling contract logic with Heimdall...",
  "[Ares Analyzer] Initializing Slither static analysis...",
  "[Ares Analyzer] Running 80+ standard detector modules..."
];

const ALERT_LOGS = [
  ...SCANNING_LOGS,
  "[Ares Analyzer] Slither scan complete. Found 2 warning indicators.",
  "[Claude RAG] Matching logic paths against Solodit templates...",
  "[!] CRITICAL WARNING: Potential Reentrancy vulnerability detected!",
  "[!] Location: contract Vault, function withdrawFunds(uint256)",
  "    Line 42: msg.sender.call{value: amount}(\"\");",
  "    Line 43: balances[msg.sender] -= amount;"
];

const EXPLOITING_LOGS = [
  ...ALERT_LOGS,
  "[Ares Exploiter] Synthesizing automated Forge exploit script...",
  "[Ares Exploiter] Writing PoC test module AttackVault.s.sol...",
  "[Ares Exploiter] Running local anvil fork testing suite...",
  "[Ares Exploiter] Execution output: SUCCESS. Balance drained.",
  "[Ares Exploiter] Compiling ABI-encoded PoC exploit payload..."
];

const SETTLED_LOGS = [
  ...EXPLOITING_LOGS,
  "[Ares Submitter] Submitting payload on-chain to BountyPool.sol...",
  "[Ares Submitter] Tx confirmed. Hash: 0xf5b2d7e0d37e...4a9e",
  "[Mantle Sepolia] Oracle auto-verification: PASSED.",
  "[Mantle Sepolia] Escrow reward (3.50 MNT) released to Ares Agent.",
  "[ReputationLedger] Agent score updated: +50 REP.",
  "[Ares Agent] Target secured. Listening for next block..."
];

export default function LandingPage() {
  const [stats, setStats] = useState<Stats>({ totalBounties: 0, totalFindings: 0, totalEthLocked: "0.00" });
  
  // Terminal simulator states
  const [simulatorPhase, setSimulatorPhase] = useState<"SCANNING" | "ALERT" | "EXPLOITING" | "SETTLED">("SCANNING");
  const [manualOverride, setManualOverride] = useState(false);
  const terminalBottomRef = useRef<HTMLDivElement>(null);

  // Playground calculator states
  const [targetAddress, setTargetAddress] = useState("0x71C2...4b9e");
  const [rewardAmount, setRewardAmount] = useState(2.5);
  const [auditProfile, setAuditProfile] = useState<"standard" | "deep" | "adversarial">("deep");

  // Mouse coordinate tracker for custom glow effects
  const gridContainerRef = useRef<HTMLDivElement>(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  useEffect(() => {
    async function fetchStats() {
      try {
        const [bountiesRes, findingsRes] = await Promise.all([
          fetch(`${API_URL}/bounties`),
          fetch(`${API_URL}/findings`),
        ]);
        const bounties = await bountiesRes.json();
        const findings = await findingsRes.json();
        interface RawBounty {
          rewardAmount?: string;
        }
        const totalEth = (bounties as RawBounty[])
          .reduce((sum: number, b) => sum + parseFloat(b.rewardAmount || "0"), 0)
          .toFixed(2);
        setStats({
          totalBounties: bounties.length,
          totalFindings: findings.length,
          totalEthLocked: totalEth,
        });
      } catch {
        // Server not running — keep zeros
      }
    }
    fetchStats();
  }, []);

  // Simulator loop
  useEffect(() => {
    if (manualOverride) return;
    const interval = setInterval(() => {
      setSimulatorPhase((prev) => {
        if (prev === "SCANNING") return "ALERT";
        if (prev === "ALERT") return "EXPLOITING";
        if (prev === "EXPLOITING") return "SETTLED";
        return "SCANNING";
      });
    }, 4500);
    return () => clearInterval(interval);
  }, [manualOverride]);

  // Autoscroll terminal
  useEffect(() => {
    if (terminalBottomRef.current) {
      terminalBottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [simulatorPhase]);

  // Track mouse for premium radial hover glows
  const handleMouseMove = (e: React.MouseEvent) => {
    if (gridContainerRef.current) {
      const rect = gridContainerRef.current.getBoundingClientRect();
      setMousePos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
  };

  // Calculations for playground
  const getPlaygroundMetrics = () => {
    const costValue = rewardAmount;
    
    let timeText = "30 mins";
    let coverage = "78%";
    let nodes = "1 Agent Node";
    let statusText = "Standard Scan";
    let statusColor = "text-cyan-400 border-cyan-500/20";
    let fillPercent = 78;

    if (auditProfile === "standard") {
      timeText = `${Math.max(15, Math.round(costValue * 10))} minutes`;
      coverage = `${Math.min(84, 72 + Math.round(costValue))} %`;
      nodes = "1 Node (Static)";
      statusText = "Fast Static Scan";
      statusColor = "text-cyan-400 border-cyan-500/20";
      fillPercent = 75;
    } else if (auditProfile === "deep") {
      timeText = `${Math.max(1, Math.round(costValue * 0.8))} hours`;
      coverage = `${Math.min(95, 88 + Math.round(costValue * 0.7))} %`;
      nodes = `${Math.min(4, 2 + Math.floor(costValue / 2))} Nodes (Fuzzing)`;
      statusText = "Deep Symbolic Fuzz";
      statusColor = "text-purple-400 border-purple-500/20";
      fillPercent = 90;
    } else {
      timeText = `${Math.max(4, Math.round(costValue * 2))} hours`;
      coverage = `${Math.min(99.9, 97.5 + (costValue * 0.2))} %`;
      nodes = "12 Nodes (Parallel Core)";
      statusText = "Adversarial Invariant Raid";
      statusColor = "text-rose-400 border-rose-500/20";
      fillPercent = 99;
    }

    return { timeText, coverage, nodes, statusText, statusColor, fillPercent };
  };

  const playgroundMetrics = getPlaygroundMetrics();

  // Get terminal logs list for active phase
  const getActiveLogs = () => {
    switch (simulatorPhase) {
      case "SCANNING": return SCANNING_LOGS;
      case "ALERT": return ALERT_LOGS;
      case "EXPLOITING": return EXPLOITING_LOGS;
      case "SETTLED": return SETTLED_LOGS;
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-cyan-500 selection:text-black overflow-x-hidden relative">
      
      {/* Background Gradients & Grid */}
      <div className="absolute inset-0 grid-bg pointer-events-none opacity-40 z-0" />
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-cyan-500/5 rounded-full blur-[140px] pointer-events-none animate-pulse-glow z-0" />
      <div className="absolute bottom-[20%] right-[-10%] w-[60%] h-[60%] bg-purple-500/5 rounded-full blur-[160px] pointer-events-none animate-pulse-glow z-0" />

      {/* Nav */}
      <nav className="border-b border-zinc-900 bg-zinc-950/70 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="Ares Logo" width={40} height={40} className="rounded-xl object-cover shadow-lg shadow-cyan-500/20" />
            <div>
              <span className="font-bold text-xl tracking-tight bg-linear-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">ARES</span>
              <span className="text-[10px] block text-zinc-500 font-mono tracking-wider uppercase">Autonomous Auditor</span>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <a href="https://github.com" target="_blank" rel="noreferrer" className="text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors">GitHub</a>
            <Link
              href="/dashboard"
              className="relative group overflow-hidden bg-zinc-900 border border-zinc-800 text-sm font-semibold px-5 py-2.5 rounded-xl hover:border-zinc-700 transition-all text-zinc-200"
            >
              <span className="absolute inset-0 w-full h-full bg-linear-to-r from-cyan-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              Launch App
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative z-10 max-w-7xl mx-auto px-6 pt-24 pb-20 text-center">
        <div className="inline-flex items-center gap-2 bg-zinc-900/80 border border-zinc-800/80 backdrop-blur-md rounded-full px-5 py-2 text-xs text-zinc-300 font-mono mb-8 animate-float shadow-inner">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_8px_#10b981]" />
          Live on Mantle Sepolia Testnet
        </div>

        <h1 className="text-5xl sm:text-7xl lg:text-8xl font-black tracking-tight mb-8 leading-[1.1]">
          <span className="bg-linear-to-r from-cyan-400 via-cyan-200 to-purple-400 bg-clip-text text-transparent">
            Autonomous
          </span>
          <br />
          <span className="text-white">Bug Bounty Hunter</span>
        </h1>

        <p className="text-lg sm:text-xl text-zinc-400 max-w-3xl mx-auto mb-12 leading-relaxed">
          Ares is an AI-agent swarm that continuously monitors, audits, decompiles, and creates verified zero-day exploit proofs on smart contracts — settling rewards instantly.
        </p>

        <div className="flex flex-col sm:flex-row gap-5 justify-center mb-24">
          <Link
            href="/dashboard"
            className="bg-linear-to-r from-cyan-500 to-purple-600 text-zinc-950 font-bold px-10 py-4.5 rounded-xl hover:from-cyan-400 hover:to-purple-500 transition-all hover:scale-[1.02] shadow-xl shadow-cyan-500/15 text-base"
          >
            Launch Dashboard
          </Link>
          <a
            href="https://github.com"
            className="bg-zinc-900/60 border border-zinc-800 text-zinc-300 font-semibold px-10 py-4.5 rounded-xl hover:border-zinc-700 hover:text-zinc-100 transition-all hover:bg-zinc-900/90 text-base"
          >
            View Source Code
          </a>
        </div>

        {/* Live stats dashboard cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          <div className="glass-panel rounded-2xl p-6 relative overflow-hidden group hover:border-cyan-500/35 transition-all shadow-[0_4px_30px_rgba(0,0,0,0.4)]">
            <div className="absolute top-0 right-0 w-24 h-24 bg-cyan-500/5 rounded-full blur-2xl pointer-events-none group-hover:bg-cyan-500/10 transition-all" />
            <div className="text-4xl font-extrabold text-cyan-400 font-mono tracking-tight">{stats.totalBounties}</div>
            <div className="text-xs text-zinc-500 uppercase tracking-widest font-mono font-bold mt-2">Active Bounty Vaults</div>
          </div>
          <div className="glass-panel rounded-2xl p-6 relative overflow-hidden group hover:border-rose-500/35 transition-all shadow-[0_4px_30px_rgba(0,0,0,0.4)]">
            <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 rounded-full blur-2xl pointer-events-none group-hover:bg-rose-500/10 transition-all" />
            <div className="text-4xl font-extrabold text-rose-400 font-mono tracking-tight">{stats.totalFindings}</div>
            <div className="text-xs text-zinc-500 uppercase tracking-widest font-mono font-bold mt-2">Verified Vulnerabilities</div>
          </div>
          <div className="glass-panel rounded-2xl p-6 relative overflow-hidden group hover:border-emerald-500/35 transition-all shadow-[0_4px_30px_rgba(0,0,0,0.4)]">
            <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl pointer-events-none group-hover:bg-emerald-500/10 transition-all" />
            <div className="text-4xl font-extrabold text-emerald-400 font-mono tracking-tight">{stats.totalEthLocked} MNT</div>
            <div className="text-xs text-zinc-500 uppercase tracking-widest font-mono font-bold mt-2">ETH Value Secured</div>
          </div>
        </div>
      </section>

      {/* Simulator Section (Change 2) */}
      <section className="relative z-10 max-w-7xl mx-auto px-6 py-20 border-t border-zinc-900/60">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-5 space-y-6">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-mono rounded-lg">
              Live Auditing Feed
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight leading-tight text-white">
              Watch Ares Audit in Real Time
            </h2>
            <p className="text-zinc-400 leading-relaxed">
              Every on-chain contract submission registers as a target. Ares immediately downloads, parses, and begins analyzing code, generating automated exploits to claim locked awards.
            </p>

            <div className="space-y-3.5 pt-4">
              {([
                { phase: "SCANNING", label: "01. Bytecode Scan & Decompilation" },
                { phase: "ALERT", label: "02. Claude RAG & Path Reasoning" },
                { phase: "EXPLOITING", label: "03. Automated PoC Exploit Drafting" },
                { phase: "SETTLED", label: "04. On-chain Payout Settlement" }
              ] as const).map((step) => (
                <button
                  key={step.phase}
                  onClick={() => { setSimulatorPhase(step.phase); setManualOverride(true); }}
                  className={`w-full flex items-center justify-between p-3.5 rounded-xl border text-left text-sm font-medium transition-all cursor-pointer ${
                    simulatorPhase === step.phase
                      ? "bg-purple-950/20 border-purple-500/50 text-white shadow-[0_0_15px_-3px_rgba(168,85,247,0.2)]"
                      : "bg-zinc-900/30 border-zinc-800/60 text-zinc-500 hover:text-zinc-300 hover:border-zinc-800"
                  }`}
                >
                  <span>{step.label}</span>
                  {simulatorPhase === step.phase && (
                    <span className="h-2 w-2 rounded-full bg-purple-400 animate-ping" />
                  )}
                </button>
              ))}
              {manualOverride && (
                <button
                  onClick={() => setManualOverride(false)}
                  className="text-xs text-zinc-500 hover:text-zinc-400 underline pl-1 pt-1 font-mono transition-colors cursor-pointer"
                >
                  Resume auto-rotation cycle
                </button>
              )}
            </div>
          </div>

          <div className="lg:col-span-7">
            {/* Terminal Glass Box */}
            <div className="glass-panel rounded-2xl overflow-hidden border border-zinc-800/80 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
              {/* Window Bar */}
              <div className="bg-zinc-950/80 border-b border-zinc-900 px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-3.5 w-3.5 rounded-full bg-rose-500/80" />
                  <div className="h-3.5 w-3.5 rounded-full bg-amber-500/80" />
                  <div className="h-3.5 w-3.5 rounded-full bg-emerald-500/80" />
                  <span className="text-xs font-mono text-zinc-500 ml-3">ares_agent_daemon_v1.0.4.sh</span>
                </div>
                <div className="flex gap-2">
                  <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-semibold border ${
                    simulatorPhase === "SCANNING" ? "bg-cyan-500/10 text-cyan-400 border-cyan-500/20"
                    : simulatorPhase === "ALERT" ? "bg-rose-500/10 text-rose-400 border-rose-500/20"
                    : simulatorPhase === "EXPLOITING" ? "bg-purple-500/10 text-purple-400 border-purple-500/20"
                    : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                  }`}>
                    {simulatorPhase}
                  </span>
                </div>
              </div>

              {/* Window Body */}
              <div className="bg-zinc-950/50 p-6 min-h-[320px] max-h-[320px] overflow-y-auto font-mono text-xs text-zinc-400 custom-scrollbar flex flex-col justify-between relative">
                {/* Scanline laser animation */}
                {simulatorPhase === "SCANNING" && (
                  <div className="absolute inset-x-0 h-0.5 bg-cyan-500/20 shadow-[0_0_10px_#06b6d4] animate-scan pointer-events-none" />
                )}

                <div className="space-y-2">
                  {getActiveLogs().map((log, index) => {
                    const isError = log.includes("[!]");
                    const isSuccess = log.includes("SUCCESS") || log.includes("released") || log.includes("PASSED");
                    return (
                      <div
                        key={index}
                        className={`leading-relaxed whitespace-pre-wrap ${
                          isError ? "text-rose-400 font-bold" : isSuccess ? "text-emerald-400 font-bold" : ""
                        }`}
                      >
                        {log}
                      </div>
                    );
                  })}
                  <div ref={terminalBottomRef} />
                </div>

                {/* Simulated Code Panel (Appears on specific states) */}
                {(simulatorPhase === "ALERT" || simulatorPhase === "EXPLOITING") && (
                  <div className="mt-4 pt-4 border-t border-zinc-800/80 bg-zinc-950/80 p-3 rounded-lg border border-zinc-800">
                    <div className="text-[10px] text-zinc-500 uppercase tracking-widest mb-1.5 font-bold">
                      {simulatorPhase === "ALERT" ? "VULNERABLE CODE SEGMENT DETECTED" : "SYNTHESIZED EXPLOIT CODE"}
                    </div>
                    <pre className="text-[11px] text-zinc-300 overflow-x-auto custom-scrollbar">
                      {simulatorPhase === "ALERT" ? (
                        <code className="text-zinc-400">
                          {`// Vault.sol - Line 41-44
function withdrawFunds(uint256 amount) public {
    require(balances[msg.sender] >= amount, "No balance");
    (bool success, ) = msg.sender.call{value: amount}(""); // [REENTRANCY]
    balances[msg.sender] -= amount;
}`}
                        </code>
                      ) : (
                        <code className="text-cyan-400">
                          {`// AttackVault.s.sol
contract AttackVault {
    fallback() external payable {
        if (address(target).balance >= 1 ether) {
            target.withdrawFunds(1 ether); // Loop exploit recursion
        }
    }
}`}
                        </code>
                      )}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* The Autonomous Loop Visual Flowchart (Change 4) */}
      <section className="relative z-10 max-w-7xl mx-auto px-6 py-20 border-t border-zinc-900/60">
        <div className="text-center mb-16">
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white mb-4">
            The Autonomous Audit Loop
          </h2>
          <p className="text-zinc-400 max-w-2xl mx-auto">
            From bounty deployment to zero-day confirmation, data flows securely on-chain.
          </p>
        </div>

        {/* Custom SVG animated flow chart layout */}
        <div className="relative">
          {/* Connecting SVG Path for lines */}
          <svg className="absolute inset-0 w-full h-full hidden lg:block pointer-events-none z-0">
            {/* Box 1 to 2 */}
            <path d="M 240, 110 L 390, 110" fill="none" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="2" />
            <path d="M 240, 110 L 390, 110" fill="none" stroke="url(#cyan-gradient)" strokeWidth="2" className="animate-svg-flow" />

            {/* Box 2 to 3 */}
            <path d="M 640, 110 L 780, 110" fill="none" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="2" />
            <path d="M 640, 110 L 780, 110" fill="none" stroke="url(#purple-gradient)" strokeWidth="2" className="animate-svg-flow" />

            {/* Box 3 to 4 */}
            <path d="M 1020, 110 H 1080 V 310 H 1020" fill="none" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="2" />
            <path d="M 1020, 110 H 1080 V 310 H 1020" fill="none" stroke="url(#purple-rose-gradient)" strokeWidth="2" className="animate-svg-flow" />

            {/* Box 4 to 5 */}
            <path d="M 780, 310 L 640, 310" fill="none" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="2" />
            <path d="M 780, 310 L 640, 310" fill="none" stroke="url(#rose-emerald-gradient)" strokeWidth="2" className="animate-svg-flow" />

            {/* Box 5 to 6 */}
            <path d="M 390, 310 L 240, 310" fill="none" stroke="rgba(255, 255, 255, 0.05)" strokeWidth="2" />
            <path d="M 390, 310 L 240, 310" fill="none" stroke="url(#emerald-cyan-gradient)" strokeWidth="2" className="animate-svg-flow" />

            <defs>
              <linearGradient id="cyan-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#06b6d4" />
                <stop offset="100%" stopColor="#a855f7" />
              </linearGradient>
              <linearGradient id="purple-gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#a855f7" />
                <stop offset="100%" stopColor="#ec4899" />
              </linearGradient>
              <linearGradient id="purple-rose-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#a855f7" />
                <stop offset="100%" stopColor="#f43f5e" />
              </linearGradient>
              <linearGradient id="rose-emerald-gradient" x1="100%" y1="0%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="#f43f5e" />
                <stop offset="100%" stopColor="#10b981" />
              </linearGradient>
              <linearGradient id="emerald-cyan-gradient" x1="100%" y1="0%" x2="0%" y2="0%">
                <stop offset="0%" stopColor="#10b981" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
            </defs>
          </svg>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8 relative z-10">
            
            {/* Step 1 */}
            <div className="glass-panel rounded-2xl p-6 relative group hover:border-cyan-500/40 transition-all">
              <div className="h-10 w-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center font-mono font-bold text-sm mb-4">
                01
              </div>
              <h3 className="font-semibold text-lg text-zinc-100 mb-2">Protocol Locks Escrow</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Protocol owners deposit MNT/ETH rewards into the `BountyPool` contract and submit their target code address.
              </p>
            </div>

            {/* Step 2 */}
            <div className="glass-panel rounded-2xl p-6 relative group hover:border-purple-500/40 transition-all">
              <div className="h-10 w-10 rounded-xl bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center font-mono font-bold text-sm mb-4">
                02
              </div>
              <h3 className="font-semibold text-lg text-zinc-100 mb-2">Agent Dispatch</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                The agent swarm receives the `BountyCreated` event logs and retrieves verified Solidity or raw contract bytecode.
              </p>
            </div>

            {/* Step 3 */}
            <div className="glass-panel rounded-2xl p-6 relative group hover:border-rose-500/40 transition-all">
              <div className="h-10 w-10 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center font-mono font-bold text-sm mb-4">
                03
              </div>
              <h3 className="font-semibold text-lg text-zinc-100 mb-2">Dynamic Auditing</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Ares triggers Slither static analysis and queries specialized vector models using RAG reasoning to map out vulnerable loops.
              </p>
            </div>

            {/* Step 4 */}
            <div className="glass-panel rounded-2xl p-6 relative group hover:border-rose-500/40 transition-all">
              <div className="h-10 w-10 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center font-mono font-bold text-sm mb-4">
                04
              </div>
              <h3 className="font-semibold text-lg text-zinc-100 mb-2">Forge Exploitation PoC</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Before on-chain submission, Ares tests candidates locally in an Anvil sandbox to confirm a successful exploit proof.
              </p>
            </div>

            {/* Step 5 */}
            <div className="glass-panel rounded-2xl p-6 relative group hover:border-emerald-500/40 transition-all">
              <div className="h-10 w-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center font-mono font-bold text-sm mb-4">
                05
              </div>
              <h3 className="font-semibold text-lg text-zinc-100 mb-2">On-Chain Verification</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Ares submits the ABI-encoded exploit script. The pool oracle runs it against a local fork. If valid, payout triggers.
              </p>
            </div>

            {/* Step 6 */}
            <div className="glass-panel rounded-2xl p-6 relative group hover:border-cyan-500/40 transition-all">
              <div className="h-10 w-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 flex items-center justify-center font-mono font-bold text-sm mb-4">
                06
              </div>
              <h3 className="font-semibold text-lg text-zinc-100 mb-2">Reputation Settlement</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Verified findings increase agent reputation score on the Reputation Ledger. Rejected claims decrease score.
              </p>
            </div>

          </div>
        </div>
      </section>

      {/* Interactive Bounty Configurator Playground (Change 3) */}
      <section className="relative z-10 max-w-7xl mx-auto px-6 py-20 border-t border-zinc-900/60">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          
          <div className="lg:col-span-5 space-y-6">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 text-xs font-mono rounded-lg">
              Interactive Playground
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white leading-tight">
              Ares Security Calculator
            </h2>
            <p className="text-zinc-400 leading-relaxed">
              Estimate the audit depth, coverage scope, and agent nodes required to run analysis on your contract depending on your bounty configuration.
            </p>
            
            {/* Input card controls */}
            <div className="glass-panel rounded-2xl p-5 space-y-5">
              <div>
                <label className="text-xs font-mono font-bold uppercase text-zinc-500 block mb-2">Target Contract</label>
                <input
                  type="text"
                  value={targetAddress}
                  onChange={(e) => setTargetAddress(e.target.value)}
                  placeholder="0x..."
                  className="w-full bg-zinc-950/80 border border-zinc-800 rounded-xl px-4.5 py-3 text-sm font-mono text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20 transition-all"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-2">
                  <label className="text-xs font-mono font-bold uppercase text-zinc-500">Bounty Reward</label>
                  <span className="text-sm font-mono font-extrabold text-cyan-400">{rewardAmount.toFixed(1)} MNT</span>
                </div>
                <input
                  type="range"
                  min="0.1"
                  max="10.0"
                  step="0.1"
                  value={rewardAmount}
                  onChange={(e) => setRewardAmount(parseFloat(e.target.value))}
                  className="w-full h-1.5 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-cyan-500"
                />
              </div>

              <div>
                <label className="text-xs font-mono font-bold uppercase text-zinc-500 block mb-2">Agent Intensity Profile</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { key: "standard", label: "Standard" },
                    { key: "deep", label: "Deep Fuzz" },
                    { key: "adversarial", label: "Raid Mode" }
                  ] as const).map((profile) => (
                    <button
                      key={profile.key}
                      onClick={() => setAuditProfile(profile.key)}
                      className={`py-2 px-3 rounded-lg border text-xs font-semibold text-center transition-all cursor-pointer ${
                        auditProfile === profile.key
                          ? "bg-cyan-500/10 border-cyan-500 text-cyan-300"
                          : "bg-zinc-950 border-zinc-850 text-zinc-500 hover:text-zinc-300 hover:border-zinc-850"
                      }`}
                    >
                      {profile.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Dynamic Result Gauge Cards */}
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-6">
            
            {/* Estimate 1: Time */}
            <div className="glass-panel rounded-2xl p-6 flex flex-col justify-between hover:border-cyan-500/20 transition-all">
              <span className="text-xs text-zinc-500 uppercase tracking-widest font-mono font-bold">Estimated Time</span>
              <div className="my-6">
                <span className="text-4xl font-black text-white font-mono">{playgroundMetrics.timeText}</span>
                <span className="text-[10px] block text-zinc-500 font-mono mt-1">To complete first pass</span>
              </div>
              <div className="w-full bg-zinc-900 rounded-full h-2">
                <div 
                  className="bg-cyan-400 h-2 rounded-full transition-all duration-500"
                  style={{ width: auditProfile === "standard" ? "30%" : auditProfile === "deep" ? "65%" : "95%" }}
                />
              </div>
            </div>

            {/* Estimate 2: Coverage */}
            <div className="glass-panel rounded-2xl p-6 flex flex-col justify-between hover:border-purple-500/20 transition-all">
              <span className="text-xs text-zinc-500 uppercase tracking-widest font-mono font-bold">Path Coverage</span>
              <div className="my-6">
                <span className="text-4xl font-black text-white font-mono">{playgroundMetrics.coverage}</span>
                <span className="text-[10px] block text-zinc-500 font-mono mt-1">Expected logical paths audited</span>
              </div>
              <div className="w-full bg-zinc-900 rounded-full h-2">
                <div 
                  className="bg-purple-400 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${playgroundMetrics.fillPercent}%` }}
                />
              </div>
            </div>

            {/* Estimate 3: Nodes */}
            <div className="glass-panel rounded-2xl p-6 flex flex-col justify-between hover:border-purple-500/20 transition-all">
              <span className="text-xs text-zinc-500 uppercase tracking-widest font-mono font-bold">Agent Power Allocation</span>
              <div className="my-6">
                <span className="text-2xl font-bold text-zinc-200 font-mono block">{playgroundMetrics.nodes}</span>
                <span className="text-[10px] block text-zinc-500 font-mono mt-1">Paralleled container audit units</span>
              </div>
              <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                <div 
                  className="bg-linear-to-r from-cyan-400 to-purple-500 h-full transition-all duration-500"
                  style={{ width: auditProfile === "standard" ? "15%" : auditProfile === "deep" ? "45%" : "100%" }}
                />
              </div>
            </div>

            {/* Estimate 4: Safety Tier Badge */}
            <div className="glass-panel border border-zinc-800/80 rounded-2xl p-6 flex flex-col justify-between hover:border-zinc-700 transition-all">
              <span className="text-xs text-zinc-500 uppercase tracking-widest font-mono font-bold">Audit Profile Level</span>
              <div className="my-6 flex items-center gap-3">
                <div className={`px-4 py-2 border rounded-xl font-mono text-sm font-extrabold ${playgroundMetrics.statusColor} bg-zinc-900/60`}>
                  {playgroundMetrics.statusText}
                </div>
              </div>
              <span className="text-[10px] text-zinc-500 font-mono">Intensity is directly proportional to reward depth</span>
            </div>

          </div>

        </div>
      </section>

      {/* Feature Grid with hover glowing cursor effect */}
      <section className="relative z-10 max-w-7xl mx-auto px-6 py-20 border-t border-zinc-900/60">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono rounded-lg mb-4">
            Security Toolchain
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            Built For The Modern Smart Contract
          </h2>
          <p className="text-zinc-400 max-w-2xl mx-auto mt-2">
            Ares combines industry standard tool suites, AI reasoning databases, and on-chain verification mechanisms.
          </p>
        </div>

        {/* Feature Grid Wrapper mapping mouse movements */}
        <div 
          ref={gridContainerRef}
          onMouseMove={handleMouseMove}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 relative"
        >
          {/* Radial Glow follow mouse */}
          <div 
            className="absolute w-[350px] h-[350px] bg-cyan-500/5 rounded-full blur-[100px] pointer-events-none transition-all duration-75 ease-out hidden lg:block"
            style={{
              left: `${mousePos.x - 175}px`,
              top: `${mousePos.y - 175}px`,
            }}
          />

          {[
            {
              title: "Slither Static Analysis",
              desc: "Deep security analysis engine executing 80+ audit pattern detections, including access controls and math over/underflows.",
              glow: "hover:border-cyan-500/30"
            },
            {
              title: "Claude RAG Reasoning",
              desc: "LLM specialized agents augmented with 10k+ public exploit scripts from Solodit, Code4rena, and Sherlock audits.",
              glow: "hover:border-purple-500/30"
            },
            {
              title: "Heimdall Decompiler",
              desc: "Closed source? Unverified? Ares automatically decompiles bytecode back to readable Solidity structure prior to scanning.",
              glow: "hover:border-rose-500/30"
            },
            {
              title: "Reputation Ledger",
              desc: "Autonomous auditing with accountability. Failed exploit submissions decrease reputation score. Higher score unlocks larger escrows.",
              glow: "hover:border-emerald-500/30"
            }
          ].map((f, i) => (
            <div 
              key={i} 
              className={`glass-panel rounded-2xl p-6 relative overflow-hidden group hover:bg-zinc-900/40 transition-all ${f.glow}`}
            >
              <div className="h-1 w-12 bg-linear-to-r from-cyan-400 to-purple-500 rounded-full mb-6" />
              <h3 className="font-bold text-zinc-100 mb-3 text-base">{f.title}</h3>
              <p className="text-sm text-zinc-400 leading-relaxed">{f.desc}</p>
            </div>
          ))}

        </div>
      </section>

      {/* CTA Escrow Glass Banner */}
      <section className="relative z-10 max-w-7xl mx-auto px-6 py-20 border-t border-zinc-900/60">
        <div className="relative rounded-3xl overflow-hidden glass-panel border border-zinc-800/80 p-12 lg:p-16 text-center">
          {/* Inner ambient glow */}
          <div className="absolute inset-0 bg-linear-to-br from-cyan-500/5 to-purple-500/5 z-0 pointer-events-none" />
          <div className="absolute top-1/2 left-1/2 translate-x-[-50%] translate-y-[-50%] w-[350px] h-[350px] bg-purple-500/10 rounded-full blur-[100px] pointer-events-none" />

          <div className="relative z-10 max-w-2xl mx-auto space-y-6">
            <h2 className="text-3xl sm:text-5xl font-black text-white tracking-tight">Ready to Audit Your Code?</h2>
            <p className="text-zinc-400 leading-relaxed">
              Lock your bounty rewards on-chain today. Ares starts verification audits the millisecond the transaction updates on-chain.
            </p>
            <div className="pt-6">
              <Link
                href="/dashboard"
                className="bg-linear-to-r from-cyan-500 to-purple-600 text-zinc-950 font-bold px-12 py-5 rounded-xl hover:from-cyan-400 hover:to-purple-500 hover:scale-[1.02] hover:shadow-lg hover:shadow-cyan-500/20 transition-all inline-block"
              >
                Go to Dashboard →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-zinc-900/80 py-12 relative z-10 bg-zinc-950/40">
        <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-6 text-xs text-zinc-500 font-mono">
          <div>
            <span>© 2026 Ares Protocol — Autonomous Bug Bounty Auditor.</span>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2 justify-center">
            <span>Deployed on Mantle Sepolia</span>
            <span>Built with NestJS, FastAPI &amp; Claude 3.5</span>
          </div>
        </div>
      </footer>

    </div>
  );
}
