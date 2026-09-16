import { ScoreSnapshot } from "@/lib/types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export default function ScoreHistoryChart({ snapshots }: { snapshots: ScoreSnapshot[] }) {
  const width = 560;
  const height = 200;
  const padX = 28;
  const padY = 20;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const points = snapshots.map((s, i) => {
    const x = padX + (snapshots.length > 1 ? (i / (snapshots.length - 1)) * innerW : innerW / 2);
    const y = padY + innerH - (s.score_total / 100) * innerH;
    return { x, y, s };
  });

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Evolução do Score Aligna ao longo do tempo">
      {[0, 40, 70, 100].map((v) => {
        const y = padY + innerH - (v / 100) * innerH;
        return (
          <g key={v}>
            <line x1={padX} y1={y} x2={width - padX} y2={y} stroke="#dcece1" strokeWidth={1} />
            <text x={2} y={y + 3} fontSize={9} fill="#5a6e63">
              {v}
            </text>
          </g>
        );
      })}
      <path d={path} fill="none" stroke="#1c8a4f" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={4.5} fill="#1c8a4f" stroke="white" strokeWidth={1.5} />
          <text x={p.x} y={height - 3} fontSize={9} fill="#5a6e63" textAnchor="middle">
            {formatDate(p.s.created_at)}
          </text>
        </g>
      ))}
    </svg>
  );
}
