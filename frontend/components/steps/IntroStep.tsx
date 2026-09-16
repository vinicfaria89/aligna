"use client";

import { ArrowRight } from "lucide-react";
import { PerfilData } from "@/lib/types";

export default function IntroStep({
  data,
  onChange,
  onNext,
}: {
  data: PerfilData;
  onChange: (patch: Partial<PerfilData>) => void;
  onNext: () => void;
}) {
  const valid = data.full_name.trim().length > 0 && data.email.includes("@") && data.password.length >= 8 && data.birth_date;

  return (
    <div className="flex justify-center px-10 py-24">
      <div className="w-full max-w-[520px]">
        <h1 className="font-serif font-extrabold tracking-tight text-3xl mb-2.5">Antes de começar</h1>
        <p className="text-[15px] text-aligna-muted leading-relaxed mb-9">
          É só pra criar sua conta — não pedimos nada além disso, e é a mesma conta que você usa depois pra ver seu
          planejamento completo.
        </p>

        <div className="flex flex-col gap-4 mb-10">
          <div>
            <label className="text-sm font-medium">Nome completo</label>
            <input
              className="input mt-1"
              value={data.full_name}
              onChange={(e) => onChange({ full_name: e.target.value })}
              autoFocus
            />
          </div>
          <div>
            <label className="text-sm font-medium">E-mail</label>
            <input className="input mt-1" type="email" value={data.email} onChange={(e) => onChange({ email: e.target.value })} />
          </div>
          <div>
            <label className="text-sm font-medium">Senha</label>
            <input
              className="input mt-1"
              type="password"
              minLength={8}
              value={data.password}
              onChange={(e) => onChange({ password: e.target.value })}
            />
            <p className="text-xs text-aligna-muted mt-1">Mínimo de 8 caracteres.</p>
          </div>
          <div>
            <label className="text-sm font-medium">Data de nascimento</label>
            <input
              className="input mt-1"
              type="date"
              value={data.birth_date}
              onChange={(e) => onChange({ birth_date: e.target.value })}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button className="btn-primary" disabled={!valid} onClick={onNext}>
            Continuar
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}
