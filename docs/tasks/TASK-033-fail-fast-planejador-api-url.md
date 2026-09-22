# TASK-033 - Fail fast quando a URL do Planejador está ausente em build de produção

Status: implementado. Corrige o gap encontrado na revisão do PR #1: o build do Vercel ficou verde e o deploy de produção
(`lastro-gamma.vercel.app`) foi ao ar sem `NEXT_PUBLIC_PLANEJADOR_API_URL`, com o bundle usando o fallback
`http://localhost:8000` -- inofensivo em dev, mas bloqueado pelo navegador como conteúdo misto (`https://` chamando
`http://`) para qualquer visitante real. `/carteira` e `/evolucao` carregavam e pareciam funcionar; toda chamada ao
Planejador falhava silenciosamente.

## O que mudou

- `lib/planejador-api-url.ts` (novo): fonte única de `PLANEJADOR_API_URL`, resolvida uma vez na carga do módulo.
  - Variável definida -> usa o valor, em qualquer ambiente.
  - Ausente e `NODE_ENV !== "production"` (`next dev`, `NODE_ENV=development`; suíte de testes, `NODE_ENV=test`) ->
    mantém o fallback `http://localhost:8000`, sem exigir configuração para rodar localmente.
  - Ausente e `NODE_ENV === "production"` (`next build`, inclusive no Vercel) -> lança um erro nomeando a variável e
    o motivo, em vez de devolver o fallback.
- `lib/api.ts` e `lib/portfolio-snapshot-api.ts`: cada um calculava seu próprio fallback
  (`process.env.NEXT_PUBLIC_PLANEJADOR_API_URL ?? "http://localhost:8000"`) de forma independente; os dois agora
  importam a mesma constante. Nenhuma outra mudança de comportamento.
- `.env.example`: comentário explica que a variável é obrigatória em qualquer build de produção e por quê.

## Por que isso falha o `next build` (e não só em runtime no navegador)

`/carteira` e `/evolucao` são páginas estáticas (`○`, pré-renderizadas). O componente client
(`PortfolioCsvResolver`/`EvolucaoPage`) precisa ser avaliado em Node durante a geração estática do `next build` para
produzir o HTML inicial -- e essa avaliação em Node importa `lib/api.ts`/`lib/portfolio-snapshot-api.ts`, que agora
importam `lib/planejador-api-url.ts`. Um `throw` no topo desse módulo acontece exatamente nesse momento, então o
`next build` já falha na etapa "Generating static pages", antes de qualquer deploy -- não depende de alguém abrir a
página no navegador depois.

Verificado na prática, sem o `NEXT_PUBLIC_PLANEJADOR_API_URL`:

    ✓ Compiled successfully in 3.2s
    Linting and checking validity of types ...
    Collecting page data ...
    Generating static pages (0/6) ...
    Error occurred prerendering page "/carteira" ...
    Error: NEXT_PUBLIC_PLANEJADOR_API_URL não está definida. ...
    Export encountered an error on /carteira/page: /carteira, exiting the build.
    ⨯ Next.js build worker exited with code: 1

E com a variável definida, o mesmo build volta a terminar normalmente (`Generating static pages (6/6)`, exit 0),
idêntico ao build de antes desta task.

## Ergonomia preservada

- `next dev` sem a variável: confirmado rodando (`/carteira` responde 200), fallback `http://localhost:8000` intacto.
- Suíte de testes (`NODE_ENV=test`): 1293 testes, 67 arquivos, nenhum precisou da variável.

## Testes

`lib/planejador-api-url.test.ts` (10 casos, com `vi.stubEnv` + `vi.resetModules()` para reavaliar o módulo a cada
cenário): `development`/`test` sem a variável usam o fallback; `development` com a variável usa o valor; `production`
sem a variável lança (mensagem cita o nome da variável e "obrigatória em builds de produção"); `production` com a
variável (incl. string vazia tratada como ausente) passa e usa exatamente o valor configurado; nenhum dos dois módulos
cliente computa mais seu próprio fallback (checagem estática); `PORTFOLIO_SNAPSHOT_URL` é construída a partir da
constante compartilhada; importar qualquer um dos dois módulos em produção sem a variável falha.

## Validação

- `npx tsc --noEmit`: sem erros.
- `npm test -- --run lib/planejador-api-url lib/api lib/portfolio-snapshot`: 55 passaram.
- `npm test -- --run lib/aie`: 985 passaram, sem alteração.
- `npm test -- --run` (suíte completa): 1293 passaram, 67 arquivos (1283 antes desta task).
- `npx next build` sem a variável: falha como esperado (prova acima).
- `npx next build` com a variável: build limpo, mesmas rotas e tamanhos de antes.
- `npx next dev` sem a variável: sobe normalmente, fallback local preservado.

## Instrução operacional de deploy

`NEXT_PUBLIC_PLANEJADOR_API_URL` passa a ser **obrigatória** para qualquer build de produção a partir de agora --
inclusive o próximo deploy do Vercel, mesmo sem nenhuma mudança de código, vai falhar até essa variável ser
configurada (Project Settings > Environment Variables, ambientes Production e Preview, apontando para uma URL HTTPS
real do Planejador). Isso é intencional: fecha exatamente o gap identificado na revisão do PR #1, tornando impossível
repetir um deploy "verde" com o app publicado incapaz de falar com o backend.

## Fora de escopo

Configuração do Vercel (o valor real da variável), mudanças no Planejador, no fluxo de carteira, na persistência ou em
`lib/aie`.
