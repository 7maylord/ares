/**
 * Ares brand mark — "Aegis": a heraldic shield with a war-spear and a blood core.
 * Pure SVG, monochrome-safe, scales from favicon to hero. Colors are fixed to the
 * forge palette so the mark holds on any ground.
 */
export function AresMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="none" role="img" aria-label="Ares">
      <path
        d="M50 6 L86 20 V50 Q86 78 50 94 Q14 78 14 50 V20 Z"
        fill="none"
        stroke="#c8a24b"
        strokeWidth={4.5}
        strokeLinejoin="round"
      />
      <path d="M50 24 L57 40 L52 40 L52 68 L48 68 L48 40 L43 40 Z" fill="#c8a24b" />
      <rect x={34} y={44} width={32} height={4} rx={1} fill="#c8a24b" />
      <circle cx={50} cy={46} r={3} fill="#d6402f" />
    </svg>
  );
}
