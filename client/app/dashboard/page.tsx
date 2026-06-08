"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
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
  status: "PENDING" | "ANALYZING" | "SECURE" | "VULNERABLE" | "SUBMITTED" | "VERIFIED";
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
  // ── Data ──────────────────────────────────────────────────────────────────
  const [bounties, setBounties] = useState<Bounty[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [logs, setLogs] = useState<EventLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "bounties" | "findings" | "leaderboard">("overview");

  const fetchAll = useCallback(async () => {
    try {
      const [bRes, fRes, eRes] = await Promise.all([
        fetch(`${API_URL}/bounties`),
        fetch(`${API_URL}/findings`),
        fetch(`${API_URL}/events`),
      ]);
      if (!bRes.ok || !fRes.ok || !eRes.ok) throw new Error("API error");
      const [b, f, e] = await Promise.all([bRes.json(), fRes.json(), eRes.json()]);
      setBounties(b);
      setFindings(f);
      setLogs(e);
      setError(null);
    } catch {
      setError("Cannot reach the server. Make sure the NestJS server is running on port 3001.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 10_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  // ── Wallet ────────────────────────────────────────────────────────────────
  const { login, authenticated } = usePrivy();
  const { wallets } = useWallets();
  const address = wallets[0]?.address;
  const isConnected = authenticated && !!address;

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

  async function runManualAnalysis() {
    if (!triggerContract.startsWith("0x")) return;
    setIsTriggering(true);
    setTriggerDone(false);
    try {
      await fetch(`${API_URL}/analysis/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetContract: triggerContract }),
      });
      setTriggerContract("");
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

  const totalPayouts = findings
    .filter((f) => f.status === "Verified")
    .reduce((sum, f) => {
      const b = bounties.find((b) => b.bountyId === f.bountyId);
      return sum + (b ? parseFloat(b.rewardAmount || "0") : 0);
    }, 0)
    .toFixed(2);

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      VERIFIED:   "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
      SECURE:     "bg-cyan-500/10 text-cyan-400 border-cyan-500/25",
      ANALYZING:  "bg-purple-500/10 text-purple-400 border-purple-500/25",
      VULNERABLE: "bg-rose-500/10 text-rose-400 border-rose-500/25",
      SUBMITTED:  "bg-amber-500/10 text-amber-400 border-amber-500/25",
      PENDING:    "bg-zinc-800 text-zinc-400 border-zinc-700",
    };
    return `text-[10px] px-2 py-0.5 rounded-full font-mono font-medium border ${map[status] ?? map.PENDING}`;
  };

  const eventBadge = (type: string) => {
    const map: Record<string, string> = {
      BountyCreated:      "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
      FindingSubmitted:   "bg-purple-500/10 text-purple-400 border-purple-500/20",
      VerificationPassed: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      VerificationFailed: "bg-rose-500/10 text-rose-400 border-rose-500/20",
      AnalysisStarted:    "bg-zinc-800 text-zinc-400 border-zinc-700",
    };
    return `px-2 py-0.5 rounded text-[9px] font-mono font-bold border ${map[type] ?? map.AnalysisStarted}`;
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans flex flex-col selection:bg-cyan-500 selection:text-black">

      {error && (
        <div className="bg-rose-950/40 border-b border-rose-800/40 text-rose-300 text-xs py-2 px-6 font-mono text-center">
          {error}
        </div>
      )}

      {/* Header */}
      <header className="border-b border-zinc-800/80 bg-zinc-900/40 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-linear-to-br from-cyan-500 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/10">
              <svg className="w-5 h-5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight bg-linear-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">ARES</span>
              <span className="text-xs block text-zinc-500 font-mono tracking-widest uppercase">Bug Bounty Hunter</span>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 bg-zinc-900 px-3.5 py-1.5 rounded-lg border border-zinc-800 text-xs">
              {loading
                ? <><span className="h-2 w-2 rounded-full bg-zinc-600 animate-pulse" /><span className="text-zinc-500 font-mono">Connecting...</span></>
                : <><span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /><span className="text-zinc-400 font-mono">Mantle Testnet · Live</span></>
              }
            </div>
            <button
              onClick={fetchAll}
              className="text-xs px-3 py-2 rounded-lg font-medium bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700 transition-all"
            >
              Refresh
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="text-xs px-4 py-2 rounded-lg font-semibold bg-linear-to-r from-cyan-500 to-purple-600 text-white hover:from-cyan-400 hover:to-purple-500 transition-all shadow-lg shadow-cyan-500/10"
            >
              + Create Bounty
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 grow w-full flex flex-col gap-8">

        {/* Stats */}
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-2xl flex flex-col gap-1">
            <span className="text-zinc-500 text-xs font-mono uppercase">Total Pool Locked</span>
            <span className="text-2xl sm:text-3xl font-semibold text-cyan-400">{totalBountyVolume} MNT</span>
            <span className="text-xs text-zinc-500">Across active escrows</span>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-2xl flex flex-col gap-1">
            <span className="text-zinc-500 text-xs font-mono uppercase">Payouts Disbursed</span>
            <span className="text-2xl sm:text-3xl font-semibold text-emerald-400">{totalPayouts} MNT</span>
            <span className="text-xs text-zinc-500">Released to agents</span>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-2xl flex flex-col gap-1">
            <span className="text-zinc-500 text-xs font-mono uppercase">Monitored Targets</span>
            <span className="text-2xl sm:text-3xl font-semibold text-zinc-100">{bounties.length}</span>
            <span className="text-xs text-zinc-500">{bounties.filter((b) => b.active).length} active escrows</span>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-2xl flex flex-col gap-1">
            <span className="text-zinc-500 text-xs font-mono uppercase">Vulnerabilities</span>
            <span className="text-2xl sm:text-3xl font-semibold text-rose-500">{findings.length}</span>
            <span className="text-xs text-zinc-500">{findings.filter((f) => f.status === "Verified").length} verified</span>
          </div>
          <div className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-2xl flex flex-col gap-1 col-span-2 lg:col-span-1">
            <span className="text-zinc-500 text-xs font-mono uppercase">Agent Reputation</span>
            <span className="text-2xl sm:text-3xl font-semibold text-purple-400">
              {findings.filter((f) => f.status === "Verified").length * 50} REP
            </span>
            <span className="text-xs text-purple-300/80">Ares Agent</span>
          </div>
        </section>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800">
          <nav className="flex gap-6">
            {(["overview", "bounties", "findings", "leaderboard"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`pb-4 px-1 text-sm font-medium border-b-2 transition-all ${
                  activeTab === tab
                    ? "border-cyan-400 text-cyan-400"
                    : "border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                }`}
              >
                {tab === "overview" ? "Overview" : tab === "leaderboard" ? "Reputation Ledger" : tab === "bounties" ? "Bounties & Escrows" : "Findings"}
              </button>
            ))}
          </nav>
        </div>

        {/* Overview */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 flex flex-col gap-6">

              {/* Run Ares panel */}
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-8 w-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
                    <svg className="w-4 h-4 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h2 className="text-sm font-semibold text-zinc-100">Run Ares Agent</h2>
                    <p className="text-xs text-zinc-500">Manually target any contract for immediate analysis — no bounty required</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <input
                    type="text"
                    placeholder="0x contract address..."
                    value={triggerContract}
                    onChange={(e) => { setTriggerContract(e.target.value); setTriggerDone(false); }}
                    className="grow bg-zinc-950 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-purple-500/60 focus:ring-1 focus:ring-purple-500/20 transition-all"
                  />
                  <button
                    onClick={runManualAnalysis}
                    disabled={isTriggering || !triggerContract.startsWith("0x")}
                    className="px-5 py-2.5 rounded-xl font-semibold text-sm bg-purple-600 text-white hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all shrink-0"
                  >
                    {isTriggering ? "Running..." : "▶ Run"}
                  </button>
                </div>
                {triggerDone && (
                  <p className="mt-2 text-xs text-emerald-400 font-mono">
                    ✓ Analysis queued — results will appear below as they complete
                  </p>
                )}
              </div>

              {/* Escrow targets */}
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-zinc-100">Monitored Escrow Targets</h2>
                  <span className="text-xs text-zinc-600 font-mono">auto-refreshes every 10s</span>
                </div>
                {loading ? (
                  <div className="py-10 text-center text-zinc-600 text-sm">Loading...</div>
                ) : bounties.length === 0 ? (
                  <div className="py-10 text-center text-zinc-600 text-sm">
                    No bounties yet.{" "}
                    <button onClick={() => setShowCreate(true)} className="text-cyan-400 hover:underline">
                      Create one
                    </button>{" "}
                    or run a manual analysis above.
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-800/60">
                    {bounties.map((bounty) => (
                      <div key={bounty.id} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-zinc-200 font-mono">
                              {bounty.targetContract.substring(0, 10)}...{bounty.targetContract.substring(34)}
                            </span>
                            <span className={`${statusBadge(bounty.status)}${bounty.status === "ANALYZING" ? " animate-pulse" : ""}`}>
                              {bounty.status}
                            </span>
                          </div>
                          <div className="mt-1 text-xs text-zinc-500 flex flex-wrap gap-x-4 gap-y-1">
                            {bounty.creator && <span>Creator: {bounty.creator.substring(0, 10)}...</span>}
                            {bounty.deadline && <span>Deadline: {bounty.deadline}</span>}
                            {bounty.scannedAt && <span>Scanned: {new Date(bounty.scannedAt).toLocaleString()}</span>}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <span className="text-sm font-bold text-cyan-300 font-mono">{bounty.rewardAmount} MNT</span>
                          <span className="text-[10px] block text-zinc-500">Min: {bounty.severityThreshold}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Event log */}
            <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-6 flex flex-col min-h-[400px]">
              <h2 className="text-base font-semibold text-zinc-100 mb-4 flex items-center gap-2">
                <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Live Activity Feed
              </h2>
              {loading ? (
                <div className="grow flex items-center justify-center text-zinc-600 text-sm">Loading...</div>
              ) : logs.length === 0 ? (
                <div className="grow flex items-center justify-center text-zinc-600 text-sm text-center">
                  No events yet. Activity appears here as on-chain events are detected.
                </div>
              ) : (
                <div className="grow overflow-y-auto space-y-3 max-h-[460px] text-xs">
                  {logs.map((log) => (
                    <div key={log.id} className="p-3 bg-zinc-950/60 border border-zinc-800 rounded-xl flex flex-col gap-1.5 hover:border-zinc-700 transition-all">
                      <div className="flex items-center justify-between">
                        <span className={eventBadge(log.type)}>{log.type}</span>
                        <span className="text-[10px] text-zinc-600 font-mono">
                          {new Date(log.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                      <p className="text-zinc-300 leading-relaxed">{log.message}</p>
                      {log.txHash && (
                        <span className="text-[10px] text-zinc-600 font-mono truncate">Tx: {log.txHash}</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Bounties tab */}
        {activeTab === "bounties" && (
          <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold text-zinc-100">Bounty Escrows Register</h2>
              <button
                onClick={() => setShowCreate(true)}
                className="text-xs px-4 py-2 rounded-lg font-semibold bg-linear-to-r from-cyan-500 to-purple-600 text-white hover:from-cyan-400 hover:to-purple-500 transition-all"
              >
                + Create Bounty
              </button>
            </div>
            {bounties.length === 0 ? (
              <p className="text-zinc-500 text-sm text-center py-10">No bounties found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-zinc-300 border-collapse">
                  <thead>
                    <tr className="border-b border-zinc-800 text-zinc-500 font-mono text-xs">
                      <th className="py-3 px-4">ID</th>
                      <th className="py-3 px-4">Target Contract</th>
                      <th className="py-3 px-4">Creator</th>
                      <th className="py-3 px-4">Reward</th>
                      <th className="py-3 px-4">Min Severity</th>
                      <th className="py-3 px-4">Deadline</th>
                      <th className="py-3 px-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/60">
                    {bounties.map((b) => (
                      <tr key={b.id} className="hover:bg-zinc-900/20 transition-all font-mono">
                        <td className="py-4 px-4 text-zinc-400">#{b.bountyId}</td>
                        <td className="py-4 px-4 text-zinc-200 text-xs">{b.targetContract}</td>
                        <td className="py-4 px-4 text-xs text-zinc-500">{b.creator?.substring(0, 10)}...</td>
                        <td className="py-4 px-4 font-bold text-cyan-300">{b.rewardAmount} MNT</td>
                        <td className="py-4 px-4 text-xs">{b.severityThreshold}</td>
                        <td className="py-4 px-4 text-xs text-zinc-400">{b.deadline}</td>
                        <td className="py-4 px-4"><span className={statusBadge(b.status)}>{b.status}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Findings tab */}
        {activeTab === "findings" && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-zinc-100">Agent Vulnerability Findings</h2>
            {findings.length === 0 ? (
              <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-12 text-center text-zinc-500">
                No findings yet. Ares will populate this as bounties are analyzed.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {findings.map((f) => (
                  <div key={f.id} className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-6 flex flex-col gap-4 relative overflow-hidden">
                    <div className={`absolute top-0 left-0 bottom-0 w-1.5 ${
                      f.severity === "Critical" ? "bg-rose-500" : f.severity === "High" ? "bg-orange-500" : "bg-amber-500"
                    }`} />
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-4">
                      <div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-xs font-mono text-zinc-500">Bounty #{f.bountyId}</span>
                          <span className="text-xs font-mono text-zinc-400">{f.targetContract.substring(0, 14)}...</span>
                        </div>
                        <h3 className="text-base font-bold text-zinc-100 mt-1">{f.title || "Vulnerability Found"}</h3>
                      </div>
                      <div className="flex items-center gap-2.5 shrink-0">
                        <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                          f.severity === "Critical" ? "bg-rose-500/10 text-rose-400 border border-rose-500/25"
                          : f.severity === "High"   ? "bg-orange-500/10 text-orange-400 border border-orange-500/25"
                          : "bg-amber-500/10 text-amber-400 border border-amber-500/25"
                        }`}>{f.severity}</span>
                        <span className={`text-xs px-2.5 py-1 rounded-full font-bold font-mono ${
                          f.status === "Verified" ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25"
                          : f.status === "Rejected" ? "bg-rose-500/10 text-rose-400 border border-rose-500/25"
                          : "bg-amber-500/10 text-amber-400 border border-amber-500/25 animate-pulse"
                        }`}>{f.status}</span>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
                      <div className="md:col-span-2 space-y-4">
                        {f.description && (
                          <div>
                            <h4 className="text-xs font-mono uppercase text-zinc-500 mb-1">Description</h4>
                            <p className="text-zinc-300 leading-relaxed text-sm">{f.description}</p>
                          </div>
                        )}
                        {f.remediation && (
                          <div>
                            <h4 className="text-xs font-mono uppercase text-zinc-500 mb-1">Remediation</h4>
                            <p className="text-zinc-300 bg-zinc-950/60 border border-zinc-800 p-3 rounded-lg font-mono text-xs leading-relaxed">{f.remediation}</p>
                          </div>
                        )}
                      </div>
                      <div className="space-y-4 border-t md:border-t-0 md:border-l border-zinc-800 pt-4 md:pt-0 md:pl-6">
                        {f.pocSketch && (
                          <div>
                            <h4 className="text-xs font-mono uppercase text-zinc-500 mb-1">PoC Sketch</h4>
                            <p className="text-zinc-400 text-xs italic leading-relaxed">{f.pocSketch}</p>
                          </div>
                        )}
                        {f.agent && (
                          <div>
                            <h4 className="text-xs font-mono uppercase text-zinc-500 mb-1">Agent</h4>
                            <p className="text-zinc-500 font-mono text-xs truncate">{f.agent}</p>
                          </div>
                        )}
                        {f.txHash && (
                          <div>
                            <h4 className="text-xs font-mono uppercase text-zinc-500 mb-1">Tx Hash</h4>
                            <a
                              href={`https://sepolia.mantlescan.xyz/tx/${f.txHash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-cyan-400 font-mono text-xs truncate hover:underline"
                            >
                              {f.txHash}
                            </a>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Leaderboard */}
        {activeTab === "leaderboard" && (
          <div className="bg-zinc-900/30 border border-zinc-800 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-zinc-100 mb-4">Registered Agents Reputation Ledger</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-zinc-300 border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500 font-mono text-xs">
                    <th className="py-3 px-4">Rank</th>
                    <th className="py-3 px-4">Agent Address</th>
                    <th className="py-3 px-4">Reputation</th>
                    <th className="py-3 px-4">Tier</th>
                    <th className="py-3 px-4">Verified Findings</th>
                    <th className="py-3 px-4">Rejected</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  <tr className="hover:bg-zinc-900/20 font-mono">
                    <td className="py-4 px-4 font-semibold text-cyan-400">#1</td>
                    <td className="py-4 px-4 text-zinc-200 text-xs">Ares Agent (autonomous)</td>
                    <td className="py-4 px-4 font-bold text-purple-400">
                      {findings.filter((f) => f.status === "Verified").length * 50} REP
                    </td>
                    <td className="py-4 px-4 text-xs">Tier 1 Elite</td>
                    <td className="py-4 px-4 font-bold text-emerald-400">
                      {findings.filter((f) => f.status === "Verified").length}
                    </td>
                    <td className="py-4 px-4 text-rose-500">
                      {findings.filter((f) => f.status === "Rejected").length}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

      </main>

      <footer className="border-t border-zinc-900/80 bg-zinc-950 py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 text-center text-xs text-zinc-600 font-mono">
          © 2026 Ares Protocol ·{" "}
          <Link href="/" className="hover:text-zinc-400 transition-colors">← Back to Home</Link>
        </div>
      </footer>

      {/* ── Create Bounty Modal ─────────────────────────────────────────────── */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) closeCreateModal(); }}
        >
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg shadow-2xl shadow-black/50">
            <div className="flex items-center justify-between p-6 border-b border-zinc-800">
              <div>
                <h2 className="text-base font-bold text-zinc-100">Create Bounty</h2>
                <p className="text-xs text-zinc-500 mt-0.5">Deploy an escrow on Mantle Sepolia — Ares will start auditing immediately</p>
              </div>
              <button
                onClick={closeCreateModal}
                className="text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Target contract */}
              <div>
                <label className="text-xs font-mono uppercase text-zinc-400 block mb-1.5">Target Contract</label>
                <input
                  type="text"
                  placeholder="0x..."
                  value={createForm.targetContract}
                  onChange={(e) => setCreateForm((f) => ({ ...f, targetContract: e.target.value }))}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20 transition-all"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Reward */}
                <div>
                  <label className="text-xs font-mono uppercase text-zinc-400 block mb-1.5">Reward (MNT)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={createForm.rewardMnt}
                    onChange={(e) => setCreateForm((f) => ({ ...f, rewardMnt: e.target.value }))}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm font-mono text-zinc-200 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20 transition-all"
                  />
                </div>

                {/* Min severity */}
                <div>
                  <label className="text-xs font-mono uppercase text-zinc-400 block mb-1.5">Min Severity</label>
                  <select
                    value={createForm.severity}
                    onChange={(e) => setCreateForm((f) => ({ ...f, severity: e.target.value }))}
                    className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm text-zinc-200 focus:outline-none focus:border-cyan-500/60 transition-all appearance-none"
                  >
                    {SEVERITY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Deadline */}
              <div>
                <label className="text-xs font-mono uppercase text-zinc-400 block mb-1.5">Deadline (days from now)</label>
                <input
                  type="number"
                  min="1"
                  value={createForm.deadlineDays}
                  onChange={(e) => setCreateForm((f) => ({ ...f, deadlineDays: e.target.value }))}
                  className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-4 py-2.5 text-sm font-mono text-zinc-200 focus:outline-none focus:border-cyan-500/60 focus:ring-1 focus:ring-cyan-500/20 transition-all"
                />
              </div>

              {/* Error */}
              {createError && (
                <p className="text-xs text-rose-400 font-mono bg-rose-500/5 border border-rose-500/20 rounded-lg p-3">
                  {createError.message?.split("\n")[0] ?? "Transaction failed"}
                </p>
              )}

              {/* Tx success */}
              {createHash && (
                <div className="text-xs text-emerald-400 font-mono bg-emerald-500/5 border border-emerald-500/20 rounded-lg p-3">
                  {isConfirming ? "⏳ Waiting for confirmation..." : "✓ Bounty created!"}
                  <a
                    href={`https://sepolia.mantlescan.xyz/tx/${createHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block mt-1 text-cyan-400 hover:underline truncate"
                  >
                    Tx: {createHash}
                  </a>
                </div>
              )}

              {/* Submit */}
              {isCreateSuccess ? (
                <button
                  onClick={closeCreateModal}
                  className="w-full py-3 rounded-xl font-semibold text-sm bg-emerald-600 text-white hover:bg-emerald-500 transition-all"
                >
                  Done
                </button>
              ) : !isConnected ? (
                <button
                  onClick={login}
                  className="w-full py-3 rounded-xl font-semibold text-sm bg-zinc-800 border border-zinc-700 text-zinc-200 hover:border-zinc-600 transition-all"
                >
                  Connect Wallet
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-[10px] text-zinc-600 font-mono text-right">
                    Connected: {address?.substring(0, 10)}...{address?.substring(34)}
                  </p>
                  <button
                    onClick={submitCreateBounty}
                    disabled={isCreating || isConfirming || !createForm.targetContract.startsWith("0x")}
                    className="w-full py-3 rounded-xl font-semibold text-sm bg-linear-to-r from-cyan-500 to-purple-600 text-white hover:from-cyan-400 hover:to-purple-500 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    {isCreating ? "Confirm in wallet..." : isConfirming ? "Confirming..." : `Create Bounty · ${createForm.rewardMnt || "0"} MNT`}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
