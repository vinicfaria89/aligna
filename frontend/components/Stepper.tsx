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
    <div className="print-hide w-[272px] shrink-0 bg-aligna-deep px-8 py-10 flex flex-col">
      <div className="flex items-center gap-2.5 mb-14">
        <div className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px]" style={{ background: "linear-gradient(135deg, #34c072, #0f5c33)" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 19 12 4 19 19" />
            <path d="M8 14h8" />
            <circle cx="12" cy="14" r="1.6" fill="#22a35e" stroke="white" strokeWidth="1" />
          </svg>
        </div>
        <span className="font-serif font-extrabold text-xl tracking-tight text-white">Aligna</span>
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
                  background: done ? "#34c072" : active ? "#22a35e" : "transparent",
                  borderColor: done || active ? "transparent" : "rgba(255,255,255,0.3)",
                }}
              >
                {done ? (
                  <Check size={13} strokeWidth={3} color="#0f2318" />
                ) : (
                  <span className="text-xs font-semibold" style={{ color: active ? "#0f2318" : "rgba(255,255,255,0.55)" }}>
                    {i + 1}
                  </span>
                )}
              </div>
              <span
                className="text-sm"
                style={{
                  fontWeight: active ? 700 : 500,
                  color: active ? "#ffffff" : "rgba(255,255,255,0.55)",
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
