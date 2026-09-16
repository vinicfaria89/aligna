const PALETTE = ["#1c8a4f", "#22a35e", "#0f5c33", "#8fe0ab", "#34c072", "#5a6e63"];

export interface DonutSlice {
  label: string;
  value: number;
  pct: number;
}

export default function Donut({ slices, centerBig, centerSmall }: { slices: DonutSlice[]; centerBig: string; centerSmall: string }) {
  let acc = 0;
  const stops = slices.map((s, i) => {
    const start = acc;
    acc += s.pct;
    return `${PALETTE[i % PALETTE.length]} ${start}% ${acc}%`;
  });

  return (
    <div className="flex items-center gap-8 flex-wrap">
      <div
        className="flex h-[168px] w-[168px] shrink-0 items-center justify-center rounded-full"
        style={{ background: slices.length > 0 ? `conic-gradient(${stops.join(", ")})` : "#dcece1" }}
      >
        <div className="flex h-[108px] w-[108px] flex-col items-center justify-center rounded-full bg-aligna-card text-center">
          <div className="font-serif font-extrabold text-lg">{centerBig}</div>
          <div className="mt-0.5 max-w-[88px] text-[10px] leading-tight text-aligna-muted">{centerSmall}</div>
        </div>
      </div>
      <div className="flex min-w-[220px] flex-1 flex-col gap-0.5">
        {slices.map((s, i) => (
          <div key={s.label} className="flex items-center justify-between gap-2.5 px-2.5 py-2">
            <div className="flex items-center gap-2.5 text-[13px] font-medium">
              <div className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: PALETTE[i % PALETTE.length] }} />
              {s.label}
            </div>
            <div className="text-[13px] font-semibold">{s.pct.toFixed(1)}%</div>
          </div>
        ))}
      </div>
    </div>
  );
}
