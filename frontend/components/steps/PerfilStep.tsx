"use client";

import { ArrowRight } from "lucide-react";
import { PerfilData } from "@/lib/types";

const TOLERANCE_OPTIONS = [
  { label: "Prefiro segurança, mesmo com retorno menor", desc: "Perder dinheiro me incomoda mais do que deixar de ganhar." },
  { label: "Aceito alguma oscilação por um retorno melhor", desc: "Tolero ver o saldo cair no curto prazo, se fizer sentido a longo prazo." },
  { label: "Busco maximizar retorno e tolero perdas temporárias", desc: "Estou disposto a correr risco relevante por ganho maior." },
];

const HORIZON_OPTIONS = [
  { label: "Menos de 1 ano", desc: "Posso precisar desse dinheiro em breve." },
  { label: "Entre 1 e 3 anos", desc: "Não é urgente, mas não é de longuíssimo prazo." },
  { label: "Mais de 3 anos", desc: "Não tenho previsão de precisar mexer nisso." },
];

function QuestionCard({
  option,
  selected,
  onClick,
}: {
  option: { label: string; desc: string };
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="flex cursor-pointer gap-4 rounded-md border-[1.5px] p-5"
      style={{ borderColor: selected ? "#2f5d43" : "#e1ded4", background: selected ? "#eaf1ec" : "#ffffff" }}
    >
      <div
        className="mt-0.5 h-5 w-5 shrink-0 rounded-full box-border"
        style={{ border: selected ? "5px solid #2f5d43" : "1.5px solid #e1ded4" }}
      />
      <div>
        <div className="text-[15px] font-semibold mb-1">{option.label}</div>
        <div className="text-[13.5px] text-lastro-muted leading-snug">{option.desc}</div>
      </div>
    </div>
  );
}

export default function PerfilStep({
  data,
  onChange,
  onBack,
  onNext,
}: {
  data: PerfilData;
  onChange: (patch: Partial<PerfilData>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const question = data.toleranceAnswer === null ? 1 : 2;
  const options = question === 1 ? TOLERANCE_OPTIONS : HORIZON_OPTIONS;
  const selected = question === 1 ? data.toleranceAnswer : data.horizonAnswer;
  const headline = question === 1 ? "Qual dessas frases mais se parece com você?" : "Em quanto tempo você pode precisar desse dinheiro?";

  function select(i: number) {
    if (question === 1) onChange({ toleranceAnswer: i });
    else onChange({ horizonAnswer: i });
  }

  function handleNext() {
    if (question === 1) return; // avança sozinho ao responder a 1ª pergunta
    onNext();
  }

  // Ao escolher a 1ª pergunta, avança automaticamente pra 2ª (não precisa de
  // um clique extra em "continuar" no meio do questionário).
  function handleSelect(i: number) {
    select(i);
  }

  return (
    <div className="flex justify-center px-10 py-24">
      <div className="w-full max-w-[600px]">
        <div className="text-xs font-semibold uppercase tracking-wide text-lastro-muted mb-3.5">Pergunta {question} de 2</div>
        <div className="flex gap-1.5 mb-10">
          <div className="h-[3px] flex-1 rounded-full" style={{ background: "#2f5d43" }} />
          <div className="h-[3px] flex-1 rounded-full" style={{ background: question >= 2 ? "#2f5d43" : "#e1ded4" }} />
        </div>

        <h1 className="font-serif text-[32px] font-normal leading-snug mb-3">{headline}</h1>
        <p className="text-[15px] text-lastro-muted mb-9">Não existe resposta certa — isso ajuda a entender o que sua carteira deveria priorizar.</p>

        <div className="flex flex-col gap-3 mb-12">
          {options.map((opt, i) => (
            <QuestionCard key={opt.label} option={opt} selected={selected === i} onClick={() => handleSelect(i)} />
          ))}
        </div>

        <div className="flex items-center justify-between">
          <button
            className="text-sm font-medium text-lastro-muted"
            onClick={() => (question === 1 ? onBack() : onChange({ toleranceAnswer: null }))}
          >
            ← Voltar
          </button>
          <button className="btn-primary" disabled={selected === null || question === 1} onClick={handleNext}>
            Continuar
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
