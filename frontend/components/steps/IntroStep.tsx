"use client";

import { ArrowRight } from "lucide-react";

// Conta (nome/e-mail/senha) só é pedida no fim, no momento em que a pessoa
// decide agir (ver o formulário embutido em RelatorioStep) -- mesmo padrão
// da Empower, que só pede cadastro depois de mostrar a recomendação
// personalizada. Aqui não pedimos nada, só situamos o que vem a seguir.
export default function IntroStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex justify-center px-10 py-24">
      <div className="w-full max-w-[520px]">
        <h1 className="font-serif font-extrabold tracking-tight text-3xl mb-2.5">Vamos analisar sua carteira</h1>
        <p className="text-[15px] text-aligna-muted leading-relaxed mb-9">
          Algumas perguntas sobre seu perfil, os ativos que você já tem, e pronto — seu diagnóstico aparece na hora.
          Não pedimos conta nem nada além disso até você decidir continuar.
        </p>

        <div className="mb-10 flex flex-col gap-2.5 text-[13.5px] text-aligna-muted">
          <div>✓ 4 perguntas rápidas sobre perfil e organização patrimonial</div>
          <div>✓ Envie extratos ou digite seus ativos na mão — do jeito que for mais rápido</div>
          <div>✓ Score, projeção e pontos de atenção na hora, sem cadastro</div>
        </div>

        <div className="flex items-center justify-between">
          <a href="/evolucao" className="text-sm font-medium text-aligna-muted hover:text-aligna-ink">
            Já tenho conta — ver minha evolução
          </a>
          <button className="btn-primary" onClick={onNext}>
            Começar
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
