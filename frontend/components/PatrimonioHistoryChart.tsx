import { ScoreSnapshot } from "@/lib/types";

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function formatCompactBRL(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1).replace(".", ",")} mi`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(0)} mil`;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function PatrimonioHistoryChart({ snapshots }: { snapshots: ScoreSnapshot[] }) {
  const width = 560;
  const height = 200;
  const padX = 44;
  const padY = 20;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const maxValue = Math.max(...snapshots.map((s) => s.patrimonio_total), 1);

  const points = snapshots.map((s, i) => {
    const x = padX + (snapshots.length > 1 ? (i / (snapshots.length - 1)) * innerW : innerW / 2);
    const y = padY + innerH - (s.patrimonio_total / maxValue) * innerH;
    return { x, y, s };
  });

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  const gridValues = [0, maxValue * 0.25, maxValue * 0.5, maxValue * 0.75, maxValue];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label="Evolução do patrimônio analisado ao longo do tempo">
      {gridValues.map((v) => {
        const y = padY + innerH - (v / maxValue) * innerH;
        return (
          <g key={v}>
            <line x1={padX} y1={y} x2={width - padX} y2={y} stroke="#dcece1" strokeWidth={1} />
            <text x={2} y={y + 3} fontSize={9} fill="#5a6e63">
              {formatCompactBRL(v)}
            </text>
          </g>
        );
      })}
      <path d={path} fill="none" stroke="#c08a2e" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r={4.5} fill="#c08a2e" stroke="white" strokeWidth={1.5} />
          <text x={p.x} y={height - 3} fontSize={9} fill="#5a6e63" textAnchor="middle">
            {formatDate(p.s.created_at)}
          </text>
        </g>
      ))}
    </svg>
  );
}
