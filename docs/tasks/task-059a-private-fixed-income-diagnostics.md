# TASK-059A — Diagnóstico e modelagem de renda fixa privada

## Objetivo

Mapear, com fixtures e testes reais (não hipotéticos), como o resolver
atual (`lib/aie`) se comporta diante de entradas de CDB, LCI e LCA, e
propor critérios conservadores para uma futura verificação — sem
implementar nada que verifique renda fixa privada nesta task. Esta é uma
task diagnóstica e de modelagem, não de implementação, seguindo o mesmo
padrão que funcionou para Tesouro Direto (TASK-058A → TASK-058B →
TASK-058C).

## Estado atual

Ao contrário de Tesouro Direto (que não tinha nenhum valor em
`CandidateAssetType` até a TASK-058B), `"cdb"`, `"lci"` e `"lca"` **já
existem** em `CandidateAssetType`
(`lib/aie/contracts/candidate-asset.ts`) desde antes desta task — a
TASK-051A já tinha três fixtures genéricas (`CDB-GENERICO`,
`LCI-GENERICO`, `LCA-GENERICO`, categoria `"fixed-income-generic"`), cada
uma com emissor fictício ("Banco Teste") e nenhum ticker/código oficial.

`SEARCH_PLANS` (`lib/aie/planner/resolution-planner.ts`) já roteia os três
tipos para `["REGISTRY", "BACEN", "USER"]` — mas nenhum provider com
`id: "BACEN"` está registrado em lugar nenhum do runtime hoje (nem em
`create-aie-from-env.ts`, nem em nenhum teste de produção). Ou seja: o
"lugar" para uma fonte de renda fixa privada por emissor bancário já
existe na arquitetura, só nunca foi preenchido.

A TASK-059A expandiu a bateria diagnóstica de 58 para 93 fixtures (35
novas, categorias `"cdb"`, `"lci"`, `"lca"`,
`"private-fixed-income-ambiguous"` e `"private-fixed-income-negative"`)
— ver `lib/aie/diagnostics/portfolio-resolution-quality.fixtures.ts` e o
describe `"TASK-059A -- diagnóstico e modelagem de renda fixa privada
(CDB/LCI/LCA)"` em `portfolio-resolution-quality.diagnostic.test.ts`.

Confirmado pelos testes: **nenhuma** das 35 fixtures (nem as 3 genéricas
pré-existentes) resolve como `verified` hoje, em nenhuma das três
passagens do diagnóstico (baseline, com `B3ListedAssetProvider`, com B3 +
`TesouroDiretoProvider` juntos). Nenhuma produz `wrong_type`, `wrong_code`
ou `unexpected_error`. B3 e Tesouro Direto não regrediram.

## Casos observados

### Casos CDB

```
CDB Banco Teste 110% CDI                (emissor + indexador, sem vencimento)
CDB Banco Teste CDI 2027                (emissor + vencimento, sem indexador % explícito)
CDB Banco Teste 110% CDI 2027           (emissor + indexador + vencimento -- o mais completo)
CDB Liquidez Diária Banco Teste         (nome comercial + emissor)
CDB 110% CDI                            (indexador, SEM emissor)
CDB Pós Banco Teste                     (nome comercial + emissor, sem indexador/vencimento)
cdb banco teste 110% cdi 2027           (variação de escrita: minúsculas)
```

### Casos LCI

```
LCI Banco Teste IPCA+                   (emissor + indexador, sem vencimento)
LCI Banco Teste IPCA+ 2028              (emissor + indexador + vencimento)
LCI Banco Teste CDI 2028                (indexador diferente, mesmo padrão completo)
LCI 90 dias Banco Teste                 (nome comercial + emissor)
LCI IPCA+                                (indexador, SEM emissor)
lci banco teste ipca+ 2028              (variação: minúsculas)
 LCI BANCO TESTE IPCA+ 2028             (variação: caixa alta + espaços extras)
```

### Casos LCA

```
LCA Banco Teste CDI                     (emissor + indexador, sem vencimento)
LCA Banco Teste CDI 2029                (emissor + indexador + vencimento)
LCA Banco Teste IPCA+ 2029              (indexador diferente, mesmo padrão completo)
LCA Agro Banco Teste                    (nome comercial + emissor)
LCA CDI                                 (indexador, SEM emissor)
lca banco teste cdi 2029                (variação: minúsculas)
 LCA BANCO TESTE CDI 2029               (variação: caixa alta + espaços extras)
```

## Casos aceitos para análise futura

Os casos "completos" (emissor + indexador + vencimento) de cada tipo —
`CDB Banco Teste 110% CDI 2027`, `LCI Banco Teste IPCA+ 2028`, `LCA Banco
Teste CDI 2029` — são os candidatos mais fortes, mas com uma ressalva
importante em relação a Tesouro: mesmo esses três casos "completos" **não
são suficientes por si só** para uma futura verificação, porque "Banco
Teste" é um emissor fictício. Ao contrário do catálogo de Tesouro (onde o
emissor é sempre o único e real Tesouro Nacional), renda fixa privada
tem um emissor DIFERENTE por produto — não dá para catalogar "o CDB do
Banco Teste" sem saber que banco real está por trás, o que exige uma fonte
de verdade sobre emissores bancários (ex.: CNPJ/registro no BACEN), não só
um catálogo de nomes de produto.

## Casos ambíguos

Não deixam claro qual dos três tipos (ou se é renda fixa privada mesmo):

```
Renda Fixa Banco Teste                  (categoria genérica, sem tipo)
Produto Banco Teste CDI                 (sem tipo explícito)
Investimento CDI 2027                   (sem emissor nem tipo)
Título Privado Banco Teste              (sem tipo explícito)
Banco Teste 110% CDI                    (emissor + indexador, sem palavra indicando o tipo)
```

Proposta: nenhum destes deve ser verificado como CDB, LCI ou LCA — não
há como saber qual dos três tipos o usuário quis dizer sem uma palavra
explícita ("CDB"/"LCI"/"LCA") no nome ou no campo de tipo.

## Casos negativos

Contêm "CDB", "LCI", "LCA" ou um indexador típico de renda fixa privada
no nome, mas **não são** um CDB/LCI/LCA — risco de falso positivo se
qualquer heurística baseada em substring for usada como prova de
identidade:

```
Fundo CDB / Fundo LCI / Fundo LCA       (fundo, não o título direto)
Carteira CDB / Carteira LCI             (nome de produto/estratégia)
ETF de Renda Fixa                       (outro veículo inteiramente)
Debênture CDI Banco Teste               (outro tipo de ativo -- debênture)
COE Banco Teste CDI                     (outro tipo de ativo -- COE)
Tesouro CDB                             (nome contraditório/comercial)
```

Todos continuam `needs-more-evidence`, confirmado pelos testes. Nenhum
deles pode resolver como CDB/LCI/LCA verificado em nenhuma implementação
futura.

## Critérios mínimos propostos para identidade

- **Sem emissor, não verificar.** Sem saber qual instituição emitiu o
  título, não há "quem" verificar — o mesmo princípio que já vale para
  Tesouro (sem vencimento) aplicado aqui à dimensão que falta: identidade
  do emissor.
- **Sem vencimento, não verificar.** Um CDB "110% CDI" sem prazo não
  identifica um título específico, só uma modalidade — a mesma lição da
  TASK-058A (nome de família não é título específico).
- **Sem tipo explícito `cdb`/`lci`/`lca` (campo ou palavra no nome), não
  verificar como renda fixa privada.** "Banco Teste 110% CDI" tem emissor
  e indexador mas nenhuma palavra dizendo qual dos três produtos é —
  candidatar isso a qualquer um dos três seria um chute, não uma
  identificação.
- **Indexador ajuda, mas não é prova suficiente sozinho.** "CDI" ou
  "IPCA+" aparecem em CDB, LCI, LCA, debêntures, e várias outras coisas —
  são um sinal de contexto, nunca uma prova de tipo.
- **Emissor + tipo + vencimento pode ser candidato, mas ainda precisa de
  catálogo/fonte controlada** que confirme o EMISSOR (não só o nome do
  produto) — diferente de Tesouro, aqui não existe um único emissor
  soberano para "confiar de graça".
- **Nome comercial não é prova de identidade.** "Liquidez Diária", "Pós",
  "90 dias", "Agro" são rótulos de marketing do banco/corretora, nunca um
  identificador.
- **Termos excludentes.** Produtos contendo "Fundo", "ETF", "Carteira",
  "COE", "Debênture" ou "Tesouro" junto de "CDB"/"LCI"/"LCA" nunca devem
  ser classificados automaticamente como renda fixa privada — mesmo
  princípio do guard de Tesouro (TASK-058B),
  `lib/aie/providers/tesouro-direto/infer-asset-type.ts`.
- **Regex é só para normalização/candidatura, nunca para evidência** —
  mesma regra da TASK-058A, reafirmada aqui.
- **Verificação real exige catálogo local explícito ou fonte
  primária/controlada** que confirme o EMISSOR de verdade (ex.: um
  identificador BACEN/CNPJ do banco), nunca inferência textual sozinha.

## Riscos de falso positivo

1. Substring "CDB"/"LCI"/"LCA" capturando fundos/ETFs/carteiras/outros
   instrumentos com nome comercial parecido (mapeado acima, nos "casos
   negativos").
2. Confundir "tem um indexador (CDI/IPCA+)" com "é um CDB/LCI/LCA
   identificado" — o indexador aparece em várias classes de ativo.
3. Confundir "tem um emissor fictício de teste" com "tem um emissor real
   e verificável" — ao contrário de Tesouro (emissor único e conhecido),
   aqui cada produto tem um emissor diferente que precisaria de uma fonte
   própria de verdade.
4. Nome comercial (marketing do banco) sendo tratado como parte da
   identidade do título, quando é só um rótulo cosmético.
5. Variação de escrita (maiúsculas/minúsculas, espaços) quebrando um
   matcher ingênuo baseado em string exata.

## Proposta de tipos/categorias

`"cdb"`, `"lci"` e `"lca"` já existem em `CandidateAssetType` — nenhuma
mudança de tipo é necessária aqui, ao contrário de Tesouro. O trabalho
futuro é inteiramente de PROVIDER/catálogo/fonte de evidência, não de
modelagem de tipos.

## Proposta de provider futuro

Modelado, **não implementado**:

- **Provider único vs. providers separados**: a recomendação é um
  provider único, `PrivateFixedIncomeProvider`, cobrindo `cdb`, `lci` e
  `lca` — a estrutura de evidência (emissor + tipo + vencimento) é a
  mesma para os três, só o `assetType` muda. Providers separados
  (`CdbProvider`/`LciProvider`/`LcaProvider`) só se justificariam se as
  fontes de dados por trás de cada um divergissem de verdade (ex.: uma
  fonte só para LCI/LCA por serem isentas de IR e outra para CDB) — não
  investigado a fundo nesta task, decisão para a TASK-059B.
- Fonte: catálogo local conservador (poucos casos sintéticos/controlados
  para começar, mesmo padrão do catálogo de Tesouro) OU fonte primária
  controlada que confirme o emissor (ex.: registro BACEN) — nenhuma das
  duas foi consultada ou codificada nesta task.
- **Não tentar cobrir "todos os CDBs"** — o universo é combinatorialmente
  grande (banco × indexador × modalidade × vencimento); um catálogo
  exaustivo não é viável nem desejável.
- **Não verificar apenas por emissor + CDI sem catálogo** — reafirmando o
  princípio central: identidade textual nunca é evidência primária
  sozinha.

## Evidência necessária para verificação

Prováveis campos de evidência (a confirmar na TASK-059B contra os padrões
já existentes em `lib/aie/contracts/evidence.ts`):

- `identity` — qual produto específico (tipo + emissor + indexador +
  vencimento, os quatro juntos).
- `issuer` — o emissor real (não o nome comercial do produto).
- possivelmente `maturity` como evidência própria, se a
  `VerificationPolicy` vier a tratar vencimento separadamente (não
  necessário hoje: ela só exige `identity`+`issuer` a `primary`).
- possivelmente `indexer`/`instrumentType` como evidência
  complementar/`supporting`, nunca como substituto de `identity`/`issuer`.

## O que permanece fora de escopo

- Implementar `PrivateFixedIncomeProvider` (ou qualquer provider) para
  CDB/LCI/LCA.
- Qualquer inferência automática de `assetType` para renda fixa privada.
- Alterar `VerificationPolicy`, o registry de providers, o provider ou
  catálogo de Tesouro, o catálogo B3, ou qualquer runtime do AIE.
- Consultar qualquer fonte externa (nenhuma API/fonte BACEN foi chamada
  nesta task; nenhuma fonte primária foi codificada).
- Qualquer mudança de UI, comparação de snapshots, exportação CSV,
  Planejador, endpoints, auth, auditoria, env ou dependencies.

## Recomendação para TASK-059B

1. Decidir provider único vs. separados (recomendação: único,
   `PrivateFixedIncomeProvider`) com base numa investigação mais profunda
   de quão diferentes as fontes de emissor precisam ser por tipo.
2. Modelar um catálogo local conservador com POUCOS casos
   sintéticos/controlados (2-3 por tipo, no máximo), cada um com emissor
   REAL e verificável (não "Banco Teste") — nunca tentar cobrir o universo
   inteiro de bancos/produtos.
3. Definir como o emissor é confirmado como real (fonte primária/catálogo
   próprio de emissores bancários) antes de emitir evidência `issuer` a
   `primary` — esse é o ponto mais delicado desta frente, ao contrário de
   Tesouro onde o emissor é sempre o mesmo.
4. Adicionar o mesmo guard de termos excludentes já usado por Tesouro
   ("Fundo", "ETF", "Carteira", "COE", "Debênture", "Tesouro" junto de
   "CDB"/"LCI"/"LCA") antes de qualquer candidatura.
5. Rodar a mesma bateria diagnóstica (categorias `cdb`/`lci`/`lca`/
   ambíguos/negativos) como critério de aceite: só os casos explicitamente
   catalogados (emissor real + tipo + vencimento) devem passar a
   `resolved_expected`; todos os ambíguos e negativos devem continuar
   `needs_more_evidence_expected`, nunca `wrong_type`/`wrong_code`.
