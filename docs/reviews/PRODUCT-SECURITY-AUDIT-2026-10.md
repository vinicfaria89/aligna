# Auditoria de produto, arquitetura e segurança — 2026-10

## Escopo e situação observada

Revisão estática do branch `master` (`09e7b0e`, 2026-10-29). O repositório contém uma aplicação Next.js/TypeScript no diretório `frontend`, com fluxo de cadastro/intake, leitura de extratos, diagnóstico informativo, login/histórico e um Aligna Intelligence Engine (AIE) para resolver identidade de ativos a partir de CSV/Excel. O AIE consulta fontes delimitadas, preserva proveniência e exige política determinística para marcar um ativo como verificado.

O repositório não contém o backend principal, banco de dados, serviço de cobrança ou API completa do Planejador: a aplicação depende desses serviços externos para autenticação, intake, extração, histórico e persistência de snapshots. Portanto, este PR melhora a camada presente e define o plano; não afirma que existe consolidação persistida de múltiplas instituições nem que o motor financeiro externo foi auditado.

## Achados priorizados

### P1 — Concentração era apresentada como risco de emissor sem evidência

`frontend/lib/report.ts` agregava o campo informado de instituição e o rotulava como “emissor”. Isso não prova a identidade legal do emissor nem grupo econômico. Além disso, todos os ativos sem instituição eram agrupados numa única instituição fictícia, criando concentração falsa. Este PR corrige o rótulo, explicita a limitação e exclui dados ausentes do agrupamento.

### P1 — Cálculos apresentados ao investidor ainda usam estimativas e números binários

O diagnóstico e a projeção (`frontend/lib/report.ts`, `frontend/lib/projection.ts`) calculam agregações com `number`, e a projeção usa retornos/volatilidades estáticos por categoria. O próprio código descreve a faixa como ilustrativa e sem matriz de correlação. Antes de promover comparações a decisão financeira, adotar unidades monetárias decimais, arredondamento explícito, regras para valores inválidos/negativos, datas e cotação com fonte/data de referência, e testes de propriedades contra casos de referência. Separar claramente descrição, estimativa e dado observado.

### P1 — Tokens de sessão ficam no `localStorage`

`frontend/lib/session.ts` persiste refresh tokens no armazenamento acessível a JavaScript. Isso amplia o impacto de uma eventual falha XSS. O repositório já reconhece que não tem sessão própria. A mitigação estrutural exige uma camada de sessão no backend/BFF com cookie `HttpOnly`, `Secure`, `SameSite`, CSRF e rotação/revogação, a ser coordenada com o serviço Planejador; não é uma alteração segura isoladamente só no frontend.

### P1 — Limite de uso não é global entre instâncias

`frontend/lib/aie/server/in-memory-usage-controller.ts` declara explicitamente que os contadores são por processo, reiniciam com o serviço e não coordenam cobrança. Em implantação com múltiplas instâncias, o limite efetivo pode multiplicar-se. Usar armazenamento compartilhado com operação atômica, janelas e TTL, chave opaca por sujeito/operação e testes concorrentes; fail closed em falha do controlador.

### P1 — Trilha de auditoria durável é opcional e best-effort

`frontend/lib/aie/server/aie-audit.ts` e `.env.example` documentam que falha de sink não altera a decisão e que a trilha fica ausente sem configuração. Para produção com dados financeiros, confirmar requisitos de retenção/acesso e configurar sink durável com monitoramento de falhas, minimização e expurgo. Não registrar tokens, saldos ou linhas de carteira.

### P2 — Produto e dados estão divididos entre serviços e os contratos precisam evoluir juntos

O frontend consome endpoints do Planejador sem contrato versionado neste repositório. Mudanças em autenticação, snapshots, billing e resolução podem quebrar o fluxo sem que a suíte local cubra o outro serviço. Publicar OpenAPI/contratos versionados e executar testes de contrato entre serviços no CI antes de ampliar integrações.

### P2 — Produto já tem foco amplo para um MVP confiável

Há cadastro, IA de extratos, score, projeções, billing, histórico e várias rotas AIE. A diferenciação mais defensável neste estado é “carteira auditável”: importação sem credenciais bancárias, reconciliação explícita, identidade com fonte/data e exportação. Conexão bancária automática e recomendações devem ficar fora do primeiro lançamento comercial até que consentimento, segurança, cobertura e responsabilidade estejam definidos.

## Roteiro de evolução

### Fase 0 — Confiabilidade do fluxo atual (agora)

- Corrigir linguagem que apresenta instituição informada como emissor confirmado (implementado neste PR).
- Consolidar critérios de importação e validação: duplicatas, posições negativas, dinheiro em caixa, ativos não reconhecidos e totais reconciliados.
- Fixar “valor de posição”, “preço de mercado” e “identidade do ativo” como conceitos distintos; mostrar origem e data de cada dado.
- Criar fixtures sintéticas, sem extratos reais, para golden tests do fluxo CSV/Excel e relatórios.

### Fase 1 — MVP comercial enxuto

- Entrada por CSV/XLSX e lançamento manual; sem credenciais de corretora.
- Revisão humana de cada linha ambígua e confirmação explícita de valores/totais.
- Agregação por classe, instituição reportada e exposição verificada; incerteza visível em vez de imputação.
- Snapshot versionado e exportação CSV/PDF, com data de atualização e proveniência.
- Telemetria operacional sem dados de carteira e controles de exclusão/retention no backend.

### Fase 2 — Segurança e escala

- Migrar sessão para cookie HttpOnly via BFF e revisar XSS/CSRF/CSP.
- Tornar rate limits e quotas compartilhados, atômicos e observáveis.
- Tornar auditoria durável com retenção configurável, acesso restrito e alertas.
- Contratos de API versionados, migrações compatíveis, backups e plano de recuperação testado.
- Limites de arquivo, concorrência, timeouts, circuit breakers e métricas por provedor sem dados pessoais.

### Fase 3 — Diferenciação com evidência

- Ampliar cobertura de ativos por fonte oficial, sem inferência fuzzy como verificação.
- Mostrar conflitos, completude, idade e confiança/proveniência dos dados por posição.
- Só depois, acrescentar cotações e evolução histórica com licenciamento e data de referência explícitos.
- Revisar afirmações, score e projeções com especialistas; não converter o produto em recomendação individual sem a estrutura regulatória apropriada.

## Critérios para escalar

- Precisão de identidade medida por classe e provedor; conflitos e casos sem cobertura reportados separadamente.
- Reconciliação: soma das linhas importadas versus total do arquivo, com tolerância definida e diferenças explicadas.
- Correção numérica em golden tests com moeda, arredondamento, valores grandes/negativos e entradas inválidas.
- Taxa de sucesso/latência/erro de provedores, backlog e custo por carteira, sem registrar payloads financeiros.
- Incidentes de segurança, falhas de auditoria e exclusões atendidas dentro da política de retenção.
- Conversão, ativação e retenção do fluxo de importação antes de investir em conexões automáticas.

## Limitações desta auditoria

É uma revisão do código e documentação disponíveis no repositório em `master`; não cobre o backend Planejador, infraestrutura de produção, permissões reais de deployment, pentest, revisão regulatória ou validação de dados externos. A suíte local não foi executada neste ambiente porque a instalação das dependências não concluiu; isso não substitui integração entre serviços nem análise de segurança de produção.
