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

export const metadata: Metadata = {
  title: "Lastro — Diagnóstico de carteira",
  description: "Descubra se sua carteira está alinhada com o seu perfil declarado.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${ibmPlex.variable} ${libreCaslon.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
