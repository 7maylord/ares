"use client";

import React, { useState, useEffect } from "react";

// Mock Initial State Data representing real and simulated states of the protocol
interface Bounty {
  id: number;
  targetContract: string;
  bountyCreator: string;
  rewardAmount: string; // ETH
  severityThreshold: string;
  deadline: string;
  active: boolean;
  status: "PENDING" | "ANALYZING" | "SECURE" | "VULNERABLE" | "SUBMITTED" | "VERIFIED";
  scannedAt?: string;
  vulnerabilitiesFound?: number;
}

interface Finding {
  id: number;
  bountyId: number;
  targetContract: string;
  agent: string;
  title: string;
  severity: "Critical" | "High" | "Medium" | "Low";
  category: string;
  description: string;
  pocSketch: string;
  remediation: string;
  status: "Pending" | "Verified" | "Rejected";
  txHash?: string;
  submittedAt: string;
}

interface EventLog {
  id: number;
  timestamp: string;
  type: "BountyCreated" | "FindingSubmitted" | "VerificationPassed" | "VerificationFailed" | "ReputationUpdated";
  message: string;
  txHash: string;
}

const INITIAL_BOUNTIES: Bounty[] = [
  {
    id: 0,
    targetContract: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    bountyCreator: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    rewardAmount: "3.50",
    severityThreshold: "High",
    deadline: "2026-06-15",
    active: true,
    status: "VERIFIED",
    scannedAt: "2026-05-29 20:31:00",
    vulnerabilitiesFound: 1
  },
  {
    id: 1,
    targetContract: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    bountyCreator: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    rewardAmount: "5.00",
    severityThreshold: "Medium",
    deadline: "2026-06-20",
    active: true,
    status: "SECURE",
    scannedAt: "2026-05-29 20:55:12",
    vulnerabilitiesFound: 0
  },
  {
    id: 2,
    targetContract: "0x976EA74026E726554dB657fa54763abd0C3a0aa9",
    bountyCreator: "0x15d34AAf54f65c44428852e418f402f56747d3fc",
    rewardAmount: "2.50",
    severityThreshold: "High",
    deadline: "2026-06-05",
    active: true,
    status: "ANALYZING"
  }
];

const INITIAL_FINDINGS: Finding[] = [
  {
    id: 100,
    bountyId: 0,
    targetContract: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    agent: "0x2506e7887...7a84",
    title: "Reentrancy via external call in withdraw()",
    severity: "High",
    category: "Reentrancy",
    description: "The contract sends native ETH using msg.sender.call before updating the user balance state mapping, violating the Checks-Effects-Interactions pattern.",
    pocSketch: "Deploy malicious contract that calls withdraw() and re-enters the function in receive() fallback.",
    remediation: "Implement ReentrancyGuard or update state balances prior to the call.",
    status: "Verified",
    txHash: "0x789b53291...d2c3",
    submittedAt: "2026-05-29 20:32:15"
  }
];

const INITIAL_LOGS: EventLog[] = [
  {
    id: 1,
    timestamp: "2026-05-29 20:25:01",
    type: "BountyCreated",
    message: "Bounty #0 created for target 0xf39Fd...2266 with 3.50 ETH reward",
    txHash: "0x111111111...aaaa"
  },
  {
    id: 2,
    timestamp: "2026-05-29 20:26:40",
    type: "BountyCreated",
    message: "Bounty #1 created for target 0x3C44C...93BC with 5.00 ETH reward",
    txHash: "0x222222222...bbbb"
  },
  {
    id: 3,
    timestamp: "2026-05-29 20:30:15",
    type: "BountyCreated",
    message: "Bounty #2 created for target 0x976EA...0aa9 with 2.50 ETH reward",
    txHash: "0x333333333...cccc"
  },
  {
    id: 4,
    timestamp: "2026-05-29 20:32:15",
    type: "FindingSubmitted",
    message: "Finding #100 submitted for Bounty #0 by Ares Agent (Severity: High)",
    txHash: "0x444444444...dddd"
  },
  {
    id: 5,
    timestamp: "2026-05-29 20:33:02",
    type: "VerificationPassed",
    message: "Finding #100 passed automated verification! Payout of 3.50 ETH triggered.",
    txHash: "0x789b53291...d2c3"
  },
  {
    id: 6,
    timestamp: "2026-05-29 20:33:02",
    type: "ReputationUpdated",
    message: "Ares Agent reputation increased by +50 REP (Total: 1,250 REP)",
    txHash: "0x555555555...eeee"
  }
];

export default function Dashboard() {
  const [bounties, setBounties] = useState<Bounty[]>(INITIAL_BOUNTIES);
  const [findings, setFindings] = useState<Finding[]>(INITIAL_FINDINGS);
  const [logs, setLogs] = useState<EventLog[]>(INITIAL_LOGS);
  const [activeTab, setActiveTab] = useState<"overview" | "bounties" | "findings" | "leaderboard">("overview");

  // Form State
  const [newTarget, setNewTarget] = useState("");
  const [newReward, setNewReward] = useState("1.5");
  const [newSeverity, setNewSeverity] = useState("High");
  const [newDeadline, setNewDeadline] = useState("2026-06-30");
  const [newCode, setNewCode] = useState("");

  // Simulation Status States
  const [isSimulating, setIsSimulating] = useState(false);
  const [simStep, setSimStep] = useState("");

  // Dynamic Metrics
  const totalBountyVolume = bounties.reduce((sum, b) => sum + parseFloat(b.rewardAmount), 0).toFixed(2);
  const totalPayouts = findings
    .filter((f) => f.status === "Verified")
    .reduce((sum, f) => {
      const b = bounties.find((b) => b.id === f.bountyId);
      return sum + (b ? parseFloat(b.rewardAmount) : 0);
    }, 0)
    .toFixed(2);

  // Form Submission
  const handleCreateBounty = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTarget.startsWith("0x") || newTarget.length !== 42) {
      alert("Please enter a valid Ethereum address starting with 0x");
      return;
    }

    const newId = bounties.length;
    const bounty: Bounty = {
      id: newId,
      targetContract: newTarget,
      bountyCreator: "0x7a846...UserAddress",
      rewardAmount: parseFloat(newReward).toFixed(2),
      severityThreshold: newSeverity,
      deadline: newDeadline,
      active: true,
      status: "PENDING"
    };

    setBounties([bounty, ...bounties]);

    const txHash = "0x" + Math.random().toString(16).substring(2, 10) + "..." + Math.random().toString(16).substring(2, 6);
    const newLog: EventLog = {
      id: logs.length + 1,
      timestamp: new Date().toISOString().replace("T", " ").substring(0, 19),
      type: "BountyCreated",
      message: `Bounty #${newId} created for target ${newTarget.substring(0, 7)}...${newTarget.substring(38)} with ${bounty.rewardAmount} ETH reward`,
      txHash
    };
    setLogs([newLog, ...logs]);

    // Reset Form
    setNewTarget("");
    setNewCode("");
  };

  // Run Simulation of AI Agent Auditing & On-chain Payout
  const runSimulation = () => {
    if (isSimulating) return;
    setIsSimulating(true);
    
    // Simulate step 1: Deployed Vault contract
    setSimStep("Deploying Vulnerable Vault contract...");
    
    setTimeout(() => {
      const vulnTarget = "0x" + Math.random().toString(16).substring(2, 10) + "dDdB6a900fa2b585dd299e03d12FA" + Math.random().toString(16).substring(2, 6);
      const bountyId = bounties.length;
      
      const newBounty: Bounty = {
        id: bountyId,
        targetContract: vulnTarget,
        bountyCreator: "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
        rewardAmount: "4.20",
        severityThreshold: "High",
        deadline: "2026-07-01",
        active: true,
        status: "PENDING"
      };
      
      setBounties(prev => [newBounty, ...prev]);
      
      const txHash1 = "0x" + Math.random().toString(16).substring(2, 10) + "..." + Math.random().toString(16).substring(2, 6);
      setLogs(prev => [
        {
          id: prev.length + 1,
          timestamp: new Date().toISOString().replace("T", " ").substring(0, 19),
          type: "BountyCreated",
          message: `Bounty #${bountyId} created for vulnerable target ${vulnTarget.substring(0, 7)}... with 4.20 ETH reward`,
          txHash: txHash1
        },
        ...prev
      ]);

      // Simulate step 2: Listening & Running Slither
      setTimeout(() => {
        setSimStep("Mantle RPC detected BountyCreated. Running Slither Static Analysis...");
        setBounties(prev => 
          prev.map(b => b.id === bountyId ? { ...b, status: "ANALYZING" } : b)
        );

        // Simulate step 3: RAG LLM Reasoning
        setTimeout(() => {
          setSimStep("Slither completed. Running OpenAI RAG model using Solodit database context...");
          
          setTimeout(() => {
            setSimStep("Vulnerability identified! Generating Proof of Concept (PoC) transaction payload...");
            setBounties(prev => 
              prev.map(b => b.id === bountyId ? { ...b, status: "VULNERABLE" } : b)
            );

            // Simulate step 4: Submit Finding
            setTimeout(() => {
              setSimStep("PoC generated. Submitting finding to BountyPool on-chain via SubmitterService...");
              setBounties(prev => 
                prev.map(b => b.id === bountyId ? { ...b, status: "SUBMITTED" } : b)
              );
              
              const findingId = findings.length + 100;
              const newFinding: Finding = {
                id: findingId,
                bountyId: bountyId,
                targetContract: vulnTarget,
                agent: "0x2506e7887...7a84",
                title: "Flash Loan price manipulation in AMM oracle pricing",
                severity: "Critical",
                category: "Oracle Manipulation",
                description: "The contract computes Uniswap V2 reserve ratio in a view function to price liquidations, making it easily manipulated in a single transaction with a flash loan.",
                pocSketch: "Flash loan 5,000 WETH, swap against AMM reserves to manipulate the spot price ratio, liquidate target position at highly inflated rates, repay loan.",
                remediation: "Implement a Chainlink TWAP feed or average the AMM ratio over multiple blocks.",
                status: "Pending",
                submittedAt: new Date().toISOString().replace("T", " ").substring(0, 19)
              };

              setFindings(prev => [newFinding, ...prev]);

              const txHash2 = "0x" + Math.random().toString(16).substring(2, 10) + "..." + Math.random().toString(16).substring(2, 6);
              setLogs(prev => [
                {
                  id: prev.length + 1,
                  timestamp: new Date().toISOString().replace("T", " ").substring(0, 19),
                  type: "FindingSubmitted",
                  message: `Finding #${findingId} submitted for Bounty #${bountyId} by Ares Agent (Severity: Critical)`,
                  txHash: txHash2
                },
                ...prev
              ]);

              // Simulate step 5: Escrow Oracle auto-verifies
              setTimeout(() => {
                setSimStep("EscrowService auto-verifies PoC payload. Triggering release of 4.20 ETH payout...");
                
                setFindings(prev => 
                  prev.map(f => f.id === findingId ? { ...f, status: "Verified", txHash: "0x" + Math.random().toString(16).substring(2, 10) + "..." + Math.random().toString(16).substring(2, 6) } : f)
                );
                
                setBounties(prev => 
                  prev.map(b => b.id === bountyId ? { ...b, status: "VERIFIED", vulnerabilitiesFound: 1, scannedAt: new Date().toISOString().replace("T", " ").substring(0, 19) } : b)
                );

                const txHash3 = "0x" + Math.random().toString(16).substring(2, 10) + "..." + Math.random().toString(16).substring(2, 6);
                setLogs(prev => [
                  {
                    id: prev.length + 1,
                    timestamp: new Date().toISOString().replace("T", " ").substring(0, 19),
                    type: "VerificationPassed",
                    message: `Finding #${findingId} passed automated verification! Payout of 4.20 ETH triggered.`,
                    txHash: txHash3
                  },
                  {
                    id: prev.length + 2,
                    timestamp: new Date().toISOString().replace("T", " ").substring(0, 19),
                    type: "ReputationUpdated",
                    message: "Ares Agent reputation increased by +100 REP (Total: 1,350 REP)",
                    txHash: "0x" + Math.random().toString(16).substring(2, 10) + "..."
                  },
                  ...prev
                ]);

                setIsSimulating(false);
                setSimStep("");
              }, 3000);
            }, 3000);
          }, 3000);
        }, 3000);
      }, 3000);
    }, 2500);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-50 font-sans flex flex-col selection:bg-cyan-500 selection:text-black">
      
      {/* Dynamic Simulation Banner */}
      {isSimulating && (
        <div className="bg-gradient-to-r from-cyan-650 via-purple-900 to-cyan-800 text-white text-sm py-3 px-6 shadow-2xl flex items-center justify-between border-b border-cyan-500/25 animate-pulse">
          <div className="flex items-center gap-3">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400"></span>
            </span>
            <span className="font-medium">Ares AI Agent Active:</span>
            <span className="text-cyan-200">{simStep}</span>
          </div>
          <div className="hidden sm:block text-xs bg-black/30 px-3 py-1 rounded-full text-cyan-300">
            Orchestrating Flow
          </div>
        </div>
      )}

      {/* Header */}
      <header className="border-b border-zinc-800/80 bg-zinc-900/40 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-cyan-500 to-purple-600 flex items-center justify-center shadow-lg shadow-cyan-500/10">
              <svg className="w-5 h-5 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path>
              </svg>
            </div>
            <div>
              <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">ARES</span>
              <span className="text-xs block text-zinc-500 font-mono tracking-widest uppercase">Bug Bounty Hunter</span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-2 bg-zinc-900 px-3.5 py-1.5 rounded-lg border border-zinc-800 text-xs">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
              <span className="text-zinc-400 font-mono">Mantle Testnet Connected</span>
            </div>
            
            {/* Simulation Trigger Button */}
            <button
              onClick={runSimulation}
              disabled={isSimulating}
              className={`text-xs px-4 py-2 rounded-lg font-medium transition-all duration-300 ${
                isSimulating
                  ? "bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700"
                  : "bg-cyan-500 text-black hover:bg-cyan-400 hover:shadow-lg hover:shadow-cyan-500/20 active:scale-95"
              }`}
            >
              {isSimulating ? "Agent Auditing..." : "Trigger AI Exploit Run"}
            </button>
          </div>
        </div>
      </header>

      {/* Main Body */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-grow w-full flex flex-col gap-8">
        
        {/* Statistics Grid */}
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-zinc-900/50 backdrop-blur-sm border border-zinc-850 p-5 rounded-2xl flex flex-col gap-1 transition-all hover:border-zinc-800">
            <span className="text-zinc-500 text-xs font-mono uppercase">Total Pool Locked</span>
            <span className="text-2xl sm:text-3xl font-semibold text-cyan-400">{totalBountyVolume} ETH</span>
            <span className="text-xs text-zinc-500">Across active escrows</span>
          </div>
          <div className="bg-zinc-900/50 backdrop-blur-sm border border-zinc-850 p-5 rounded-2xl flex flex-col gap-1 transition-all hover:border-zinc-800">
            <span className="text-zinc-500 text-xs font-mono uppercase">Payouts Disbursed</span>
            <span className="text-2xl sm:text-3xl font-semibold text-emerald-400">{totalPayouts} ETH</span>
            <span className="text-xs text-zinc-500">Released to agents</span>
          </div>
          <div className="bg-zinc-900/50 backdrop-blur-sm border border-zinc-850 p-5 rounded-2xl flex flex-col gap-1 transition-all hover:border-zinc-800">
            <span className="text-zinc-500 text-xs font-mono uppercase">Monitored targets</span>
            <span className="text-2xl sm:text-3xl font-semibold text-zinc-100">{bounties.length} Contracts</span>
            <span className="text-xs text-zinc-500">{bounties.filter(b => b.active).length} Active escrows</span>
          </div>
          <div className="bg-zinc-900/50 backdrop-blur-sm border border-zinc-850 p-5 rounded-2xl flex flex-col gap-1 transition-all hover:border-zinc-800">
            <span className="text-zinc-500 text-xs font-mono uppercase">Vulnerabilities Detected</span>
            <span className="text-2xl sm:text-3xl font-semibold text-rose-500">{findings.length} findings</span>
            <span className="text-xs text-zinc-500">100% Exploit proof verified</span>
          </div>
          <div className="bg-zinc-900/50 backdrop-blur-sm border border-zinc-850 p-5 rounded-2xl flex flex-col gap-1 col-span-2 lg:col-span-1 transition-all hover:border-zinc-800">
            <span className="text-zinc-500 text-xs font-mono uppercase">Agent Ares Reputation</span>
            <span className="text-2xl sm:text-3xl font-semibold text-purple-400">1,250 REP</span>
            <span className="text-xs text-purple-300/80">Rank: Tier 1 Elite (Auditor)</span>
          </div>
        </section>

        {/* Tab Navigation */}
        <div className="flex border-b border-zinc-850">
          <nav className="flex gap-6" aria-label="Tabs">
            <button
              onClick={() => setActiveTab("overview")}
              className={`pb-4 px-1 text-sm font-medium border-b-2 transition-all ${
                activeTab === "overview"
                  ? "border-cyan-400 text-cyan-400"
                  : "border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
              }`}
            >
              Overview Dashboard
            </button>
            <button
              onClick={() => setActiveTab("bounties")}
              className={`pb-4 px-1 text-sm font-medium border-b-2 transition-all ${
                activeTab === "bounties"
                  ? "border-cyan-400 text-cyan-400"
                  : "border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
              }`}
            >
              Bounties & Escrows
            </button>
            <button
              onClick={() => setActiveTab("findings")}
              className={`pb-4 px-1 text-sm font-medium border-b-2 transition-all ${
                activeTab === "findings"
                  ? "border-cyan-400 text-cyan-400"
                  : "border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
              }`}
            >
              Vulnerability Findings
            </button>
            <button
              onClick={() => setActiveTab("leaderboard")}
              className={`pb-4 px-1 text-sm font-medium border-b-2 transition-all ${
                activeTab === "leaderboard"
                  ? "border-cyan-400 text-cyan-400"
                  : "border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
              }`}
            >
              Reputation Ledger
            </button>
          </nav>
        </div>

        {/* Overview Tab Content */}
        {activeTab === "overview" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            
            {/* Left Column: Escrows List & Bounty Creator */}
            <div className="lg:col-span-2 flex flex-col gap-8">
              
              {/* Active Targets & Audit Statuses */}
              <div className="bg-zinc-900/30 border border-zinc-850 rounded-2xl p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-semibold text-zinc-100 flex items-center gap-2">
                    <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path>
                    </svg>
                    Monitored Escrow Targets
                  </h2>
                  <span className="text-xs text-zinc-500 font-mono">Live updates</span>
                </div>
                
                <div className="divide-y divide-zinc-850">
                  {bounties.map((bounty) => (
                    <div key={bounty.id} className="py-4 first:pt-0 last:pb-0 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-zinc-200 font-mono">
                            {bounty.targetContract.substring(0, 10)}...{bounty.targetContract.substring(34)}
                          </span>
                          <span className={`text-[10px] px-2 py-0.5 rounded-full font-mono font-medium ${
                            bounty.status === "VERIFIED"
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25"
                              : bounty.status === "SECURE"
                              ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/25"
                              : bounty.status === "ANALYZING"
                              ? "bg-purple-500/10 text-purple-400 border border-purple-500/25 animate-pulse"
                              : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                          }`}>
                            {bounty.status}
                          </span>
                        </div>
                        <div className="mt-1 text-xs text-zinc-500 flex flex-wrap gap-x-4 gap-y-1">
                          <span>Pool Creator: {bounty.bountyCreator.substring(0, 6)}...</span>
                          <span>Deadline: {bounty.deadline}</span>
                          {bounty.scannedAt && <span>Scanned: {bounty.scannedAt}</span>}
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:justify-end gap-6">
                        <div className="text-left sm:text-right">
                          <span className="text-sm font-bold text-cyan-300 font-mono">{bounty.rewardAmount} ETH</span>
                          <span className="text-[10px] block text-zinc-500">Threshold: {bounty.severityThreshold}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Deploy/Fund New Escrow Bounty */}
              <div className="bg-zinc-900/30 border border-zinc-850 rounded-2xl p-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 h-40 w-40 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none"></div>
                <h2 className="text-base font-semibold text-zinc-100 mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                  </svg>
                  Fund Smart Escrow Bounty
                </h2>
                
                <form onSubmit={handleCreateBounty} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-mono uppercase text-zinc-500 mb-1.5">Target Contract Address</label>
                      <input
                        type="text"
                        required
                        value={newTarget}
                        onChange={(e) => setNewTarget(e.target.value)}
                        placeholder="0x..."
                        className="w-full bg-zinc-950/80 border border-zinc-800 rounded-lg px-3.5 py-2 text-sm text-zinc-200 focus:outline-none focus:border-cyan-500/50 transition-all font-mono"
                      />
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-mono uppercase text-zinc-500 mb-1.5">Reward (ETH)</label>
                        <input
                          type="number"
                          step="0.01"
                          required
                          value={newReward}
                          onChange={(e) => setNewReward(e.target.value)}
                          placeholder="2.5"
                          className="w-full bg-zinc-950/80 border border-zinc-800 rounded-lg px-3.5 py-2 text-sm text-zinc-200 focus:outline-none focus:border-cyan-500/50 transition-all font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-mono uppercase text-zinc-500 mb-1.5">Min Severity</label>
                        <select
                          value={newSeverity}
                          onChange={(e) => setNewSeverity(e.target.value)}
                          className="w-full bg-zinc-950/80 border border-zinc-800 rounded-lg px-3.5 py-2 text-sm text-zinc-200 focus:outline-none focus:border-cyan-500/50 transition-all"
                        >
                          <option value="Low">Low</option>
                          <option value="Medium">Medium</option>
                          <option value="High">High</option>
                          <option value="Critical">Critical</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-mono uppercase text-zinc-500 mb-1.5">Verification Deadline</label>
                    <input
                      type="date"
                      required
                      value={newDeadline}
                      onChange={(e) => setNewDeadline(e.target.value)}
                      className="w-full bg-zinc-950/80 border border-zinc-800 rounded-lg px-3.5 py-2 text-sm text-zinc-200 focus:outline-none focus:border-cyan-500/50 transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-mono uppercase text-zinc-500 mb-1.5">Solidity Source Code / ABI Mapping (Optional)</label>
                    <textarea
                      value={newCode}
                      onChange={(e) => setNewCode(e.target.value)}
                      placeholder="Paste contract source code here for RAG reasoning and Slither scanning..."
                      rows={3}
                      className="w-full bg-zinc-950/80 border border-zinc-800 rounded-lg px-3.5 py-2 text-sm text-zinc-200 focus:outline-none focus:border-cyan-500/50 transition-all font-mono"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full bg-gradient-to-r from-cyan-600 to-purple-600 text-white hover:from-cyan-500 hover:to-purple-500 rounded-lg py-2.5 text-sm font-semibold transition-all duration-300 hover:shadow-lg hover:shadow-cyan-500/10 active:scale-98"
                  >
                    Deploy Escrow & Fund Pool
                  </button>
                </form>
              </div>

            </div>

            {/* Right Column: Real-Time Event & Transaction Logs */}
            <div className="flex flex-col gap-8">
              
              {/* Event Logs Stream */}
              <div className="bg-zinc-900/30 border border-zinc-850 rounded-2xl p-6 flex flex-col flex-grow min-h-[400px]">
                <h2 className="text-base font-semibold text-zinc-100 mb-4 flex items-center gap-2">
                  <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path>
                  </svg>
                  Oracle Escrow Activity
                </h2>
                
                <div className="flex-grow overflow-y-auto space-y-4 pr-1 max-h-[460px] custom-scrollbar text-xs">
                  {logs.map((log) => (
                    <div key={log.id} className="p-3 bg-zinc-950/60 border border-zinc-850/80 rounded-xl flex flex-col gap-1 hover:border-zinc-800 transition-all">
                      <div className="flex items-center justify-between">
                        <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold ${
                          log.type === "BountyCreated"
                            ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                            : log.type === "FindingSubmitted"
                            ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                            : log.type === "VerificationPassed"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : log.type === "VerificationFailed"
                            ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                            : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                        }`}>
                          {log.type}
                        </span>
                        <span className="text-[10px] text-zinc-600 font-mono">{log.timestamp.split(" ")[1]}</span>
                      </div>
                      <p className="text-zinc-300 leading-relaxed font-sans">{log.message}</p>
                      <div className="flex justify-between items-center text-[10px] text-zinc-500 font-mono mt-1 pt-1 border-t border-zinc-900/60">
                        <span>Tx: {log.txHash}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>

          </div>
        )}

        {/* Bounties & Escrows Detailed View */}
        {activeTab === "bounties" && (
          <div className="bg-zinc-900/30 border border-zinc-850 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-zinc-100 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"></path>
              </svg>
              Bounty Escrows Register
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-zinc-300 border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500 font-mono text-xs">
                    <th className="py-3 px-4">Bounty ID</th>
                    <th className="py-3 px-4">Target Contract</th>
                    <th className="py-3 px-4">Creator</th>
                    <th className="py-3 px-4">Reward Amount</th>
                    <th className="py-3 px-4">Min Severity</th>
                    <th className="py-3 px-4">Deadline</th>
                    <th className="py-3 px-4">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-850">
                  {bounties.map((b) => (
                    <tr key={b.id} className="hover:bg-zinc-900/20 transition-all font-mono">
                      <td className="py-4 px-4 font-semibold text-zinc-400">#{b.id}</td>
                      <td className="py-4 px-4 text-zinc-200 text-xs font-semibold">{b.targetContract}</td>
                      <td className="py-4 px-4 text-xs text-zinc-500">{b.bountyCreator}</td>
                      <td className="py-4 px-4 font-bold text-cyan-300">{b.rewardAmount} ETH</td>
                      <td className="py-4 px-4 text-xs font-sans">{b.severityThreshold}</td>
                      <td className="py-4 px-4 text-xs font-sans text-zinc-400">{b.deadline}</td>
                      <td className="py-4 px-4">
                        <span className={`text-[10px] px-2.5 py-0.5 rounded-full font-semibold ${
                          b.status === "VERIFIED"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : b.status === "SECURE"
                            ? "bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                            : b.status === "ANALYZING"
                            ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                            : "bg-zinc-800 text-zinc-400 border border-zinc-700"
                        }`}>
                          {b.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Findings Detailed Feed */}
        {activeTab === "findings" && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
              <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
              </svg>
              Agent Vulnerability Findings
            </h2>

            {findings.length === 0 ? (
              <div className="bg-zinc-900/30 border border-zinc-850 rounded-2xl p-12 text-center text-zinc-500">
                No findings reported yet. Use the simulation to trigger vulnerability scans!
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6">
                {findings.map((f) => (
                  <div key={f.id} className="bg-zinc-900/30 border border-zinc-850 rounded-2xl p-6 flex flex-col gap-4 relative overflow-hidden">
                    
                    {/* Glowing Accent Side-border */}
                    <div className={`absolute top-0 left-0 bottom-0 w-1.5 ${
                      f.severity === "Critical"
                        ? "bg-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.5)]"
                        : f.severity === "High"
                        ? "bg-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.5)]"
                        : "bg-amber-500"
                    }`}></div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-850 pb-4">
                      <div>
                        <div className="flex items-center gap-3 flex-wrap">
                          <span className="text-xs font-mono text-zinc-500">Finding #{f.id}</span>
                          <span className="text-sm font-semibold text-zinc-300 font-mono">Target: {f.targetContract}</span>
                        </div>
                        <h3 className="text-lg font-bold text-zinc-100 mt-1">{f.title}</h3>
                      </div>
                      
                      <div className="flex items-center gap-2.5">
                        <span className={`text-xs px-2.5 py-1 rounded-full font-bold ${
                          f.severity === "Critical"
                            ? "bg-rose-500/10 text-rose-400 border border-rose-500/25"
                            : f.severity === "High"
                            ? "bg-orange-500/10 text-orange-400 border border-orange-500/25"
                            : "bg-amber-500/10 text-amber-400 border border-amber-500/25"
                        }`}>
                          {f.severity}
                        </span>
                        
                        <span className={`text-xs px-2.5 py-1 rounded-full font-bold font-mono ${
                          f.status === "Verified"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/25"
                            : f.status === "Rejected"
                            ? "bg-rose-500/10 text-rose-400 border border-rose-500/25"
                            : "bg-amber-500/10 text-amber-400 border border-amber-500/25 animate-pulse"
                        }`}>
                          {f.status}
                        </span>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">
                      <div className="md:col-span-2 space-y-4">
                        <div>
                          <h4 className="text-xs font-mono uppercase text-zinc-500 mb-1">Description</h4>
                          <p className="text-zinc-300 leading-relaxed font-sans">{f.description}</p>
                        </div>
                        <div>
                          <h4 className="text-xs font-mono uppercase text-zinc-500 mb-1">Remediation</h4>
                          <p className="text-zinc-300 leading-relaxed font-sans bg-zinc-950/60 border border-zinc-850 p-3 rounded-lg font-mono text-xs">{f.remediation}</p>
                        </div>
                      </div>

                      <div className="space-y-4 border-t md:border-t-0 md:border-l border-zinc-850 pt-4 md:pt-0 md:pl-6">
                        <div>
                          <h4 className="text-xs font-mono uppercase text-zinc-500 mb-1">Proof of Concept Sketch</h4>
                          <p className="text-zinc-400 leading-relaxed text-xs italic">{f.pocSketch}</p>
                        </div>
                        <div>
                          <h4 className="text-xs font-mono uppercase text-zinc-500 mb-1">Auditor Address</h4>
                          <p className="text-zinc-500 font-mono text-xs truncate">{f.agent}</p>
                        </div>
                        {f.txHash && (
                          <div>
                            <h4 className="text-xs font-mono uppercase text-zinc-500 mb-1">Payout Tx Hash</h4>
                            <p className="text-cyan-400 font-mono text-xs truncate">{f.txHash}</p>
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

        {/* Reputation Leaderboard */}
        {activeTab === "leaderboard" && (
          <div className="bg-zinc-900/30 border border-zinc-850 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-zinc-100 mb-4 flex items-center gap-2">
              <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"></path>
              </svg>
              Registered Agents Reputation Ledger
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-zinc-300 border-collapse">
                <thead>
                  <tr className="border-b border-zinc-800 text-zinc-500 font-mono text-xs">
                    <th className="py-3 px-4">Rank</th>
                    <th className="py-3 px-4">Agent Address</th>
                    <th className="py-3 px-4">Reputation Score</th>
                    <th className="py-3 px-4">Tier Status</th>
                    <th className="py-3 px-4">Successful Audits</th>
                    <th className="py-3 px-4">False Positives</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-850">
                  <tr className="hover:bg-zinc-900/20 transition-all font-mono">
                    <td className="py-4 px-4 font-semibold text-cyan-400">#1</td>
                    <td className="py-4 px-4 text-zinc-200 text-xs font-semibold">0x2506e78875508c90bf03ff0210f8a848b8127a84 (Ares Agent)</td>
                    <td className="py-4 px-4 font-bold text-purple-400">1,250 REP</td>
                    <td className="py-4 px-4 font-sans text-xs">Tier 1 Elite</td>
                    <td className="py-4 px-4 font-bold text-emerald-400">18</td>
                    <td className="py-4 px-4 text-rose-500">0</td>
                  </tr>
                  <tr className="hover:bg-zinc-900/20 transition-all font-mono">
                    <td className="py-4 px-4 text-zinc-500">#2</td>
                    <td className="py-4 px-4 text-zinc-400 text-xs">0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC</td>
                    <td className="py-4 px-4 font-bold text-zinc-400">320 REP</td>
                    <td className="py-4 px-4 font-sans text-xs text-zinc-500">Tier 2 Senior</td>
                    <td className="py-4 px-4 text-zinc-400">3</td>
                    <td className="py-4 px-4 text-rose-500/70">1</td>
                  </tr>
                  <tr className="hover:bg-zinc-900/20 transition-all font-mono">
                    <td className="py-4 px-4 text-zinc-500">#3</td>
                    <td className="py-4 px-4 text-zinc-400 text-xs">0x90F79bf6EB2c4f870365E785982E1f101E93b906</td>
                    <td className="py-4 px-4 font-bold text-zinc-400">140 REP</td>
                    <td className="py-4 px-4 font-sans text-xs text-zinc-500">Tier 3 Auditor</td>
                    <td className="py-4 px-4 text-zinc-400">1</td>
                    <td className="py-4 px-4 text-rose-500/70">0</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-900/80 bg-zinc-950 py-6 mt-auto">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center text-xs text-zinc-600 font-mono">
          <p>© 2026 Ares Protocol. Deployed on Mantle Testnet with TypeORM and FastAPI.</p>
        </div>
      </footer>

    </div>
  );
}
