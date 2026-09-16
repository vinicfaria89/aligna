import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// Redesign (benchmark PlanFi): uma família só, do corpo ao título em peso
// alto -- troca a dupla serifada/institucional (Libre Caslon + IBM Plex)
// anterior por algo mais "produto de tecnologia".
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
});

const TITLE = "Aligna — Diagnóstico de carteira";
const DESCRIPTION =
  "Envie os extratos de todos os bancos e corretoras onde você tem dinheiro. A Aligna organiza os ativos e devolve um raio-x independente: onde sua carteira diverge do seu perfil declarado, e por quê.";

// SITE_URL precisa ser o domínio real assim que ele existir (mesmo domínio
// do deploy -- ver docs/producao-nginx-tls.md do Planejador Financeiro para
// o mesmo tipo de configuração). Sem isso, og:url e as URLs absolutas de
// imagem ficam relativas ao ambiente onde a página está rodando -- funciona
// em produção, mas fica "http://localhost:3100" em dev, o que é inofensivo
// localmente e será substituído sozinho pelo NEXT_PUBLIC_SITE_URL real.
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: SITE_URL,
    siteName: "Aligna",
    locale: "pt_BR",
    type: "website",
    // TODO: gerar e apontar uma imagem og:image real (1200x630) antes do
    // lançamento -- sem ela, o preview em WhatsApp/redes sociais aparece
    // sem imagem, não quebra, só fica menos chamativo.
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={jakarta.variable}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
