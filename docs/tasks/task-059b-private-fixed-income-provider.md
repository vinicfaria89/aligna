# TASK-059B — Provider conservador de renda fixa privada

## Objetivo

Pesquisar fontes públicas para um catálogo pequeno (3 a 5 entradas) de
CDB/LCI/LCA reais e, se a pesquisa encontrar fonte suficientemente segura,
implementar um provider conservador (`PrivateFixedIncomeProvider`) que
verifique só essas entradas explícitas — nunca por padrão textual, nunca
"Banco Teste". Se a pesquisa NÃO encontrar fonte suficiente, documentar a
decisão de não implementar e recomendar o que seria necessário para uma
futura TASK-059B2.

## Critério de entrada no catálogo

Uma entrada só entraria no catálogo se tivesse, simultaneamente:

- tipo explícito (`cdb`, `lci` ou `lca`);
- emissor real e publicamente identificável;
- um nome/identificador de PRODUTO específico — não apenas o emissor —
  que fosse (a) público, (b) estável ao longo do tempo e (c) o mesmo texto
  que um usuário real digitaria ou exportaria de um extrato/corretora;
- fonte pública rastreável e datada.

## Fontes consultadas

Todas em 24/09/2026, via busca web:

1. **Busca geral por código/identificador único de CDB/LCI/LCA** —
   resultados apontam para os "Código 02"/"Código 03" da Receita Federal,
   que são códigos de CATEGORIA de declaração no Imposto de Renda
   (compartilhados por TODOS os CDBs, ou TODAS as LCI/LCA do país),
   **não** um identificador de produto específico. Nenhuma fonte
   apresentou um catálogo público de produtos nomeados.
   - [LCI: o que é, como funciona e quanto rende em 2026 - Renova Invest](https://renovainvest.com.br/blog/lci-o-que-e-e-como-funciona/)
   - [Como Declarar LCI, LCA e CDB no IR 2026 — Adriano Freire](https://www.adrianofreire.com.br/blog/como-declarar-lci-lca-cdb-ir-2026)
2. **Busca pelo sistema de código ISIN da B3** — confirma que CDB, LCI e
   LCA SÃO registrados individualmente com código ISIN na B3
   (`Códigos ISIN - Pesquisa`, `sistemaswebb3-listados.b3.com.br/isinPage/`),
   mas cada ISIN corresponde a UMA EMISSÃO específica (um contrato entre
   um investidor/lote e o banco emissor, com taxa e vencimento próprios) —
   não a um "produto" com nome comercial estável que um usuário comum
   reconheceria ou digitaria da mesma forma duas vezes.
   - [Código ISIN | B3](https://b3.com.br/main.jsp?doui_processActionId=setLocaleProcessAction&locale=pt_BR&lumA=1&lumII=8A80CB81633FBF0B016340E62C020596&lumPageId=8A6A8C244DF790D7014DF899CFF02B6A)
   - [Mercado - Consulta aos Códigos ISIN - bmf bovespa](https://bvmf.bmfbovespa.com.br/consulta-isin/Isin.aspx?idioma=pt-br)
   - [Códigos ISIN - Pesquisa](https://sistemaswebb3-listados.b3.com.br/isinPage/)
3. **Busca por como CDB aparece em extratos/exportações reais** —
   confirma que o extrato de um CDB mostra "data de aplicação, taxa
   contratada, vencimento, carência" — dados ESPECÍFICOS DO CONTRATO DE
   CADA INVESTIDOR, não um nome de produto compartilhado.
   - [Como entender resultados de CDB — Comparabem](https://comparabem.com.br/blog-dicas/como-entender-resultados-cdb-consultar-seu-extrato-facilmente)
   - [CDB Bradesco](https://banco.bradesco/html/classic/produtos-servicos/investimentos/cdb.shtm)
4. **Busca por produtos "fixos" de fintechs (Nubank/Inter)** — encontrou
   páginas de agregadores citando ex. "CDB Nubank Pré-Fixado 17,50%", mas
   a taxa (17,50%) é uma condição PROMOCIONAL do momento, que muda com a
   Selic/política comercial do banco — não é um identificador estável;
   "CDB Nubank Pré-Fixado" sem a taxa amarrada a uma data não identifica
   um título específico, e COM a taxa vira uma string que deixa de ser
   válida assim que o banco reprecifica a oferta.
   - [CDB Nubank Pré-Fixado 17,50% - Investidor10](https://investidor10.com.br/renda-fixa/cdb/cdb-nubank-pre-fixado-1750/)
   - [O que é CDB com liquidez diária — Nubank](https://blog.nubank.com.br/cdb-liquidez-diaria/)

## Produtos/emissores incluídos

**Nenhum.** Ver "Decisão sobre evidência primary" abaixo.

## Produtos/emissores rejeitados e motivo

| Candidato considerado | Motivo da rejeição |
|---|---|
| "CDB Nubank Pré-Fixado 17,50%" (ou qualquer CDB com taxa no nome) | A taxa é uma condição comercial que muda ao longo do tempo — o nome não é estável; catalogar isso hoje ficaria desatualizado/incorreto em semanas, sem nenhum mecanismo de atualização nesta task. |
| "CDB Bradesco" / "CDB Itaú" / "CDB Nubank" (só emissor + tipo, sem produto específico) | Emissor real, mas SEM produto específico — cada banco emite dezenas de CDBs simultâneos com taxas e vencimentos diferentes; "CDB Bradesco" sozinho não identifica QUAL título, exatamente o critério que a TASK-059A já definiu como insuficiente ("Tipo + emissor sem produto específico não deve verificar"). |
| Qualquer ISIN individual de CDB/LCI/LCA via consulta B3 | Um ISIN identifica uma EMISSÃO específica (lote, taxa, vencimento de um contrato), não um "produto" que apareceria com o mesmo nome em duas carteiras de usuários diferentes — não serve como entrada de catálogo por `rawName`, porque não há um `rawName` estável e público associado a ele que um usuário digitaria. |
| LCI/LCA "Agro"/"Imobiliário" genéricos por banco | Mesmo problema do CDB: rótulo de categoria do banco, não um título específico com vencimento/taxa fixos e conhecidos publicamente. |

## Riscos conhecidos

Catalogar qualquer um dos candidatos acima geraria os mesmos riscos que a
TASK-059A já mapeou como inaceitáveis:

- **Instabilidade temporal**: ao contrário de "Tesouro Selic 2029" (nome
  fixo, definido pelo Tesouro Nacional, nunca muda) ou "PETR4" (ticker
  permanente), um nome de CDB com taxa embutida fica desatualizado assim
  que o banco reprecifica a oferta — o catálogo mentiria sobre a taxa
  atual, ou pior, um usuário digitando o nome de uma oferta ANTIGA
  receberia `verified` para uma taxa que não existe mais.
- **Ambiguidade estrutural**: "CDB Bradesco" sem mais detalhes não
  identifica um título único — o próprio banco tem múltiplas emissões
  simultâneas.
- **Falso positivo por confiança injustificada**: marcar qualquer um
  desses como `verified` daria ao usuário uma falsa sensação de
  confirmação oficial sobre um dado que, na verdade, veio de um
  agregador de terceiros (Investidor10, blogs), não de uma fonte
  primária do emissor ou de um registro oficial (B3/BACEN) que confirme
  aquele título específico como o que está na carteira do usuário.

## Decisão sobre evidência primary

**Nenhuma entrada foi incluída no catálogo.** A pesquisa (4 buscas,
convergindo na mesma conclusão) não encontrou nenhum produto real de
CDB/LCI/LCA com um nome público, estável ao longo do tempo, e específico
o suficiente para servir de chave de catálogo — ao contrário de Tesouro
Direto (TASK-058B), onde o Tesouro Nacional publica nomes fixos e
permanentes para cada título ("Tesouro Selic 2029" nunca muda de nome), ou
de tickers B3 (permanentes por definição regulatória).

Isso não é uma limitação de esforço de busca — é uma diferença estrutural
real entre os dois domínios: Tesouro Direto e ações/FIIs/ETFs têm
identidade PÚBLICA E CENTRALIZADA (o Tesouro Nacional ou a B3 são a fonte
única de verdade sobre o nome do instrumento); CDB/LCI/LCA são contratos
bilaterais banco-investidor, sem um catálogo público de "produtos" com
nome estável — só um sistema de ISINs por emissão individual, que não
corresponde a como um usuário digitaria o ativo numa carteira.

**Nenhum provider verificante foi implementado nesta task.** Nenhuma
evidência `primary` é emitida para CDB/LCI/LCA. `VerificationPolicy` não
foi alterada (nada para alterar — nenhum evidence novo entra no sistema).

## Limitações

- Esta pesquisa foi feita via busca web geral, não via acesso direto ao
  sistema de consulta ISIN da B3 (`sistemaswebb3-listados.b3.com.br/isinPage/`)
  nem a nenhuma API paga/restrita do BACEN — é possível que uma consulta
  mais profunda a essas fontes primárias (não feita aqui, fora do escopo
  de uma busca web) revele um caminho diferente; ver recomendação abaixo.
- Não foi avaliado se o próprio BACEN mantém algum registro público
  agregado de LCI/LCA por finalidade (imobiliário/agro) que pudesse servir
  de fonte parcial — ficou fora do escopo desta pesquisa.

## Critérios de aceite

Como nenhuma entrada foi catalogada, os critérios de aceite desta task
são:

- ✅ Documento de pesquisa criado, com fontes e datas.
- ✅ Nenhuma fixture de CDB/LCI/LCA passa a `resolved_expected` (nada foi
  alterado no runtime nem no diagnóstico — os 35 casos da TASK-059A
  continuam exatamente como estavam).
- ✅ `wrong_type`/`wrong_code`/`unexpected_error` continuam em zero (nada
  foi tocado que pudesse mudar isso).
- ✅ B3 e Tesouro Direto sem regressão (nada foi tocado nesses
  providers/catálogos).
- ✅ Recomendação clara para uma eventual TASK-059B2 registrada abaixo.

## Recomendação para uma eventual TASK-059B2

Só valeria a pena revisitar esta frente se surgir uma das duas condições:

1. **O próprio usuário fornecer o identificador da fonte** — por exemplo,
   se o CSV de carteira já viesse com um código ISIN por linha (campo
   `instrumentCode`, que `PortfolioAssetInput` já suporta), o provider
   poderia verificar a EXISTÊNCIA do ISIN contra a consulta pública da B3
   em tempo de execução (isso already contradiz "não chamar rede em
   runtime" desta task, então seria uma decisão de arquitetura nova, a
   avaliar com cuidado) — mas nesse caso a identidade viria do próprio
   usuário, não de um catálogo estático adivinhado por nome.
2. **Acesso a uma fonte agregada e oficial** (ex.: uma base do BACEN ou
   da B3 com emissões vigentes, se existir e for publicamente acessível)
   que permita validar um `(emissor, tipo, taxa, vencimento)` completo
   fornecido pelo usuário contra um registro real — nunca um catálogo de
   nomes fixos inventados.

Em ambos os casos, o "catálogo" deixaria de ser uma lista estática de
nomes (como funciona para B3/Tesouro) e passaria a ser uma VALIDAÇÃO
contra dado que o próprio usuário já trouxe — uma mudança de arquitetura
maior que está fora do escopo de uma extensão simples do padrão atual.

**Recomendação imediata: não abrir uma TASK-059B2 agora.** Repriorizar
para outra frente (ex.: melhorias na comparação de snapshots, ou outra
classe de ativo com identidade pública real, como debêntures via ANBIMA —
já parcialmente coberta) até que uma das duas condições acima apareça
organicamente (ex.: um usuário real pedindo suporte a ISIN explícito).
