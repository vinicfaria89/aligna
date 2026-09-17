"use client";

import { ArrowRight } from "lucide-react";
import { PerfilData } from "@/lib/types";

interface QuestionOption {
  label: string;
  desc: string;
}

interface QuestionDef {
  key: "toleranceAnswer" | "horizonAnswer" | "sucessaoAnswer" | "governancaAnswer";
  headline: string;
  options: QuestionOption[];
}

// Ordem importa: cada pergunta só aparece quando a anterior já tem resposta
// (ver `currentIndex` abaixo) -- perguntas de sucessão/governança são novas
// (critério "Sucessão e governança" do Score v1, ver lib/report.ts), sem
// resposta certa, só descrevem a estrutura do patrimônio pra além da
// alocação dos ativos.
const QUESTIONS: QuestionDef[] = [
  {
    key: "toleranceAnswer",
    headline: "Qual dessas frases mais se parece com você?",
    options: [
      { label: "Prefiro segurança, mesmo com retorno menor", desc: "Perder dinheiro me incomoda mais do que deixar de ganhar." },
      { label: "Aceito alguma oscilação por um retorno melhor", desc: "Tolero ver o saldo cair no curto prazo, se fizer sentido a longo prazo." },
      { label: "Busco maximizar retorno e tolero perdas temporárias", desc: "Estou disposto a correr risco relevante por ganho maior." },
    ],
  },
  {
    key: "horizonAnswer",
    headline: "Em quanto tempo você pode precisar desse dinheiro?",
    options: [
      { label: "Menos de 1 ano", desc: "Posso precisar desse dinheiro em breve." },
      { label: "Entre 1 e 3 anos", desc: "Não é urgente, mas não é de longuíssimo prazo." },
      { label: "Mais de 3 anos", desc: "Não tenho previsão de precisar mexer nisso." },
    ],
  },
  {
    key: "sucessaoAnswer",
    headline: "Se algo acontecesse com você hoje, sua família saberia onde estão seus ativos e a quem procurar?",
    options: [
      { label: "Sim, está tudo documentado e organizado", desc: "Minha família sabe onde procurar e com quem falar." },
      { label: "Só parcialmente", desc: "Só uma pessoa sabe, ou está incompleto." },
      { label: "Não, nada disso está registrado", desc: "Ninguém além de mim saberia por onde começar." },
    ],
  },
  {
    key: "governancaAnswer",
    headline: "Sua carteira segue uma política de investimento clara e documentada?",
    options: [
      { label: "Sim, tenho uma estratégia definida", desc: "Reviso periodicamente o que comprar, quanto e por quê." },
      { label: "Tenho uma ideia geral, mas não documentada", desc: "Sei mais ou menos o que quero, sem registrar formalmente." },
      { label: "Invisto conforme a oportunidade aparece", desc: "Não sigo uma lógica central definida com antecedência." },
    ],
  },
];

function QuestionCard({
  option,
  selected,
  onClick,
}: {
  option: QuestionOption;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className="flex cursor-pointer gap-4 rounded-xl border-[1.5px] p-5 transition-colors"
      style={{ borderColor: selected ? "#1c8a4f" : "#dcece1", background: selected ? "#d9f5e2" : "#ffffff" }}
    >
      <div
        className="mt-0.5 h-5 w-5 shrink-0 rounded-full box-border"
        style={{ border: selected ? "5px solid #1c8a4f" : "1.5px solid #dcece1" }}
      />
      <div>
        <div className="text-[15px] font-semibold mb-1">{option.label}</div>
        <div className="text-[13.5px] text-aligna-muted leading-snug">{option.desc}</div>
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
  const idx = QUESTIONS.findIndex((q) => data[q.key] === null);
  const currentIndex = idx === -1 ? QUESTIONS.length - 1 : idx;
  const isLast = currentIndex === QUESTIONS.length - 1;
  const question = QUESTIONS[currentIndex];
  const selected = data[question.key];

  function handleSelect(i: number) {
    onChange({ [question.key]: i });
  }

  function handleBack() {
    if (currentIndex === 0) {
      onBack();
      return;
    }
    onChange({ [QUESTIONS[currentIndex - 1].key]: null });
  }

  function handleNext() {
    if (!isLast) return; // avança sozinho ao responder cada pergunta
    onNext();
  }

  return (
    <div className="flex justify-center px-10 py-24">
      <div className="w-full max-w-[600px]">
        <div className="text-xs font-semibold uppercase tracking-wide text-aligna-muted mb-3.5">
          Pergunta {currentIndex + 1} de {QUESTIONS.length}
        </div>
        <div className="flex gap-1.5 mb-10">
          {QUESTIONS.map((q, i) => (
            <div key={q.key} className="h-[3px] flex-1 rounded-full" style={{ background: i <= currentIndex ? "#1c8a4f" : "#dcece1" }} />
          ))}
        </div>

        <h1 className="font-serif text-[32px] font-extrabold tracking-tight leading-snug mb-3">{question.headline}</h1>
        <p className="text-[15px] text-aligna-muted mb-9">Não existe resposta certa — isso ajuda a entender o que sua carteira deveria priorizar.</p>

        <div className="flex flex-col gap-3 mb-12">
          {question.options.map((opt, i) => (
            <QuestionCard key={opt.label} option={opt} selected={selected === i} onClick={() => handleSelect(i)} />
          ))}
        </div>

        <div className="flex items-center justify-between">
          <button className="text-sm font-medium text-aligna-muted" onClick={handleBack}>
            ← Voltar
          </button>
          <button className="btn-primary" disabled={selected === null || !isLast} onClick={handleNext}>
            Continuar
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
