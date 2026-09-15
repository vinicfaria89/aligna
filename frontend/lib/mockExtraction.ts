import { ExtractedAsset, UploadedFile } from "./types";

/**
 * Substituto temporário da extração por IA. Nesta primeira fatia do produto
 * (ver decisão da sessão: "começar pelo frontend, extração por IA mockada
 * depois") isto simula o que viria de uma chamada real à API da Claude lendo
 * o PDF/print de cada arquivo — mesmo formato de saída (ExtractedAsset[]),
 * pra trocar por uma chamada real sem mexer em mais nada do fluxo.
 */
export async function mockExtractAssets(files: UploadedFile[]): Promise<ExtractedAsset[]> {
  await new Promise((resolve) => setTimeout(resolve, 1400));

  const templates: Omit<ExtractedAsset, "id" | "institution">[] = [
    { name: "Tesouro Selic 2029", category: "tesouro", value: 18000, liquidity: "diaria", indexer: "Selic + 0,05%", confidence: "ok" },
    { name: "CDB pós-fixado", category: "cdb", value: 32000, liquidity: "no_vencimento", indexer: "95% do CDI", maturity_date: "2027-11-10", confidence: "ok" },
    { name: "CRI incentivado", category: "cri", value: 21000, liquidity: "no_vencimento", indexer: "IPCA + 6,50%", maturity_date: "2029-06-15", confidence: "verificar" },
    { name: "Ações (carteira)", category: "acoes", value: 15000, liquidity: "diaria", indexer: "—", confidence: "ok" },
  ];

  return files.flatMap((file, fileIndex) => {
    const t = templates[fileIndex % templates.length];
    return [
      {
        ...t,
        id: `${file.id}-${fileIndex}`,
        institution: file.institutionGuess,
      },
    ];
  });
}
