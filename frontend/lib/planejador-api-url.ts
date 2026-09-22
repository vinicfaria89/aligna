/**
 * Base URL of the Planejador API, resolved once at module load (TASK-033).
 *
 * `NEXT_PUBLIC_PLANEJADOR_API_URL` used to default to `http://localhost:8000` in
 * EVERY environment, including a Vercel build with the variable unset. The build
 * stayed green (`next build` succeeded, static pages generated fine) and the
 * published app was silently unable to reach the Planejador for anyone who opened
 * it: the browser blocks the `https://` page calling `http://localhost:8000` as
 * mixed content, so `/evolucao` and `/carteira` loaded but every request failed.
 *
 * A production build (`next build`, which sets `NODE_ENV=production`) now fails
 * loudly at build time instead of shipping that broken bundle: the browser-safe
 * client modules (`lib/api.ts`, `lib/portfolio-snapshot-api.ts`) are imported by
 * the `/carteira` and `/evolucao` pages, both statically generated, so this
 * module's top-level throw surfaces during `next build`'s page generation, before
 * anything is deployed.
 *
 * `next dev` (`NODE_ENV=development`) and the test suite (`NODE_ENV=test`) are
 * unaffected: the localhost fallback stays, exactly as before, for local
 * ergonomics. See `.env.example` for the variable Vercel (Production and
 * Preview) must have configured.
 */
function resolvePlanejadorApiUrl(): string {
  const configured = process.env.NEXT_PUBLIC_PLANEJADOR_API_URL;

  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "NEXT_PUBLIC_PLANEJADOR_API_URL não está definida. Essa variável é obrigatória em " +
        "builds de produção (next build): sem ela o app seria publicado incapaz de falar " +
        "com o Planejador (a chamada ao fallback http://localhost:8000 é bloqueada pelo " +
        "navegador como conteúdo misto em qualquer domínio https). Defina-a no ambiente " +
        "de build -- no Vercel, em Project Settings > Environment Variables, para os " +
        "ambientes Production e Preview -- ou em .env.local para um build de produção local.",
    );
  }

  // Dev local (`next dev`) e testes (`NODE_ENV=test`): ergonomia, sem exigir configuração.
  return "http://localhost:8000";
}

export const PLANEJADOR_API_URL = resolvePlanejadorApiUrl();
