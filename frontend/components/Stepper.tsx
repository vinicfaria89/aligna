import { Check } from "lucide-react";

export type StepKey = "intro" | "perfil" | "extratos" | "confirmacao" | "relatorio";

const STEPS: { key: StepKey; label: string }[] = [
  { key: "intro", label: "Seus dados" },
  { key: "perfil", label: "Perfil de risco" },
  { key: "extratos", label: "Extratos" },
  { key: "confirmacao", label: "Confirmação" },
  { key: "relatorio", label: "Relatório" },
];

export default function Stepper({ current }: { current: StepKey }) {
  const currentIndex = STEPS.findIndex((s) => s.key === current);

  return (
    <div className="w-[272px] shrink-0 bg-lastro-deep px-8 py-10 flex flex-col">
      <div className="flex items-center gap-2.5 mb-14">
        <svg width="24" height="24" viewBox="0 0 26 26">
          <path
            d="M13 1 L24 7 V16 C24 21.2 19 24.6 13 25.3 C7 24.6 2 21.2 2 16 V7 Z"
            fill="none"
            stroke="#b08a3e"
            strokeWidth="1.3"
          />
          <text x="13" y="17.5" textAnchor="middle" fontFamily="serif" fontSize="12" fill="#f3efe6">
            L
          </text>
        </svg>
        <span className="font-serif text-xl text-lastro-cream">Lastro</span>
      </div>

      <div className="relative flex flex-col gap-7">
        <div className="absolute left-[13px] top-3.5 bottom-3.5 w-[1.5px] bg-white/10" />
        {STEPS.map((step, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <div key={step.key} className="relative flex items-center gap-3.5">
              <div
                className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-[1.5px] box-border"
                style={{
                  background: done ? "#b08a3e" : active ? "#3c7856" : "transparent",
                  borderColor: done || active ? "transparent" : "rgba(255,255,255,0.3)",
                }}
              >
                {done ? (
                  <Check size={13} strokeWidth={3} color="#12241c" />
                ) : (
                  <span className="text-xs font-semibold" style={{ color: active ? "#12241c" : "rgba(255,255,255,0.55)" }}>
                    {i + 1}
                  </span>
                )}
              </div>
              <span
                className="text-sm"
                style={{
                  fontWeight: active ? 600 : 500,
                  color: active ? "#f3efe6" : "rgba(255,255,255,0.55)",
                }}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      <div className="mt-auto rounded-md border border-white/10 bg-white/5 p-4 text-xs leading-relaxed text-white/60">
        Não conectamos na sua conta em nenhum banco. Você só envia o arquivo — nada além disso.
      </div>
    </div>
  );
}
