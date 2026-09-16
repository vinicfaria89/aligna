"use client";

import { useEffect, useState } from "react";
import Stepper, { StepKey } from "@/components/Stepper";
import IntroStep from "@/components/steps/IntroStep";
import PerfilStep from "@/components/steps/PerfilStep";
import ExtratosStep from "@/components/steps/ExtratosStep";
import ConfirmacaoStep from "@/components/steps/ConfirmacaoStep";
import RelatorioStep from "@/components/steps/RelatorioStep";
import AssinaturaConfirmadaStep from "@/components/steps/AssinaturaConfirmadaStep";
import { ApiError, extractStatements } from "@/lib/api";
import { ExtractedAsset, PerfilData, UploadedFile } from "@/lib/types";

const EMPTY_PERFIL: PerfilData = {
  full_name: "",
  email: "",
  password: "",
  birth_date: "",
  toleranceAnswer: null,
  horizonAnswer: null,
};

export default function AlignaApp() {
  const [screen, setScreen] = useState<StepKey>("intro");
  const [perfil, setPerfil] = useState<PerfilData>(EMPTY_PERFIL);
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [assets, setAssets] = useState<ExtractedAsset[]>([]);
  const [extracting, setExtracting] = useState(false);
  const [extractionError, setExtractionError] = useState<string | null>(null);
  const [assinaturaConfirmada, setAssinaturaConfirmada] = useState(false);

  // Volta do Checkout hospedado da Stripe (ver success_url/cancel_url em
  // billing_service.py). O wizard não persiste estado em lugar nenhum, então
  // ao sair pra Stripe e voltar, perfil/extratos já se perderam -- só dá pra
  // reagir ao "?assinatura=sucesso|cancelada" da URL, nunca retomar o resto.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const assinatura = params.get("assinatura");
    if (assinatura === "sucesso") setAssinaturaConfirmada(true);
    if (assinatura) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  function updatePerfil(patch: Partial<PerfilData>) {
    setPerfil((prev) => ({ ...prev, ...patch }));
  }

  function updateAsset(id: string, patch: Partial<ExtractedAsset>) {
    setAssets((prev) => prev.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  }

  async function goToConfirmacao() {
    setScreen("confirmacao");
    setExtracting(true);
    setExtractionError(null);
    try {
      const extracted = await extractStatements(files);
      setAssets(extracted);
    } catch (err) {
      setAssets([]);
      setExtractionError(
        err instanceof ApiError ? err.message : "Não conseguimos ler os extratos agora. Tente de novo em instantes."
      );
    } finally {
      setExtracting(false);
    }
  }

  if (assinaturaConfirmada) {
    return (
      <div className="flex min-h-screen">
        <Stepper current="relatorio" />
        <div className="flex-1">
          <AssinaturaConfirmadaStep
            onReiniciar={() => {
              setAssinaturaConfirmada(false);
              setPerfil(EMPTY_PERFIL);
              setFiles([]);
              setAssets([]);
              setScreen("intro");
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Stepper current={screen} />
      <div className="flex-1">
        {screen === "intro" && <IntroStep data={perfil} onChange={updatePerfil} onNext={() => setScreen("perfil")} />}

        {screen === "perfil" && (
          <PerfilStep
            data={perfil}
            onChange={updatePerfil}
            onBack={() => setScreen("intro")}
            onNext={() => setScreen("extratos")}
          />
        )}

        {screen === "extratos" && (
          <ExtratosStep files={files} onFilesChange={setFiles} onBack={() => setScreen("perfil")} onNext={goToConfirmacao} />
        )}

        {screen === "confirmacao" && (
          <ConfirmacaoStep
            loading={extracting}
            error={extractionError}
            onRetry={goToConfirmacao}
            assets={assets}
            onUpdateAsset={updateAsset}
            onBack={() => setScreen("extratos")}
            onNext={() => setScreen("relatorio")}
          />
        )}

        {screen === "relatorio" && <RelatorioStep perfil={perfil} assets={assets} />}
      </div>
    </div>
  );
}
