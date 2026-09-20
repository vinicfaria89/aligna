import type { Metadata } from "next";
import PortfolioCsvResolver from "@/components/PortfolioCsvResolver";

export const metadata: Metadata = {
  title: "Aligna — Resolver carteira (CSV)",
};

/**
 * First AIE screen (TASK-025). All behavior lives in the client component; this
 * page only frames it. Requires an authenticated account with batch access: the
 * server decides (401/403), never this page.
 */
export default function CarteiraPage() {
  return (
    <div className="flex min-h-screen justify-center px-6 py-16 md:px-10 md:py-24">
      <div className="w-full max-w-[960px]">
        <h1 className="mb-2.5 font-serif text-3xl font-extrabold tracking-tight">Resolver carteira</h1>
        <p className="mb-9 text-[15px] leading-relaxed text-aligna-muted">
          Envie um CSV com os ativos da sua carteira e veja quais o Aligna consegue identificar com
          evidências de fontes oficiais, e o que ainda precisa de confirmação.
        </p>
        <PortfolioCsvResolver />
      </div>
    </div>
  );
}
