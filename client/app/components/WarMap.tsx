"use client";

import { useEffect, useRef } from "react";

interface WarMapProps {
  /** total monitored targets (falls back to a representative set when 0) */
  targets: number;
  /** open / unresolved vulnerabilities → blood nodes */
  open: number;
  /** verified & secured targets → verdigris nodes */
  secured: number;
}

type State = "bronze" | "blood" | "win";
const COL: Record<State, string> = { bronze: "#c8a24b", blood: "#d6402f", win: "#4a9e86" };

/**
 * Live campaign map: a pulsing bronze agent-core with target nodes distributed
 * around it, hunt-pulses travelling the lines, and a radar sweep. Node states
 * are derived from the real counts passed in. Canvas + rAF; renders a single
 * static frame under prefers-reduced-motion.
 */
export function WarMap({ targets, open, secured }: WarMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(devicePixelRatio || 1, 2);

    // Build node ring from real counts (representative fallback when API is down).
    const count = Math.max(6, Math.min(12, targets || 9));
    const openN = Math.min(open || 2, count);
    const winN = Math.min(secured || 3, count - openN);
    const nodes = Array.from({ length: count }, (_, i) => {
      const state: State = i < openN ? "blood" : i < openN + winN ? "win" : "bronze";
      // deterministic scatter so the map is stable across renders
      const a = (i / count) * 360 + (i % 2 ? 14 : -12);
      const r = 0.6 + ((i * 37) % 40) / 100;
      return { a, r, state };
    });

    // A couple of DOM labels pinned to notable nodes.
    const bloodIdx = nodes.findIndex((n) => n.state === "blood");
    const winIdx = nodes.findIndex((n) => n.state === "win");
    const labels: { i: number; t: string; c: string }[] = [];
    if (bloodIdx >= 0) labels.push({ i: bloodIdx, t: "REENTRANCY", c: "hot" });
    if (winIdx >= 0) labels.push({ i: winIdx, t: "SECURED", c: "win" });
    const labelEls = labels.map((l) => {
      const e = document.createElement("div");
      e.className = "warmap-label " + l.c;
      e.textContent = l.t;
      wrap.appendChild(e);
      return e;
    });

    let W = 0, H = 0;
    const pos = (n: { a: number; r: number }) => {
      const cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 18;
      const rad = (n.a * Math.PI) / 180;
      return { x: cx + Math.cos(rad) * R * n.r, y: cy + Math.sin(rad) * R * n.r };
    };
    const placeLabels = () =>
      labels.forEach((l, k) => {
        const p = pos(nodes[l.i]);
        labelEls[k].style.left = p.x + "px";
        labelEls[k].style.top = p.y - 16 + "px";
      });
    const resize = () => {
      const b = wrap.getBoundingClientRect();
      W = b.width; H = b.height;
      canvas.width = W * dpr; canvas.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      placeLabels();
    };

    const t0 = performance.now();
    let raf = 0;
    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2;

      if (!reduce) {
        const sweep = (t * 0.5) % (Math.PI * 2);
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, Math.min(W, H) / 2 - 14, sweep - 0.5, sweep);
        ctx.closePath();
        const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(W, H) / 2);
        rg.addColorStop(0, "rgba(200,162,75,.14)");
        rg.addColorStop(1, "rgba(200,162,75,0)");
        ctx.fillStyle = rg; ctx.fill(); ctx.restore();
      }

      nodes.forEach((n, i) => {
        const appear = reduce ? 1 : Math.max(0, Math.min(1, (t - 0.15 * i) / 0.5));
        if (appear <= 0) return;
        const p = pos(n), c = COL[n.state];
        ctx.globalAlpha = appear * 0.5;
        ctx.strokeStyle = "rgba(58,55,51,.9)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y); ctx.stroke();
        if (!reduce) {
          const tp = (t * 0.6 + i * 0.3) % 1;
          const hx = cx + (p.x - cx) * tp, hy = cy + (p.y - cy) * tp;
          ctx.globalAlpha = appear * (1 - tp) * 0.9;
          ctx.fillStyle = c; ctx.beginPath(); ctx.arc(hx, hy, 1.6, 0, 7); ctx.fill();
        }
        const pulse = n.state === "blood" && !reduce
          ? 0.6 + 0.4 * Math.sin(t * 3 + i)
          : n.state === "win" ? 0.95 : 0.7;
        ctx.globalAlpha = appear;
        ctx.fillStyle = c; ctx.shadowColor = c; ctx.shadowBlur = n.state === "bronze" ? 6 : 14 * pulse;
        ctx.beginPath(); ctx.arc(p.x, p.y, n.state === "bronze" ? 2.6 : 3.6, 0, 7); ctx.fill();
        ctx.shadowBlur = 0;
        if (n.state !== "bronze") {
          ctx.globalAlpha = appear * pulse * 0.6; ctx.strokeStyle = c; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 7); ctx.stroke();
        }
      });

      ctx.globalAlpha = 1;
      const cp = reduce ? 1 : 0.7 + 0.3 * Math.sin(t * 2);
      ctx.strokeStyle = "rgba(200,162,75," + 0.5 * cp + ")"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(cx, cy, 16 + cp * 4, 0, 7); ctx.stroke();
      ctx.strokeStyle = "rgba(200,162,75,.25)";
      ctx.beginPath(); ctx.arc(cx, cy, 26, 0, 7); ctx.stroke();
      ctx.fillStyle = "#c8a24b"; ctx.shadowColor = "#c8a24b"; ctx.shadowBlur = 20 * cp;
      ctx.beginPath(); ctx.arc(cx, cy, 5.5, 0, 7); ctx.fill(); ctx.shadowBlur = 0;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = "#1a1206"; ctx.lineWidth = 1.4; ctx.strokeRect(-3, -3, 6, 6); ctx.restore();

      if (!reduce) raf = requestAnimationFrame(draw);
    };

    resize();
    addEventListener("resize", resize);
    if (reduce) draw(performance.now());
    else raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
      labelEls.forEach((e) => e.remove());
    };
  }, [targets, open, secured]);

  return (
    <div ref={wrapRef} className="relative w-full aspect-square max-w-[520px] mx-auto">
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}
