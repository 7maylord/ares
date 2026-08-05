"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { AresMark } from "../components/AresMark";
import { useRouter } from "next/navigation";
import { useWriteContract, useWaitForTransactionReceipt, useChainId, useSwitchChain } from "wagmi";
import { usePrivy, useWallets } from "@privy-io/react-auth";
import { parseEther } from "viem";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
const POOL_ADDRESS = (process.env.NEXT_PUBLIC_POOL_ADDRESS || "0x9Bc25B223787Ce045e8B5C19A2547B3b1eBDA1D8") as `0x${string}`;

const BOUNTY_POOL_ABI = [
  {
    type: "function",
    name: "createBounty",
    inputs: [
      { name: "targetContract", type: "address" },
      { name: "rewardAmount", type: "uint256" },
      { name: "severityThreshold", type: "uint8" },
      { name: "deadline", type: "uint256" },
      { name: "whitelistedAgents", type: "address[]" },
    ],
    outputs: [{ name: "bountyId", type: "uint256" }],
    stateMutability: "payable",
  },
] as const;

const SEVERITY_OPTIONS = [
  { value: "0", label: "Low" },
  { value: "1", label: "Medium" },
  { value: "2", label: "High" },
  { value: "3", label: "Critical" },
];

interface Bounty {
  id: number;
  bountyId: number;
  targetContract: string;
  creator: string;
  rewardAmount: string;
  severityThreshold: string;
  deadline: string;
  active: boolean;
  status: "PENDING" | "ANALYZING" | "SECURE" | "INCONCLUSIVE" | "VULNERABLE" | "SUBMITTED" | "VERIFIED";
  scannedAt?: string;
  vulnerabilitiesFound?: number;
  createdAt: string;
}

interface Finding {
  id: number;
  findingId?: number;
  bountyId: number;
  targetContract: string;
  agent?: string;
  title?: string;
  severity: string;
  category?: string;
  description?: string;
  pocSketch?: string;
  remediation?: string;
  status: "Pending" | "Verified" | "Rejected";
  txHash?: string;
  payoutTxHash?: string;
  submittedAt: string;
}

interface EventLog {
  id: number;
  type: string;
  message: string;
  txHash?: string;
  timestamp: string;
}

export default function Dashboard() {
  const router = useRouter();
  // ── Data ──────────────────────────────────────────────────────────────────
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [logs, setLogs] = useState<EventLog[]>([]);
  const [agentStats, setAgentStats] = useState<{ address: string; reputationScore: number; successful: number; failed: number; total: number; balanceMnt: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "bounties" | "findings" | "leaderboard">("overview");

  const fetchAll = useCallback(async () => {
    try {
      const [bRes, fRes, eRes, aRes] = await Promise.all([
        fetch(`${API_URL}/bounties`),
        fetch(`${API_URL}/findings`),
        fetch(`${API_URL}/events`),
        fetch(`${API_URL}/agent`),
      ]);
      if (!bRes.ok || !fRes.ok || !eRes.ok) throw new Error("API error");
      const [b, f, e] = await Promise.all([bRes.json(), fRes.json(), eRes.json()]);
      setBounties(b);
      setFindings(f);
      setLogs(e);
      if (aRes.ok) setAgentStats(await aRes.json());
      setError(null);
    } catch {
      setError("Cannot reach the server. Make sure the NestJS server is running on port 3001.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchAll();
    }, 0);
    const interval = setInterval(fetchAll, 10_000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
  }, [fetchAll]);

  // ── Wallet ────────────────────────────────────────────────────────────────
  const { login, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const address = wallets[0]?.address;
  const isConnected = authenticated && !!address;

  const chainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const MANTLE_SEPOLIA_ID = 5003;
  const isWrongNetwork = isConnected && chainId !== MANTLE_SEPOLIA_ID;

  // ── Create Bounty ─────────────────────────────────────────────────────────
  const [showCreate, setShowCreate] = useState(false);
  const [createForm, setCreateForm] = useState({
    targetContract: "",
    rewardMnt: "1",
    severity: "2",
    deadlineDays: "30",
  });
  const {
    writeContract,
    data: createHash,
    isPending: isCreating,
    reset: resetCreate,
    error: createError,
  } = useWriteContract();
  const { isLoading: isConfirming, isSuccess: isCreateSuccess } =
    useWaitForTransactionReceipt({ hash: createHash });

  useEffect(() => {
    if (isCreateSuccess) setTimeout(fetchAll, 4000);
  }, [isCreateSuccess, fetchAll]);

  function closeCreateModal() {
    setShowCreate(false);
    resetCreate();
    setCreateForm({ targetContract: "", rewardMnt: "1", severity: "2", deadlineDays: "30" });
  }

  function submitCreateBounty() {
    const rewardWei = parseEther(createForm.rewardMnt || "0");
    const deadline = BigInt(
      Math.floor(Date.now() / 1000) + Number(createForm.deadlineDays) * 86400
    );
    writeContract({
      address: POOL_ADDRESS,
      abi: BOUNTY_POOL_ABI,
      functionName: "createBounty",
      args: [
        createForm.targetContract as `0x${string}`,
        rewardWei,
        Number(createForm.severity),
        deadline,
        [],
      ],
      value: rewardWei,
    });
  }

  // ── Manual Analysis Trigger ───────────────────────────────────────────────
  const [triggerContract, setTriggerContract] = useState("");
  const [isTriggering, setIsTriggering] = useState(false);
  const [triggerDone, setTriggerDone] = useState(false);
  const [multiMode, setMultiMode] = useState(false);
  const [extraAddresses, setExtraAddresses] = useState("");

  async function runManualAnalysis() {
    if (!triggerContract.startsWith("0x")) return;
    setIsTriggering(true);
    setTriggerDone(false);
    try {
      if (multiMode) {
        const extras = extraAddresses.split("\n").map((s) => s.trim()).filter((s) => s.startsWith("0x"));
        await fetch(`${API_URL}/analysis/trigger-multi`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetContracts: [triggerContract, ...extras] }),
        });
      } else {
        await fetch(`${API_URL}/analysis/trigger`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetContract: triggerContract }),
        });
      }
      setTriggerContract("");
      setExtraAddresses("");
      setTriggerDone(true);
      setTimeout(fetchAll, 2000);
    } finally {
      setIsTriggering(false);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  const totalBountyVolume = bounties
    .reduce((sum, b) => sum + parseFloat(b.rewardAmount || "0"), 0)
    .toFixed(2);

  const totalPayouts = bounties
    .filter((b) => b.status === "VERIFIED")
    .reduce((sum, b) => sum + parseFloat(b.rewardAmount || "0"), 0)
    .toFixed(2);

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      VERIFIED:   "bg-verdigris-500/10 text-verdigris-400 border-verdigris-500/25",
      SECURE:     "bg-bronze-500/10 text-bronze-400 border-bronze-500/25",
      ANALYZING:  "bg-bronze-500/10 text-bronze-400 border-bronze-500/25",
      VULNERABLE: "bg-blood-500/10 text-blood-400 border-blood-500/25",
      SUBMITTED:  "bg-amber-500/10 text-amber-400 border-amber-500/25",
      INCONCLUSIVE: "bg-zinc-700/25 text-zinc-300 border-zinc-600/40",
      PENDING:    "bg-zinc-800 text-zinc-400 border-zinc-700",
    };
    return `text-[10px] px-2 py-0.5 rounded-full font-mono font-medium border ${map[status] ?? map.PENDING}`;
  };

  const eventBadge = (type: string) => {
    const map: Record<string, string> = {
      BountyCreated:      "bg-bronze-500/10 text-bronze-400 border-bronze-500/20",
      FindingSubmitted:   "bg-bronze-500/10 text-bronze-400 border-bronze-500/20",
      VerificationPassed: "bg-verdigris-500/10 text-verdigris-400 border-verdigris-500/20",
      VerificationFailed: "bg-blood-500/10 text-blood-400 border-blood-500/20",
      AnalysisStarted:    "bg-zinc-800 text-zinc-400 border-zinc-700",
    };
    return `px-2 py-0.5 rounded text-[9px] font-mono font-bold border ${map[type] ?? map.AnalysisStarted}`;
  };

  return (
    <div className="min-h-screen bg-ash text-bone font-plex flex flex-col selection:bg-bronze-500 selection:text-black overflow-x-hidden relative">
      
      {/* Background Gradients & Grid */}
      <div className="absolute inset-0 grid-bg pointer-events-none opacity-20 z-0" />
      <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-bronze-500/5 rounded-full blur-[140px] pointer-events-none animate-pulse-glow z-0" />
      <div className="absolute bottom-[20%] right-[-10%] w-[60%] h-[60%] bg-bronze-500/5 rounded-full blur-[160px] pointer-events-none animate-pulse-glow z-0" />

      <div className="relative z-10 flex flex-col grow">
        {/* Error notification header */}
        {error && (
          <div className="bg-blood-950/40 border-b border-blood-800/40 text-blood-300 text-xs py-2 px-6 font-mono text-center relative z-50">
            {error}
          </div>
        )}

        {/* Wrong network alert */}
        {isWrongNetwork && (
          <div className="bg-amber-950/40 border-b border-amber-700/40 text-amber-300 text-xs py-2 px-6 font-mono flex items-center justify-center gap-4 relative z-50">
            <span>⚠ Wrong network — Ares runs on Mantle Sepolia (chain 5003)</span>
            <button
              onClick={() => switchChain({ chainId: MANTLE_SEPOLIA_ID })}
              disabled={isSwitching}
              className="px-3 py-1 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-200 hover:bg-amber-500/30 transition-all disabled:opacity-50 cursor-pointer"
            >
              {isSwitching ? "Switching..." : "Switch Network"}
            </button>
          </div>
        )}

        {/* Header */}
        <header className="border-b border-zinc-900 bg-ash/70 backdrop-blur-xl sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3">
              <AresMark className="h-10 w-10 drop-shadow-[0_0_12px_rgba(200,162,75,0.25)]" />
              <div>
                <span className="carved font-extrabold text-xl tracking-[0.3em] text-bone block">ARES</span>
                <span className="text-[10px] block text-bronze-deep font-mono tracking-widest uppercase">Bug Bounty Hunter</span>
              </div>
            </Link>

            <div className="flex items-center gap-3">
              <div className="hidden md:flex items-center gap-2 bg-zinc-900/80 px-3.5 py-1.5 rounded-lg border border-zinc-800 text-xs">
                {loading
                  ? <><span className="h-2 w-2 rounded-full bg-zinc-650 animate-pulse" /><span className="text-zinc-500 font-mono">Connecting...</span></>
                  : <><span className="h-2 w-2 rounded-full bg-verdigris-500 animate-pulse shadow-[0_0_8px_#4a9e86]" /><span className="text-zinc-400 font-mono">Mantle Testnet · Live</span></>
                }
              </div>
              <button
                onClick={fetchAll}
                className="text-xs px-3 py-2 rounded-lg font-medium bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-all cursor-pointer"
              >
                Refresh
              </button>
              <button
                onClick={() => setShowCreate(true)}
                className="text-xs px-4 py-2 rounded-lg font-semibold bg-linear-to-r from-bronze-500 to-bronze-600 text-ash hover:from-bronze-400 hover:to-bronze-500 transition-all shadow-lg shadow-bronze-500/10 cursor-pointer"
              >
                + Create Bounty
              </button>
            </div>
          </div>
        </header>

        {/* Main Dashboard Workspace */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grow w-full flex flex-col gap-8">
          
          {/* Stats Bar Overhaul */}
          <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="glass-panel p-5 rounded-2xl flex flex-col gap-1 relative overflow-hidden group hover:border-bronze-500/20 transition-all">
              <div className="absolute top-0 right-0 w-16 h-16 bg-bronze-500/5 rounded-full blur-xl pointer-events-none group-hover:bg-bronze-500/10 transition-all" />
              <span className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider">Total Pool Locked</span>
              <span className="text-2xl font-bold text-bronze-400 font-mono">{totalBountyVolume} MNT</span>
              <span className="text-[10px] text-zinc-550 mt-1">Across active escrows</span>
            </div>
            <div className="glass-panel p-5 rounded-2xl flex flex-col gap-1 relative overflow-hidden group hover:border-verdigris-500/20 transition-all">
              <div className="absolute top-0 right-0 w-16 h-16 bg-verdigris-500/5 rounded-full blur-xl pointer-events-none group-hover:bg-verdigris-500/10 transition-all" />
              <span className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider">Payouts Disbursed</span>
              <span className="text-2xl font-bold text-verdigris-400 font-mono">{totalPayouts} MNT</span>
              <span className="text-[10px] text-zinc-550 mt-1">{agentStats?.successful ?? 0} verified finding(s)</span>
            </div>
            <div className="glass-panel p-5 rounded-2xl flex flex-col gap-1 relative overflow-hidden group hover:border-zinc-700 transition-all">
              <div className="absolute top-0 right-0 w-16 h-16 bg-zinc-500/5 rounded-full blur-xl pointer-events-none group-hover:bg-zinc-500/10 transition-all" />
              <span className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider">Monitored Targets</span>
              <span className="text-2xl font-bold text-zinc-100 font-mono">{bounties.length}</span>
              <span className="text-[10px] text-zinc-550 mt-1">{bounties.filter((b) => b.active).length} active escrows</span>
            </div>
            <div className="glass-panel p-5 rounded-2xl flex flex-col gap-1 relative overflow-hidden group hover:border-blood-500/20 transition-all">
              <div className="absolute top-0 right-0 w-16 h-16 bg-blood-500/5 rounded-full blur-xl pointer-events-none group-hover:bg-blood-500/10 transition-all" />
              <span className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider">Vulnerabilities</span>
              <span className="text-2xl font-bold text-blood-400 font-mono">{findings.length}</span>
              <span className="text-[10px] text-zinc-550 mt-1">{findings.filter((f) => f.status === "Verified").length} verified</span>
            </div>
            <div className="glass-panel p-5 rounded-2xl flex flex-col gap-1 col-span-2 lg:col-span-1 relative overflow-hidden group hover:border-bronze-500/20 transition-all">
              <div className="absolute top-0 right-0 w-16 h-16 bg-bronze-500/5 rounded-full blur-xl pointer-events-none group-hover:bg-bronze-500/10 transition-all" />
              <span className="text-zinc-500 text-[10px] font-mono uppercase tracking-wider">Agent Reputation</span>
              <span className="text-2xl font-bold text-bronze-400 font-mono">
                {agentStats?.reputationScore ?? "—"} REP
              </span>
              <span className="text-[10px] text-bronze-350/80 font-mono truncate block">{agentStats?.address ? `${agentStats.address.slice(0,10)}...` : "Ares Agent"}</span>
            </div>
          </section>

          {/* Navigation Tabs Overhaul */}
          <div className="flex border-b border-zinc-900 relative">
            <nav className="flex gap-6 relative z-10">
              {(["overview", "bounties", "findings", "leaderboard"] as const).map((tab) => (
                <button
                  key={tab}                  onClick={() => setActiveTab(tab)}
                  className={`pb-4 px-1 text-sm font-semibold border-b-2 transition-all cursor-pointer relative ${
                    activeTab === tab
                      ? "border-bronze-400 text-bronze-400 drop-shadow-[0_0_8px_rgba(6,182,212,0.3)]"
                      : "border-transparent text-zinc-500 hover:text-zinc-300 hover:border-zinc-800"
                  }`}
                >
                  {tab === "overview" ? "Overview" : tab === "leaderboard" ? "Reputation Ledger" : tab === "bounties" ? "Bounties & Escrows" : "Findings"}
                </button>
              ))}
            </nav>
          </div>

          {/* Overview Tab Content */}
          {activeTab === "overview" && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 flex flex-col gap-6">

                {/* Run Ares panel */}
                <div className="glass-panel rounded-2xl p-6 hover:border-bronze-500/20 transition-all duration-300">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-9 w-9 rounded-lg bg-bronze-500/10 border border-bronze-500/20 flex items-center justify-center">
                      <svg className="w-4 h-4 text-bronze-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <div>
                      <h2 className="text-sm font-bold text-zinc-100">Run Ares Agent</h2>
                      <p className="text-xs text-zinc-500">Manually target any contract for immediate analysis — no bounty required</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mb-3">
                    <button
                      onClick={() => { setMultiMode(false); setExtraAddresses(""); setTriggerDone(false); }}
                      className={`text-xs px-3 py-1 rounded-lg font-mono transition-all cursor-pointer ${!multiMode ? "bg-bronze-600 text-ash" : "bg-zinc-900 text-zinc-500 hover:text-zinc-300"}`}
                    >
                      Single contract
                    </button>
                    <button
                      onClick={() => { setMultiMode(true); setTriggerDone(false); }}
                      className={`text-xs px-3 py-1 rounded-lg font-mono transition-all cursor-pointer ${multiMode ? "bg-bronze-600 text-ash" : "bg-zinc-900 text-zinc-500 hover:text-zinc-300"}`}
                    >
                      Multi-contract
                    </button>
                  </div>
                  <div className="flex gap-3">
                    <input
                      type="text"
                      placeholder={multiMode ? "0x entry contract (Router / main)..." : "0x contract address..."}
                      value={triggerContract}
                      onChange={(e) => { setTriggerContract(e.target.value); setTriggerDone(false); }}
                      className="grow bg-ash/80 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm font-mono text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-bronze-500/60 focus:ring-1 focus:ring-bronze-500/20 transition-all"
                    />
                    <button
                      onClick={runManualAnalysis}
                      disabled={isTriggering || !triggerContract.startsWith("0x")}
                      className="px-5 py-2.5 rounded-xl font-bold text-sm bg-bronze-600 text-ash hover:bg-bronze-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0 cursor-pointer"
                    >
                      {isTriggering ? "Running..." : "▶ Run"}
                    </button>
                  </div>
                  {multiMode && (
                    <textarea
                      placeholder={"Additional contracts (one 0x address per line):\n0x Vault...\n0x Strategy..."}
                      value={extraAddresses}
                      onChange={(e) => { setExtraAddresses(e.target.value); setTriggerDone(false); }}
                      rows={3}
                      className="mt-2 w-full bg-ash/80 border border-zinc-800 rounded-xl px-4 py-2.5 text-sm font-mono text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-bronze-500/60 focus:ring-1 focus:ring-bronze-500/20 transition-all resize-none"
                    />
                  )}
                  {triggerDone && (
                    <p className="mt-2 text-xs text-verdigris-450 font-mono">
                      ✓ Analysis queued — results will appear in the feed below as they complete.
                    </p>
                  )}
                </div>

                {/* Escrow targets list */}
                <div className="glass-panel rounded-2xl p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h2 className="text-base font-bold text-zinc-100">Monitored Escrow Targets</h2>
                    <span className="text-[10px] text-zinc-500 font-mono bg-zinc-900/60 border border-zinc-800/80 px-2 py-0.5 rounded">auto-refreshes every 10s</span>
                  </div>
                  {loading ? (
                    <div className="py-12 text-center text-zinc-650 text-sm font-mono animate-pulse">Loading target registries...</div>
                  ) : bounties.length === 0 ? (
                    <div className="py-12 text-center text-zinc-550 text-sm">
                      No bounties found.{" "}
                      <button onClick={() => setShowCreate(true)} className="text-bronze-400 hover:underline font-semibold cursor-pointer">
                        Create escrow
                      </button>{" "}
                      or submit manual target above.
                    </div>
                  ) : (
                    <div className="divide-y divide-zinc-900">
                      {bounties.map((bounty) => (
                        <div key={bounty.id} className="py-4.5 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-2.5 flex-wrap">
                              <span className="text-sm font-bold text-zinc-200 font-mono">
                                {bounty.targetContract.substring(0, 10)}...{bounty.targetContract.substring(34)}
                              </span>
                              <span className={`${statusBadge(bounty.status)}${bounty.status === "ANALYZING" ? " animate-pulse" : ""}`}>
                                {bounty.status}
                              </span>
                            </div>
                            <div className="mt-1.5 text-[11px] text-zinc-500 flex flex-wrap gap-x-4 gap-y-1 font-mono">
                              {bounty.creator && <span>Creator: {bounty.creator.substring(0, 8)}...{bounty.creator.substring(36)}</span>}
                              {bounty.deadline && <span className="text-zinc-600">Deadline: {bounty.deadline}</span>}
                              {bounty.scannedAt && <span className="text-bronze-400/80">Scanned: {new Date(bounty.scannedAt).toLocaleTimeString()}</span>}
                            </div>
                          </div>
                          <div className="shrink-0 text-right flex sm:flex-col items-baseline sm:items-end justify-between sm:justify-start gap-2 sm:gap-0">
                            <span className="text-base font-extrabold text-bronze-300 font-mono">{bounty.rewardAmount} MNT</span>
                            <span className="text-[10px] text-zinc-550 font-mono uppercase block">Min: {bounty.severityThreshold}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Live Activity Feed sidebar */}
              <div className="glass-panel rounded-2xl p-6 flex flex-col h-full min-h-[460px]">
                <h2 className="text-base font-bold text-zinc-150 mb-5 flex items-center gap-2 shrink-0">
                  <svg className="w-4 h-4 text-bronze-400 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Live Activity Feed
                </h2>
                {loading ? (
                  <div className="grow flex items-center justify-center text-zinc-600 text-sm font-mono animate-pulse">Synchronizing feed...</div>
                ) : logs.length === 0 ? (
                  <div className="grow flex items-center justify-center text-zinc-550 text-sm text-center">
                    Listening for smart contract events. Logs will populate as transactions update.
                  </div>
                ) : (
                  <div className="grow overflow-y-auto space-y-3 pr-1.5 text-[11px] custom-scrollbar h-0 min-h-0">
                    {logs.map((log) => (
                      <div key={log.id} className="p-3 bg-ash/40 border border-zinc-900 rounded-xl flex flex-col gap-1.5 hover:border-zinc-800 transition-all">
                        <div className="flex items-center justify-between">
                          <span className={eventBadge(log.type)}>{log.type}</span>
                          <span className="text-[9px] text-zinc-650 font-mono">
                            {new Date(log.timestamp).toLocaleTimeString()}
                          </span>
                        </div>
                        <p className="text-zinc-350 leading-relaxed font-mono">{log.message}</p>
                        {log.txHash && (
                          <span className="text-[9px] text-zinc-600 font-mono truncate block">Tx: {log.txHash}</span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Bounties Register Tab */}
          {activeTab === "bounties" && (
            <div className="glass-panel rounded-2xl p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="carved uppercase tracking-wide text-lg font-bold text-bone">Bounty Escrows Register</h2>
                <button
                  onClick={() => setShowCreate(true)}
                  className="text-xs px-4 py-2 rounded-lg font-semibold bg-linear-to-r from-bronze-500 to-bronze-600 text-ash hover:from-bronze-400 hover:to-bronze-500 transition-all cursor-pointer"
                >
                  + Create Bounty
                </button>
              </div>
              {bounties.length === 0 ? (
                <p className="text-zinc-550 text-sm text-center py-12">No bounty records discovered in active storage.</p>
              ) : (
                <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-left text-sm text-zinc-300 border-collapse">
                    <thead>
                      <tr className="border-b border-zinc-900 text-zinc-550 font-mono text-[10px] uppercase tracking-wider">
                        <th className="py-3.5 px-4 font-bold">ID</th>
                        <th className="py-3.5 px-4 font-bold">Target Contract</th>
                        <th className="py-3.5 px-4 font-bold">Creator Address</th>
                        <th className="py-3.5 px-4 font-bold">Reward Pool</th>
                        <th className="py-3.5 px-4 font-bold">Min Severity</th>
                        <th className="py-3.5 px-4 font-bold">Deadline</th>
                        <th className="py-3.5 px-4 font-bold">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-900">
                      {bounties.map((b) => (
                        <tr key={b.id} className="hover:bg-zinc-900/10 transition-all font-mono text-xs">
                          <td className="py-4 px-4 text-zinc-450">#{b.bountyId}</td>
                          <td className="py-4 px-4 text-zinc-200">{b.targetContract}</td>
                          <td className="py-4 px-4 text-zinc-500">{b.creator?.substring(0, 12)}...{b.creator?.substring(32)}</td>
                          <td className="py-4 px-4 font-extrabold text-bronze-300">{b.rewardAmount} MNT</td>
                          <td className="py-4 px-4 text-zinc-400">{b.severityThreshold}</td>
                          <td className="py-4 px-4 text-zinc-450">{b.deadline}</td>
                          <td className="py-4 px-4"><span className={statusBadge(b.status)}>{b.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Findings Tab */}
          {activeTab === "findings" && (
            <div className="space-y-6">
              <h2 className="carved uppercase tracking-wide text-lg font-bold text-bone">Agent Vulnerability Findings</h2>
              {findings.length === 0 ? (
                <div className="glass-panel rounded-2xl p-12 text-center text-zinc-550">
                  No automated findings generated. Active vulnerabilities appear here once processed by Ares.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4">
                  {Object.values(
                    findings.reduce<Record<string, Finding[]>>((acc, f) => {
                      (acc[f.targetContract] ??= []).push(f);
                      return acc;
                    }, {})
                  ).map((group) => {
                    const severityRank: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1, Informational: 0 };
                    const top = group.reduce((a, b) => (severityRank[a.severity] ?? 0) >= (severityRank[b.severity] ?? 0) ? a : b);
                    const isCritical = top.severity === "Critical";
                    const isHigh = top.severity === "High";
                    const isVerified = group.some((f) => f.status === "Verified");
                    const isPending = group.every((f) => f.status === "Pending");
                    const payoutTx = group.find((f) => f.payoutTxHash)?.payoutTxHash;
                    const submissionTx = group.find((f) => f.txHash)?.txHash;

                    return (
                      <div
                        key={top.targetContract}
                        onClick={(e) => {
                          if ((e.target as HTMLElement).closest("a")) return;
                          router.push(`/findings/${top.targetContract}`);
                        }}
                        className={`glass-panel rounded-2xl p-5 flex flex-col gap-3 relative overflow-hidden transition-all duration-200 cursor-pointer group
                          ${isCritical ? "border-blood-500/25 hover:border-blood-500/50" : isHigh ? "border-orange-500/25 hover:border-orange-500/50" : "border-amber-500/20 hover:border-amber-500/40"}`}
                      >
                        <div className={`absolute top-0 left-0 bottom-0 w-1 ${isCritical ? "bg-blood-500" : isHigh ? "bg-orange-500" : "bg-amber-500"}`} />

                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap mb-1.5">
                              <span className="text-[10px] font-mono text-zinc-550 bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded">Bounty #{top.bountyId}</span>
                              <span className="text-[10px] font-mono text-zinc-500 truncate">{top.targetContract}</span>
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase border
                                ${isCritical ? "bg-blood-500/10 text-blood-400 border-blood-500/20"
                                : isHigh ? "bg-orange-500/10 text-orange-400 border-orange-500/20"
                                : "bg-amber-500/10 text-amber-400 border-amber-500/20"}`}>
                                {top.severity}
                              </span>
                              <span className={`text-[10px] px-2 py-0.5 rounded font-bold font-mono border
                                ${isVerified ? "bg-verdigris-500/10 text-verdigris-400 border-verdigris-500/20"
                                : isPending ? "bg-amber-500/10 text-amber-400 border-amber-500/20 animate-pulse"
                                : "bg-blood-500/10 text-blood-400 border-blood-500/20"}`}>
                                {isVerified ? "Verified" : isPending ? "Pending" : "Rejected"}
                              </span>
                              <span className="text-[10px] text-zinc-500 font-mono">
                                {group.length} finding{group.length !== 1 ? "s" : ""}
                              </span>
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-2 shrink-0">
                            {payoutTx && (
                              <a
                                href={`https://sepolia.mantlescan.xyz/tx/${payoutTx}`}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-verdigris-400 font-mono text-[10px] hover:underline flex items-center gap-1"
                              >
                                Payout {payoutTx.slice(0, 8)}...
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                              </a>
                            )}
                            {submissionTx && (
                              <a
                                href={`https://sepolia.mantlescan.xyz/tx/${submissionTx}`}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-bronze-400 font-mono text-[10px] hover:underline flex items-center gap-1"
                              >
                                Submission {submissionTx.slice(0, 8)}...
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                              </a>
                            )}
                            <span className="text-[10px] text-zinc-600 group-hover:text-zinc-400 transition-colors flex items-center gap-1">
                              View all findings
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                            </span>
                          </div>
                        </div>

                        <div className="flex gap-1.5 flex-wrap">
                          {group.map((f) => (
                            <span key={f.id} className="text-[9px] font-mono px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400 truncate max-w-[200px]">
                              {f.title || "Finding"}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Reputation Ledger Tab */}
          {activeTab === "leaderboard" && (
            <div className="glass-panel rounded-2xl p-6">
              <h2 className="carved uppercase tracking-wide text-lg font-bold text-bone mb-4">Registered Agents Reputation Ledger</h2>
              <div className="overflow-x-auto custom-scrollbar">
                <table className="w-full text-left text-sm text-zinc-300 border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-900 text-zinc-550 font-mono text-[10px] uppercase tracking-wider">
                      <th className="py-3.5 px-4 font-bold">Rank</th>
                      <th className="py-3.5 px-4 font-bold">Agent Address</th>
                      <th className="py-3.5 px-4 font-bold">Reputation Ledger Balance</th>
                      <th className="py-3.5 px-4 font-bold">Security Tier</th>
                      <th className="py-3.5 px-4 font-bold">Verified Findings</th>
                      <th className="py-3.5 px-4 font-bold">Rejected Submissions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-900">
                    {agentStats ? (
                      <tr className="hover:bg-zinc-900/10 font-mono text-xs">
                        <td className="py-4 px-4 font-bold text-bronze-400">#1</td>
                        <td className="py-4 px-4 text-zinc-200 text-xs">{agentStats.address}</td>
                        <td className="py-4 px-4 font-extrabold text-bronze-400">{agentStats.reputationScore} REP</td>
                        <td className="py-4 px-4 text-zinc-400">{agentStats.reputationScore >= 800 ? "Elite Swarm" : agentStats.reputationScore >= 500 ? "Tier 1 Auditor" : "Novice Node"}</td>
                        <td className="py-4 px-4 font-bold text-verdigris-450">{agentStats.successful}</td>
                        <td className="py-4 px-4 text-blood-500">{agentStats.failed}</td>
                      </tr>
                    ) : (
                      <tr><td colSpan={6} className="py-8 text-center text-zinc-500 font-mono text-xs animate-pulse">Loading active agent registry records...</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </main>

        {/* Footer */}
        <footer className="border-t border-zinc-900 bg-ash/60 py-8 mt-auto">
          <div className="max-w-7xl mx-auto px-4 text-center text-xs text-zinc-500 font-mono">
            <span>© 2026 Ares Protocol · </span>
            <Link href="/" className="hover:text-zinc-300 transition-colors">← Back to Homepage</Link>
          </div>
        </footer>
      </div>

      {/* ── Create Bounty Modal Overhaul ─────────────────────────────────────── */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          onClick={(e) => { if (e.target === e.currentTarget) closeCreateModal(); }}
        >
          <div className="glass-panel rounded-3xl w-full max-w-lg shadow-2xl relative overflow-hidden">
            {/* Modal Ambient Lights */}
            <div className="absolute top-0 right-0 w-32 h-32 bg-bronze-500/5 rounded-full blur-2xl pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-32 h-32 bg-bronze-500/5 rounded-full blur-2xl pointer-events-none" />

            <div className="relative z-10">
              <div className="flex items-center justify-between p-6 border-b border-zinc-900">
                <div>
                  <h2 className="carved uppercase tracking-wide text-base font-bold text-bone">Create Bounty Escrow</h2>
                  <p className="text-xs text-zinc-500 mt-0.5">Deploy rewards on Mantle Sepolia to dispatch the auditing swarm.</p>
                </div>
                <button
                  onClick={closeCreateModal}
                  className="text-zinc-500 hover:text-zinc-300 transition-colors cursor-pointer"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="p-6 space-y-5">
                {/* Target contract address */}
                <div>
                  <label className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-450 block mb-2">Target Contract Address</label>
                  <input
                    type="text"
                    placeholder="0x..."
                    value={createForm.targetContract}
                    onChange={(e) => setCreateForm((f) => ({ ...f, targetContract: e.target.value }))}
                    className="w-full bg-ash/80 border border-zinc-800 rounded-xl px-4.5 py-3 text-sm font-mono text-zinc-200 placeholder-zinc-700 focus:outline-none focus:border-bronze-500/60 focus:ring-1 focus:ring-bronze-500/20 transition-all"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {/* Reward */}
                  <div>
                    <label className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-450 block mb-2">Reward Amount (MNT)</label>
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={createForm.rewardMnt}
                      onChange={(e) => setCreateForm((f) => ({ ...f, rewardMnt: e.target.value }))}
                      className="w-full bg-ash/80 border border-zinc-800 rounded-xl px-4.5 py-3 text-sm font-mono text-zinc-200 focus:outline-none focus:border-bronze-500/60 focus:ring-1 focus:ring-bronze-500/20 transition-all"
                    />
                  </div>

                  {/* Min severity */}
                  <div>
                    <label className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-450 block mb-2">Min Severity Threshold</label>
                    <div className="relative">
                      <select
                        value={createForm.severity}
                        onChange={(e) => setCreateForm((f) => ({ ...f, severity: e.target.value }))}
                        className="w-full bg-ash/80 border border-zinc-800 rounded-xl px-4.5 py-3 text-sm text-zinc-250 focus:outline-none focus:border-bronze-500/60 transition-all appearance-none cursor-pointer"
                      >
                        {SEVERITY_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                      <div className="absolute right-4 top-1/2 translate-y-[-50%] pointer-events-none text-zinc-500">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Deadline input */}
                <div>
                  <label className="text-[10px] font-mono font-bold uppercase tracking-wider text-zinc-450 block mb-2">Bounty Duration (days from now)</label>
                  <input
                    type="number"
                    min="1"
                    value={createForm.deadlineDays}
                    onChange={(e) => setCreateForm((f) => ({ ...f, deadlineDays: e.target.value }))}
                    className="w-full bg-ash/80 border border-zinc-800 rounded-xl px-4.5 py-3 text-sm font-mono text-zinc-200 focus:outline-none focus:border-bronze-500/60 focus:ring-1 focus:ring-bronze-500/20 transition-all"
                  />
                </div>

                {/* Create Error */}
                {createError && (
                  <p className="text-xs text-blood-400 font-mono bg-blood-950/20 border border-blood-900/40 rounded-xl p-3">
                    {createError.message?.split("\n")[0] ?? "Transaction rejected by client"}
                  </p>
                )}

                {/* Transaction receipt link status */}
                {createHash && (
                  <div className="text-xs text-verdigris-450 font-mono bg-verdigris-950/20 border border-verdigris-900/30 rounded-xl p-4 space-y-2">
                    <div className="flex items-center gap-2">
                      {isConfirming ? (
                        <span className="h-2 w-2 rounded-full bg-amber-400 animate-ping" />
                      ) : (
                        <span className="h-2 w-2 rounded-full bg-verdigris-450" />
                      )}
                      <span>{isConfirming ? "Waiting for receipt confirmation..." : "✓ Bounty Vault deployed!"}</span>
                    </div>
                    <a
                      href={`https://sepolia.mantlescan.xyz/tx/${createHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-bronze-400 hover:text-bronze-300 hover:underline truncate"
                    >
                      Explorer: {createHash}
                    </a>
                  </div>
                )}

                {/* Modal actions */}
                {isCreateSuccess ? (
                  <button
                    onClick={closeCreateModal}
                    className="w-full py-3 rounded-xl font-bold text-sm bg-verdigris-600 text-bone hover:bg-verdigris-500 transition-all cursor-pointer"
                  >
                    Done
                  </button>
                ) : !isConnected ? (
                  <button
                    onClick={login}
                    className="w-full py-3.5 rounded-xl font-bold text-sm bg-zinc-805 border border-zinc-755 text-zinc-200 hover:border-zinc-705 hover:bg-zinc-800/80 transition-all cursor-pointer"
                  >
                    Connect Wallet
                  </button>
                ) : isWrongNetwork ? (
                  <button
                    onClick={() => switchChain({ chainId: MANTLE_SEPOLIA_ID })}
                    disabled={isSwitching}
                    className="w-full py-3.5 rounded-xl font-bold text-sm bg-amber-600 text-bone hover:bg-amber-500 disabled:opacity-50 transition-all cursor-pointer"
                  >
                    {isSwitching ? "Switching networks..." : "Switch to Mantle Sepolia"}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-[10px] text-zinc-500 font-mono text-right">
                      Account: {address?.substring(0, 10)}...{address?.substring(32)}
                    </p>
                    <button
                      onClick={submitCreateBounty}
                      disabled={isCreating || isConfirming || !createForm.targetContract.startsWith("0x")}
                      className="w-full py-3.5 rounded-xl font-bold text-sm bg-linear-to-r from-bronze-500 to-bronze-600 text-ash hover:from-bronze-400 hover:to-bronze-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all cursor-pointer"
                    >
                      {isCreating ? "Confirm in Wallet..." : isConfirming ? "Confirming tx..." : `Deposit Escrow & Deploy · ${createForm.rewardMnt || "0"} MNT`}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
