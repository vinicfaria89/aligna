# TASK-058A — Diagnóstico e modelagem de Tesouro Direto

## Objetivo

Mapear, com fixtures e testes reais (não hipotéticos), como o resolver atual
(`lib/aie`) se comporta diante de entradas de Tesouro Direto, e propor
critérios conservadores para uma futura verificação — sem implementar nada
que verifique Tesouro nesta task. Esta é uma task diagnóstica e de
modelagem, não de implementação.

## Estado atual

`CandidateAssetType` (`lib/aie/contracts/candidate-asset.ts`) não tem
nenhum valor para título público / Tesouro Direto:

```ts
export type CandidateAssetType =
  | "stock" | "etf" | "fii" | "fund" | "debenture" | "cri" | "cra"
  | "cdb" | "lci" | "lca" | "coe" | "crypto" | "international" | "unknown";
```

Isso já era um achado da TASK-051A (duas fixtures, `TESOURO-SELIC` e
`TESOURO-IPCA`, ambas sem `expectedAssetType` por não haver onde
representá-las). A TASK-058A expandiu a bateria diagnóstica de Tesouro de
2 para 24 fixtures (22 novas), cobrindo nome com/sem vencimento, variações
de escrita e casos negativos — ver
`lib/aie/diagnostics/portfolio-resolution-quality.fixtures.ts` (categoria
`"treasury"`) e os testes correspondentes em
`lib/aie/diagnostics/portfolio-resolution-quality.diagnostic.test.ts`
(describe `"TASK-058A -- diagnóstico e modelagem de Tesouro Direto"`).

Confirmado pelos testes: **nenhuma** das 24 fixtures resolve como
`verified` hoje, em nenhuma das duas passagens do diagnóstico (baseline
sem providers, e com `B3ListedAssetProvider` — a wiring real de produção).
Nenhuma produz `wrong_type`, `wrong_code` ou `unexpected_error`. O
comportamento atual é seguro: Tesouro nunca vira falso positivo, só nunca
resolve.

## Casos observados

### Com vencimento no nome (candidatos possíveis para análise futura)

```
Tesouro Selic 2029
Tesouro Selic 2031
Tesouro IPCA+ 2035
Tesouro IPCA+ 2045
Tesouro IPCA+ com Juros Semestrais 2040
Tesouro Prefixado 2027
Tesouro Prefixado 2031
Tesouro Prefixado com Juros Semestrais 2035
```

Todos continuam `needs-more-evidence` nesta task, de propósito — ter um
ano no nome NÃO é tratado aqui como evidência suficiente por si só; é só
um sinal de que a entrada é mais específica que um nome de família.

## Casos aceitos para análise futura

Os oito casos "com vencimento" acima são os candidatos mais fortes para a
TASK-058B considerar: têm tipo (Selic/IPCA+/Prefixado), possivelmente
modalidade (Juros Semestrais) e um ano — o mínimo de estrutura que faria
sentido tentar mapear para um título específico, SE uma fonte confiável
(catálogo local mantido ou fonte primária oficial) confirmar a
correspondência.

## Casos ambíguos

Nome de família/programa, sem vencimento — não é um título específico:

```
Tesouro Selic
Tesouro IPCA+
Tesouro Prefixado
Tesouro Direto
Título Público
```

Proposta: estes NUNCA devem ser verificados como um título específico,
mesmo numa implementação futura — não há informação suficiente para saber
QUAL Tesouro Selic (qual vencimento) o usuário quis dizer.

## Casos negativos

Contêm a palavra "Tesouro" mas não são um título do Tesouro Direto —
risco de falso positivo se qualquer heurística baseada em substring for
usada como prova de identidade:

```
Fundo Tesouro Selic
ETF Tesouro Selic
Carteira Tesouro
CDB Tesouro Selic
LCI Tesouro IPCA
Renda Fixa Tesouro
```

Todos continuam `needs-more-evidence`, confirmado pelos testes. Nenhum
deles pode resolver como Tesouro Direto verificado em nenhuma
implementação futura — são fundos, ETFs, carteiras ou produtos bancários
com nome comercial parecido, não o título público em si.

### Variações de escrita (mesmo título, texto diferente)

```
tesouro selic 2029                          (minúsculas)
 TESOURO IPCA+ 2035                          (caixa alta + espaços extras)
Tesouro IPCA + 2035                          (espaço antes do "+")
Tesouro IPCA+ com juros semestrais 2040      ("com juros semestrais" minúsculo)
Tesouro Selic 2029 (LFT)                     (sufixo com a sigla do título)
```

Confirmado: nenhuma causa erro ou diagnóstico inesperado. Uma futura
normalização (trim + lowercase + colapsar espaços ao redor de "+") cobre
a maioria destes casos sem precisar de regex complexa.

## Critérios mínimos propostos para identidade

- **Sem vencimento, nunca verificar.** Um nome de família (`"Tesouro
  Selic"`) não identifica um título específico — é uma limitação de
  identidade, não de fonte de evidência. Nenhuma fonte externa resolveria
  essa ambiguidade, porque a ambiguidade está no dado de entrada, não na
  falta de busca.
- **Com tipo + indexador/modalidade + vencimento, é candidato.** Os oito
  casos "com vencimento" acima são o piso mínimo de estrutura para
  considerar uma tentativa de verificação futura.
- **Substring "Tesouro" nunca é prova de identidade.** Casos como `"Fundo
  Tesouro Selic"` ou `"CDB Tesouro Selic"` têm a palavra no nome mas são
  outra classe de ativo inteiramente — qualquer heurística baseada em
  "contém a palavra Tesouro" precisaria excluir explicitamente palavras
  como "Fundo", "ETF", "Carteira", "CDB", "LCI", "LCA" antes de sequer
  considerar o candidato, e mesmo assim isso seria só uma CANDIDATURA
  (para acionar um provider/busca), nunca evidência primária por si só.
- **Regex é só para normalização/candidatura, nunca para evidência.** Uma
  regex pode ajudar a normalizar `"IPCA +"` → `"IPCA+"` ou a decidir "isto
  parece um nome de Tesouro, vale a pena tentar resolver" — mas o
  resultado de um match de regex nunca deve, sozinho, elevar o status
  para `verified`. Isso repetiria o mesmo erro que a `VerificationPolicy`
  já evita para outros tipos de ativo (regra de evidência `primary`
  não-REGISTRY).
- **Verificação real exige fonte primária ou catálogo local explicitamente
  mantido**, com identidade suficiente (tipo + indexador + vencimento, no
  mínimo) — nunca inferência textual sozinha.

## Riscos de falso positivo

1. Substring "tesouro" capturando fundos/ETFs/produtos bancários com nome
   comercial parecido (mapeado acima, nos "casos negativos").
2. Nome de família sem vencimento sendo tratado como um título específico
   — ambiguidade de QUAL vencimento, não resolvível localmente.
3. Variação de escrita (espaço no "+", caixa, sufixo entre parênteses)
   quebrando um matcher ingênuo baseado em string exata, gerando
   `needs-more-evidence` incorreto para o caso "bom" ou, pior, um match
   parcial incorreto para outro título.
4. Confundir "tem um ano no nome" com "tem vencimento confirmado" — um ano
   solto no `rawName` não é uma data de vencimento validada contra uma
   fonte oficial.

## Proposta de tipo/categoria

Nenhum valor de `CandidateAssetType` cobre Tesouro Direto hoje. A
proposta (para a TASK-058B decidir, não implementada aqui) é adicionar um
valor `"treasury"` ao enum, na mesma família semântica de `"cdb"`/`"lci"`/
`"lca"` (renda fixa emitida por uma entidade, sem ticker de bolsa).

## Proposta de provider futuro

Modelado, **não implementado**:

- Nome provável: `TesouroDiretoProvider` (mesmo padrão de nomenclatura de
  `B3ListedAssetProvider`, `AnbimaDebentureProvider`).
- Fonte: catálogo local conservador (lista mantida manualmente, como o
  catálogo B3 já é) OU fonte primária oficial (ex.: API/arquivo público do
  Tesouro Direto), a decidir na TASK-058B — nenhuma das duas foi
  consultada ou codificada nesta task.
- Evidências que precisaria emitir: `identity` (qual título — tipo +
  indexador + vencimento) e `issuer` (Tesouro Nacional/emissor soberano),
  possivelmente `maturity` como evidência própria se a `VerificationPolicy`
  tratar isso separadamente — não investigado em profundidade aqui, fica
  para a TASK-058B revisar contra os padrões de evidência já existentes
  (`lib/aie/orchestrator`, `lib/aie/policy` — nomes de módulo por memória
  do projeto, confirmar exatos na TASK-058B).
- `strength: "primary"` só se a fonte cumprir o mesmo critério que
  `VerificationPolicy` já exige de qualquer provider primary hoje
  (evidência não-REGISTRY) — não deve ganhar uma exceção especial.

## Evidência necessária para verificação

No mínimo, para os oito casos "com vencimento": tipo do título (Selic /
IPCA+ / Prefixado), indexador implícito no tipo, modalidade (com/sem
juros semestrais) e o ano de vencimento — todos os quatro precisariam
bater contra a fonte escolhida antes de `verified`. Para os casos sem
vencimento: nenhuma evidência disponível torna isso suficiente, por
design (ambiguidade de qual título).

## O que permanece fora de escopo

- Implementar `TesouroDiretoProvider` ou qualquer inferência de Tesouro.
- Adicionar `"treasury"` ao `CandidateAssetType`.
- Alterar `VerificationPolicy`, o registry de providers, ou qualquer
  runtime do AIE.
- Consultar qualquer fonte externa (nenhuma API do Tesouro foi chamada
  nesta task; nenhuma fonte primária foi codificada).
- Qualquer mudança de UI, comparação de snapshots, exportação CSV,
  Planejador, endpoints, auth, auditoria, env ou dependencies.

## Recomendação para TASK-058B

1. Adicionar `"treasury"` a `CandidateAssetType`, sem mudar mais nada no
   mesmo commit.
2. Implementar `TesouroDiretoProvider` sobre um catálogo local
   conservador (mesmo padrão do `B3ListedAssetProvider`), cobrindo
   inicialmente só os oito padrões "com vencimento" mapeados aqui —
   deliberadamente reduzido, sem tentar cobrir os casos ambíguos ou
   negativos.
3. Adicionar candidatura por regex de NORMALIZAÇÃO apenas (nunca de
   evidência) para as variações de escrita mapeadas aqui (espaço no "+",
   caixa, sufixo entre parênteses).
4. Adicionar um guard explícito (lista de palavras excludentes: "Fundo",
   "ETF", "Carteira", "CDB", "LCI", "LCA") antes de considerar qualquer
   candidatura a Tesouro — espelhando os testes negativos já cobertos
   aqui.
5. Rodar a mesma bateria diagnóstica (`category === "treasury"`) como
   critério de aceite: os oito casos "com vencimento" devem passar a
   `resolved_expected`; todos os outros dezesseis (ambíguos, variações não
   cobertas pela normalização, negativos) devem continuar
   `needs_more_evidence_expected`, nunca `wrong_type`/`wrong_code`.

## Apêndice — decisão final da TASK-058B

A TASK-058B implementou exatamente a recomendação acima, sem desvios:

- `"treasury"` foi adicionado a `CandidateAssetType`
  (`lib/aie/contracts/candidate-asset.ts`), junto com `"TESOURO"` em
  `EvidenceSource` (`lib/aie/contracts/evidence.ts`) e `ResolutionSource`
  (`lib/aie/planner/resolution-plan.ts`) — necessários para o provider ter
  um `id`/fonte de evidência válidos, seguindo exatamente o padrão de
  `"B3"`.
- `TesouroDiretoProvider` (`lib/aie/providers/tesouro-direto/`) cobre
  apenas os 8 títulos com vencimento propostos, emitindo evidência
  `identity`+`issuer` a `primary` a partir de `source: "TESOURO"` — mesmo
  modelo de confiança do `B3ListedAssetProvider`, `VerificationPolicy`
  intocada.
- Normalização (trim + espaços colapsados + minúsculas + espaço antes do
  "+") e o guard de termos excludentes ("fundo", "etf", "carteira", "cdb",
  "lci", "lca", "renda fixa") vivem em UMA função só
  (`findTesouroDiretoEntry`, `./infer-asset-type.ts`), reaproveitada tanto
  pelo provider quanto pela inferência de `assetType` no
  `AssetResolutionEngine` — o guard nunca pode divergir entre os dois.
- O alias explícito `"Tesouro Selic 2029 (LFT)"` foi implementado como
  proposto (lista `aliases` por entrada do catálogo, nunca stripping
  genérico de sufixo entre parênteses).
- Resultado do diagnóstico atualizado: dos 24 casos de Tesouro, 13 passam a
  `resolved_expected` (os 8 catalogados + 5 variações de escrita que a
  normalização já cobre "de graça", incluindo o alias LFT) — mais do que os
  8 originalmente previstos, porque a normalização proposta no item 3 desta
  recomendação já era suficiente para cobrir as 5 variações de escrita
  mapeadas na TASK-058A sem nenhum trabalho extra. Os 11 restantes
  (ambíguos sem vencimento + negativos) continuam `needs_more_evidence_expected`,
  `wrong_type`/`wrong_code`/`unexpected_error` em zero para todos os 24.
