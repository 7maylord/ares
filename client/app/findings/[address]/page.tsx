"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { use } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

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
  status: string;
  txHash?: string;
  payoutTxHash?: string;
  submittedAt: string;
}

const SEVERITY_RANK: Record<string, number> = { Critical: 4, High: 3, Medium: 2, Low: 1, Informational: 0 };

function severityColors(s: string) {
  if (s === "Critical") return { bar: "bg-blood-500", badge: "bg-blood-500/10 text-blood-400 border-blood-500/20", border: "border-blood-500/25" };
  if (s === "High")     return { bar: "bg-orange-500", badge: "bg-orange-500/10 text-orange-400 border-orange-500/20", border: "border-orange-500/25" };
  if (s === "Medium")   return { bar: "bg-amber-500", badge: "bg-amber-500/10 text-amber-400 border-amber-500/20", border: "border-amber-500/25" };
  return { bar: "bg-verdigris-500", badge: "bg-verdigris-500/10 text-verdigris-400 border-verdigris-500/20", border: "border-verdigris-500/20" };
}

export default function FindingsDetailPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_URL}/findings/contract/${address}`)
      .then((r) => r.json())
      .then((data) => {
        const sorted = [...data].sort(
          (a: Finding, b: Finding) => (SEVERITY_RANK[b.severity] ?? 0) - (SEVERITY_RANK[a.severity] ?? 0)
        );
        setFindings(sorted);
      })
      .finally(() => setLoading(false));
  }, [address]);

  const bountyId = findings[0]?.bountyId;
  const agent = findings[0]?.agent;
  const payoutTx = findings.find((f) => f.payoutTxHash)?.payoutTxHash;
  const submissionTx = findings.find((f) => f.txHash)?.txHash;
  const isVerified = findings.some((f) => f.status === "Verified");

  return (
    <main className="min-h-screen bg-ash text-bone font-plex p-6 md:p-10 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <Link href="/dashboard" className="inline-flex items-center gap-1.5 text-zinc-500 hover:text-zinc-300 text-sm transition-colors mb-6">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" />
          </svg>
          Back to Dashboard
        </Link>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 flex-wrap">
            {bountyId !== undefined && (
              <span className="text-[10px] font-mono bg-zinc-900 border border-zinc-800 px-2 py-0.5 rounded text-zinc-400">
                Bounty #{bountyId}
              </span>
            )}
            {isVerified && (
              <span className="text-[10px] font-mono bg-verdigris-500/10 text-verdigris-400 border border-verdigris-500/20 px-2 py-0.5 rounded font-bold">
                VERIFIED
              </span>
            )}
            <span className="text-[10px] font-mono text-zinc-500">
              {findings.length} finding{findings.length !== 1 ? "s" : ""}
            </span>
          </div>
          <h1 className="text-xl font-bold text-zinc-100 font-mono break-all">{address}</h1>
        </div>

        {/* On-chain proof strip */}
        {(submissionTx || payoutTx) && (
          <div className="mt-4 flex flex-wrap gap-4">
            {submissionTx && (
              <a
                href={`https://sepolia.mantlescan.xyz/tx/${submissionTx}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-bronze-400 font-mono text-xs hover:underline"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                Submission Tx: {submissionTx.slice(0, 14)}...{submissionTx.slice(-10)}
              </a>
            )}
            {payoutTx && (
              <a
                href={`https://sepolia.mantlescan.xyz/tx/${payoutTx}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 text-verdigris-400 font-mono text-xs hover:underline"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                Payout Tx: {payoutTx.slice(0, 14)}...{payoutTx.slice(-10)}
              </a>
            )}
            {agent && (
              <span className="text-zinc-500 font-mono text-xs">
                Agent: {agent.slice(0, 14)}...{agent.slice(-10)}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Findings list */}
      {loading ? (
        <div className="text-zinc-500 text-sm">Loading findings...</div>
      ) : findings.length === 0 ? (
        <div className="text-zinc-500 text-sm">No findings for this contract.</div>
      ) : (
        <div className="space-y-6">
          {findings.map((f, i) => {
            const c = severityColors(f.severity);
            return (
              <div key={f.id} className={`rounded-2xl border bg-zinc-900/30 ${c.border} overflow-hidden`}>
                <div className={`h-1 w-full ${c.bar}`} />
                <div className="p-6 space-y-5">
                  {/* Title row */}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-xs font-mono text-zinc-600">#{i + 1}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase border ${c.badge}`}>{f.severity}</span>
                        {f.category && (
                          <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-400 font-mono">{f.category}</span>
                        )}
                      </div>
                      <h2 className="text-base font-bold text-zinc-100">{f.title || "Vulnerability"}</h2>
                    </div>
                  </div>

                  {/* Description */}
                  {f.description && (
                    <div>
                      <h3 className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-2">Description</h3>
                      <p className="text-zinc-300 text-sm leading-relaxed">{f.description}</p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    {/* PoC */}
                    {f.pocSketch && (
                      <div>
                        <h3 className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-2">PoC Sketch</h3>
                        <pre className="text-zinc-400 text-xs italic leading-relaxed font-mono bg-ash/60 p-3 rounded-lg border border-zinc-800 whitespace-pre-wrap">{f.pocSketch}</pre>
                      </div>
                    )}

                    {/* Remediation */}
                    {f.remediation && (
                      <div>
                        <h3 className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-2">Remediation</h3>
                        <pre className="text-zinc-300 text-xs leading-relaxed font-mono bg-ash/60 p-3 rounded-lg border border-zinc-800 whitespace-pre-wrap">{f.remediation}</pre>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
