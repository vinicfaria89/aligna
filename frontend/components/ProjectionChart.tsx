import { Projection } from "@/lib/projection";

function formatCompactBRL(value: number): string {
  if (value >= 1_000_000) return `R$ ${(value / 1_000_000).toFixed(1).replace(".", ",")} mi`;
  if (value >= 1_000) return `R$ ${(value / 1_000).toFixed(0)} mil`;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export default function ProjectionChart({ projection }: { projection: Projection }) {
  const width = 640;
  const height = 240;
  const padX = 36;
  const padY = 20;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const maxValue = Math.max(...projection.points.map((p) => Math.max(p.atual, p.referencia)));

  function x(year: number): number {
    return padX + (year / projection.horizonYears) * innerW;
  }
  function y(value: number): number {
    return padY + innerH - (value / maxValue) * innerH;
  }

  const pathAtual = projection.points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.year)} ${y(p.atual)}`).join(" ");
  const pathReferencia = projection.points
    .map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.year)} ${y(p.referencia)}`)
    .join(" ");

  const gridValues = [0, maxValue * 0.25, maxValue * 0.5, maxValue * 0.75, maxValue];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label="Projeção de patrimônio: alocação atual vs. referência do perfil"
    >
      {gridValues.map((v) => {
        const yy = y(v);
        return (
          <g key={v}>
            <line x1={padX} y1={yy} x2={width - padX} y2={yy} stroke="#dcece1" strokeWidth={1} />
            <text x={2} y={yy + 3} fontSize={9} fill="#5a6e63">
              {formatCompactBRL(v)}
            </text>
          </g>
        );
      })}

      <path d={pathReferencia} fill="none" stroke="#c08a2e" strokeWidth={2} strokeDasharray="5 4" strokeLinecap="round" />
      <path d={pathAtual} fill="none" stroke="#1c8a4f" strokeWidth={2.5} strokeLinecap="round" />

      {[0, projection.horizonYears].map((year) => (
        <text key={year} x={x(year)} y={height - 3} fontSize={9} fill="#5a6e63" textAnchor={year === 0 ? "start" : "end"}>
          {year === 0 ? "hoje" : `${year} anos`}
        </text>
      ))}
    </svg>
  );
}
