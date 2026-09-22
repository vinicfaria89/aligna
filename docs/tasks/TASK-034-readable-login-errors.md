# TASK-034 - Erros do FastAPI legíveis no login

Status: implementado. Corrige o achado incidental da revisão do PR #1: `/evolucao` mostrava `[object Object]` como
mensagem de erro quando `/auth/login` respondia 422 com o corpo de erro de validação do FastAPI/Pydantic.

## Causa

`login()` (`lib/api.ts`) fazia `body.detail ?? "Não conseguimos entrar com esse e-mail e senha"` e passava esse valor
direto para `new ApiError(status, message)`, cujo construtor chama `super(message)` (`Error`). O Planejador usa
`detail` de duas formas:

- suas próprias `HTTPException` (401 "E-mail ou senha inválidos", etc.) -- `detail` é uma string, sempre funcionou.
- um 422 em que a REQUISIÇÃO em si falha a validação do schema (antes de chegar à lógica de login) -- FastAPI/Pydantic
  devolvem `detail` como um array de objetos (`{loc, msg, type}`). Um array de objetos, passado a `?? fallback`, é
  truthy -- vira `message` do `Error`, e `Array.prototype.toString` transforma cada objeto em `"[object Object]"`.

Reproduzido de verdade em produção (`https://lastro-gamma.vercel.app/evolucao`, e de novo aqui num mock local com o
mesmo formato de 422) antes da correção, e confirmado corrigido depois.

## O que mudou

`lib/api.ts`: nova função `readableApiErrorMessage(detail, fallback)`, usada só em `login()`:

- `detail` string não vazia -> usa exatamente essa string (o caso do 401 continua idêntico: "E-mail ou senha
  inválidos").
- `detail` array não vazio (o formato do FastAPI/Pydantic) -> mensagem genérica fixa em vez do array bruto: "Não foi
  possível concluir com os dados enviados. Confira as informações e tente novamente." Nunca ecoa o texto/campo
  originais do Pydantic (consistente com a regra do resto do app de nunca mostrar detalhe interno do backend).
- Qualquer outra coisa (`detail` ausente, `null`, número, array vazio) -> mantém o fallback que já existia
  ("Não conseguimos entrar com esse e-mail e senha").

Nenhuma outra função de `lib/api.ts` (`submitIntake`, `createCheckoutSession`, `extractStatements`,
`saveScoreSnapshot`, `getScoreHistory`) foi tocada -- têm o mesmo padrão `body.detail ?? fallback` e o mesmo risco em
teoria, mas ficaram fora do escopo desta task (só login foi pedido); values a considerar numa limpeza futura, se
quiser.

## Testes

`lib/api.login.test.ts` (10 casos, fetch stubado, nada real contatado): 401 com `detail` string preserva a mensagem
exata; o erro é sempre `ApiError`; 422 com `detail` string usa a string; 422 com `detail` array vira a mensagem
genérica (nunca `[object Object]`, nunca vazio); vários erros de validação no array ainda viram uma única string
legível; o texto bruto do Pydantic (nome de campo, `msg`) nunca aparece na mensagem; corpo inesperado (`{}`,
`detail: null`, `detail: 42`, `detail: []`, corpo sem `detail`) cai no fallback padrão; corpo não-JSON cai no
`statusText`, sem crash; uma falha de rede (fetch rejeita) se propaga como o erro original, não vira `ApiError`;
sucesso (200) continua devolvendo os tokens normalmente.

## Validação

- `npx tsc --noEmit`: sem erros.
- `npm test -- --run lib/api.login`: 10 passaram.
- `npm test -- --run lib/aie`: 985 passaram, sem alteração.
- `npm test -- --run` (suíte completa): 1303 passaram, 68 arquivos (1293 antes desta task).
- Verificação manual: dev server real + mock local respondendo exatamente o formato de 422 do FastAPI/Pydantic visto
  em produção -- a tela passou a mostrar "Não foi possível concluir com os dados enviados. Confira as informações e
  tente novamente." em vez de `[object Object]`.

## Confirmações

- `/carteira`, `lib/aie`, sessão e persistência do snapshot não foram alterados -- só `lib/api.ts::login()`.
- Sem mudança de CORS, Vercel ou Planejador.
