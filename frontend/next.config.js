// GITHUB_PAGES=true só é setado pelo workflow do Actions (ver
// .github/workflows/deploy.yml) -- em dev local (`npm run dev`) e no
// deploy de verdade atrás de um domínio próprio, basePath fica vazio,
// porque só o GitHub Pages serve o site debaixo de /lastro/.
const isGithubPages = process.env.GITHUB_PAGES === "true";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath: isGithubPages ? "/lastro" : "",
  assetPrefix: isGithubPages ? "/lastro/" : "",
};

module.exports = nextConfig;
