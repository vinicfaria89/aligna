# TASK-036 - Um 401 da AIE não encerra mais uma sessão válida

Status: implementado. Corrige o achado do smoke test autenticado da TASK-035: com uma conta de teste real logada
(sessão válida, `GET /api/v1/portfolio-snapshot` funcionando), clicar "Resolver carteira" disparava `POST
/api/aie/resolve-csv`, que respondia `401` pelo gate `AieRequestAuthorizer` (hoje deny-all, TASK-017/018, aguardando
TASK-019/020). O frontend tratava esse `401` como sessão expirada, apagava o `aligna_session` do `localStorage` e
mostrava "Sua sessão expirou." -- uma sessão real e ainda válida do Planejador era descartada por um erro que não
tinha nada a ver com a validade do token.

## Causa

`submitPortfolioCsv` (`lib/aie/client/resolve-csv-client.ts`) chama `getSession()` (na prática `acquireAccessToken`
de `lib/session.ts`, que renova o `access_token` via `refresh_token` antes de toda chamada) e só então faz o POST
para `/api/aie/resolve-csv`. Ou seja: no momento em que essa rota responde, o token acabou de ser confirmado válido
pelo Planejador segundos antes. Um `401` vindo dessa rota só pode vir do limite de autorização da própria AIE (hoje
`createDenyAllAuthorizer()`, que sempre devolve `reason: "unauthenticated"` -- ver
`lib/aie/server/deny-all-authorizer.ts` e `lib/aie/server/request-authorization.ts`), nunca de uma rejeição real do
Planejador. Mesmo assim, o código antigo tratava qualquer `401` dessa rota como se fosse o Planejador recusando o
token: chamava `clearSession()` e devolvia `{ kind: "unauthenticated", reason: "rejected" }`, que o componente
renderizava como "Sua sessão expirou.".

## O que mudou

- `lib/aie/client/resolve-csv-client.ts`:
  - `case 401` não chama mais `clearSession` e não devolve mais `{ kind: "unauthenticated", reason: "rejected" }`.
    Devolve um outcome novo e distinto: `{ kind: "aie-access-denied", correlationId? }`.
  - `reason: "rejected"` foi removido do tipo de `ResolveCsvOutcome["unauthenticated"]["reason"]` (agora só
    `"no-session" | "expired"`, ambos só decididos por `getSession()`, nunca por uma resposta HTTP desta rota).
  - O parâmetro `clearSession` foi removido de `SubmitPortfolioCsvInput` -- nada mais o chama dentro deste módulo.
  - JSDoc do módulo e do novo outcome atualizados explicando o raciocínio acima.
- `components/PortfolioCsvResolver.tsx`:
  - Novo estado de `View`: `{ kind: "aie-access-denied" }`, com seu próprio bloco de alerta ("Resolução de carteiras
    ainda não está liberada." / "Sua conta ainda não tem acesso à resolução de carteiras em lote. Você continua
    logado..."), sem link de login -- no mesmo padrão visual do bloco já existente para `403`/`forbidden`.
  - A chamada a `submitPortfolioCsv(...)` não passa mais `clearSession`.
  - **Sem mudança** no restante do fluxo de sessão: `clearSession`/`endSession` continua exatamente como estava para
    o cliente do snapshot (`createPortfolioSnapshotClient`, usado por `GET`/`PUT`/`DELETE
    /api/v1/portfolio-snapshot`), que fala direto com o Planejador e cujo `401` continua significando sessão
    expirada de verdade.

## Antes / depois

| | Antes | Depois |
|---|---|---|
| `401` de `/api/aie/resolve-csv` | `clearSession()` chamado; `aligna_session` apagado do `localStorage` | sessão preservada, nada apagado |
| Mensagem exibida | "Sua sessão expirou." + link "Entrar" | "Resolução de carteiras ainda não está liberada." / "Sua conta ainda não tem acesso à resolução de carteiras em lote." -- sem link |
| Resultado salvo já exibido | continuava na tela (não mudou) | continua na tela (não mudou) |
| `403` (`forbidden`) | sem link, sessão preservada | sem mudança |
| `401` real de `/auth/login` ou `/auth/refresh` (sessão de fato expirada) | `clearSession()` chamado, pede novo login | sem mudança -- esse caminho é outro (`lib/session.ts`, decidido **antes** da chamada a `/api/aie/resolve-csv`) |
| `GET`/`PUT`/`DELETE /api/v1/portfolio-snapshot` (fala direto com o Planejador) | `401` limpa a sessão | sem mudança |

## Testes

- `lib/aie/client/resolve-csv-client.test.ts`: `401` mapeado para `aie-access-denied` (não mais `unauthenticated`);
  teste renomeado confirmando que a sessão não é tocada e não há retry; teste generalizado ("no status touches the
  session") agora inclui `401` na lista de status que nunca chamam `clearSession` nem pedem novo token; teste que
  cobria "clearSession lança exceção" foi removido (não existe mais chamada a `clearSession` neste caminho).
- `components/PortfolioCsvResolver.test.tsx`: teste de `401` reescrito para a nova mensagem, sem link "Entrar",
  `clearSession` não chamado (nos dois cenários: submissão isolada e submissão depois de um resultado bom); demais
  testes de sessão (`no-session`, `expired`, `unavailable`, `403`, `429`, `500`) continuam cobrindo exatamente o
  mesmo comportamento de antes, intocados.
- `components/PortfolioCsvResolver.snapshot.test.tsx`: teste do `401` durante a resolução (com um resultado salvo já
  na tela) atualizado para a nova mensagem e para confirmar `clearSession` não chamado; resultado salvo continua
  intocado (comportamento já correto antes, só a mensagem/sessão mudou).
- `components/PortfolioCsvResolver.a11y.test.tsx`: `401` removido do grupo que espera o link "Entrar" (não faz mais
  sentido -- não há mais link); `401` adicionado ao grupo que confirma "nenhum link de login aparece", junto com
  `403`/`429`/`500`.
- `components/PortfolioCsvResolver.return.test.tsx`: mesma mudança -- `401` com sessão válida saiu do grupo "mesmo
  link seguro de login" (removido também do teste que verificava não vazamento no `href`, já que não há mais `href`
  nesse caso) e entrou no grupo "não oferece link nenhum", que já verifica `clearSession` não chamado.

## Validação

- `npx tsc --noEmit`: sem erros.
- `npx vitest run lib/aie/client/resolve-csv-client lib/aie/client/client-boundary components/PortfolioCsvResolver`:
  184 passaram, 6 arquivos.
- `npx vitest run` (suíte completa): 1302 passaram, 68 arquivos, 0 falhas.

## Confirmações

- `lib/aie/server/*` (autorização, providers, políticas, orquestração) e `lib/aie/contracts`: não tocados -- o gate
  deny-all continua exatamente como está, aguardando TASK-019/020. Esta task muda só a INTERPRETAÇÃO do 401 no
  cliente do navegador (`lib/aie/client/resolve-csv-client.ts`) e a mensagem exibida (`components/`), nunca a lógica
  de autorização/resolução em si.
- Planejador (repositório separado): não tocado.
- Persistência de snapshot (`lib/portfolio-snapshot-api.ts`, `lib/portfolio-snapshot-mapping.ts`, os endpoints
  `GET`/`PUT`/`DELETE /api/v1/portfolio-snapshot` e o comportamento de `401` deles): não tocada.
- CORS, Vercel, Railway: não tocados.

## Fora de escopo

Decidir a política de acesso da AIE (TASK-019) e implementar o autorizador real (TASK-020) continuam pendentes --
esta task só evita que o estado atual (deny-all) tenha um efeito colateral incorreto no cliente.
