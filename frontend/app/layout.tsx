import type { Metadata } from "next";
import { IBM_Plex_Sans, Libre_Caslon_Text } from "next/font/google";
import "./globals.css";

const ibmPlex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ibm-plex",
});

const libreCaslon = Libre_Caslon_Text({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-libre-caslon",
});

const TITLE = "Lastro — Diagnóstico de carteira";
const DESCRIPTION =
  "Envie os extratos de todos os bancos e corretoras onde você tem dinheiro. A Lastro organiza os ativos e devolve um raio-x independente: onde sua carteira diverge do seu perfil declarado, e por quê.";

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
    siteName: "Lastro",
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
    <html lang="pt-BR" className={`${ibmPlex.variable} ${libreCaslon.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
