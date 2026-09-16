"use client";

import { CheckCircle2 } from "lucide-react";

/**
 * Tela que recebe o usuário de volta do Checkout hospedado da Stripe
 * (success_url em app/services/billing_service.py, backend). O app não
 * persiste o estado do wizard em lugar nenhum hoje -- ao sair pra Stripe e
 * voltar, perfil/extratos/relatório já não existem mais em memória. Em vez
 * de fingir que consegue retomar de onde parou, esta tela é honesta sobre
 * isso: confirma a assinatura e manda a pessoa pro lugar certo (login no
 * Planejador Financeiro, mesma conta que o diagnóstico já criou).
 */
export default function AssinaturaConfirmadaStep({ onReiniciar }: { onReiniciar: () => void }) {
  return (
    <div className="flex justify-center px-10 py-24">
      <div className="w-full max-w-[480px] text-center">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-aligna-pale text-aligna-deep">
          <CheckCircle2 size={26} />
        </div>
        <h1 className="font-serif font-extrabold tracking-tight text-3xl mb-2.5">Assinatura confirmada</h1>
        <p className="text-[15px] text-aligna-muted leading-relaxed mb-9">
          Seu Aligna Premium está ativo. Faça login com o e-mail e a senha que você definiu no diagnóstico para ver o
          relatório completo e continuar seu planejamento.
        </p>
        <button className="btn-primary" onClick={onReiniciar}>
          Fazer um novo diagnóstico
        </button>
      </div>
    </div>
  );
}
