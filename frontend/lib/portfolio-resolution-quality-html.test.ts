// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildPortfolioResolutionQualityHtml,
  downloadHtmlFile,
  resolutionQualityHtmlFileName,
} from "./portfolio-resolution-quality-html";

import type { SnapshotItem } from "./portfolio-snapshot-mapping";

function item(overrides: Partial<SnapshotItem> = {}): SnapshotItem {
  return {
    lineNumber: 2,
    rawName: "Ativo Teste",
    status: "verified",
    pendingFields: [],
    sources: [],
    ...overrides,
  };
}

const RICH_ITEMS: SnapshotItem[] = [
  {
    lineNumber: 2,
    rawName: "PETR4",
    ticker: "PETR4",
    assetType: "stock",
    amount: 1000,
    currency: "BRL",
    status: "verified",
    pendingFields: [],
    sources: ["B3"],
    verifiedAsset: { code: "b3:PETR4", type: "stock", currency: "BRL" },
  },
  {
    lineNumber: 3,
    rawName: "Tesouro Selic",
    amount: 200,
    currency: "BRL",
    status: "needs-more-evidence",
    pendingFields: ["identity"],
    sources: [],
  },
  {
    lineNumber: 4,
    rawName: "CDB Banco XP",
    amount: 300,
    currency: "BRL",
    status: "needs-more-evidence",
    pendingFields: ["identity", "issuer"],
    sources: [],
  },
  {
    lineNumber: 5,
    rawName: "Ativo com Erro",
    amount: 400,
    currency: "BRL",
    status: "item-error",
    pendingFields: [],
    sources: [],
  },
];

describe("buildPortfolioResolutionQualityHtml", () => {
  it("1. produces a well-formed HTML5 document", () => {
    const html = buildPortfolioResolutionQualityHtml([]);

    expect(html.trimStart().startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toContain("<head>");
    expect(html).toContain('<meta charset="UTF-8">');
    expect(html).toContain("</head>");
    expect(html).toContain("<body>");
    expect(html).toContain("</body>");
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });

  it("2. title is 'Qualidade da resolução' in both <title> and <h1>", () => {
    const html = buildPortfolioResolutionQualityHtml([]);

    expect(html).toContain("<title>Qualidade da resolução</title>");
    expect(html).toContain("<h1>Qualidade da resolução</h1>");
  });

  it("3. never contains a <script> tag", () => {
    const html = buildPortfolioResolutionQualityHtml(RICH_ITEMS);

    expect(html).not.toContain("<script");
  });

  it("4. never references an external stylesheet or library", () => {
    const html = buildPortfolioResolutionQualityHtml(RICH_ITEMS);

    expect(html).not.toContain('rel="stylesheet"');
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });

  it("5. styling is inline, in a single <style> tag", () => {
    const html = buildPortfolioResolutionQualityHtml([]);

    expect(html).toContain("<style>");
    expect(html).toContain("</style>");
  });

  it("6. empty portfolio: summary shows zero totals", () => {
    const html = buildPortfolioResolutionQualityHtml([]);

    expect(html).toContain("<td>Total de ativos</td><td>0</td>");
    expect(html).toContain("<td>Verificados</td><td>0</td>");
    expect(html).toContain("<td>Taxa de verificação</td><td>—</td>");
  });

  it("7. empty portfolio: no improvement suggestions message shown", () => {
    const html = buildPortfolioResolutionQualityHtml([]);

    expect(html).toContain("Nenhuma sugestão de melhoria.");
  });

  it("8. empty portfolio: no assets message shown", () => {
    const html = buildPortfolioResolutionQualityHtml([]);

    expect(html).toContain("Nenhum ativo para exibir.");
  });

  it("9. only verified items: totals reflect it and no improvement list appears", () => {
    const items = [
      item({ rawName: "PETR4", assetType: "stock", status: "verified" }),
      item({ rawName: "VALE3", assetType: "stock", status: "verified" }),
    ];
    const html = buildPortfolioResolutionQualityHtml(items);

    expect(html).toContain("<td>Total de ativos</td><td>2</td>");
    expect(html).toContain("<td>Verificados</td><td>2</td>");
    expect(html).toContain("Nenhuma sugestão de melhoria.");
  });

  it("10. mixed status: totals reflect the exact counts", () => {
    const html = buildPortfolioResolutionQualityHtml(RICH_ITEMS);

    expect(html).toContain("<td>Total de ativos</td><td>4</td>");
    expect(html).toContain("<td>Verificados</td><td>1</td>");
    expect(html).toContain("<td>Pendentes</td><td>2</td>");
    expect(html).toContain("<td>Erros</td><td>1</td>");
  });

  it("11. mixed status: one table row per item", () => {
    const html = buildPortfolioResolutionQualityHtml(RICH_ITEMS);

    for (const i of RICH_ITEMS) {
      expect(html).toContain(`<td>${i.rawName}</td>`);
    }
  });

  it("12. verified item row shows status and explanation title, no suggestion cell content", () => {
    const html = buildPortfolioResolutionQualityHtml(RICH_ITEMS);

    expect(html).toContain(
      "<td>PETR4</td><td>verified</td><td>stock</td><td>B3</td><td>Ativo verificado</td><td></td>",
    );
  });

  it("13. UX hint applied: 'Tesouro Selic' (no year) shows the treasury suggestion", () => {
    const html = buildPortfolioResolutionQualityHtml(RICH_ITEMS);

    expect(html).toContain(
      "<td>Tesouro Selic</td><td>needs-more-evidence</td><td></td><td></td>" +
        "<td>São necessárias mais evidências</td><td>Informe o vencimento do título do Tesouro.</td>",
    );
  });

  it("14. UX hint applied: 'CDB Banco XP' shows the private-fixed-income suggestion", () => {
    const html = buildPortfolioResolutionQualityHtml(RICH_ITEMS);

    expect(html).toContain("Informe o emissor e o produto específico.");
  });

  it("15. UX hint not applied when the year is present", () => {
    const items = [item({ rawName: "Tesouro Selic 2036", status: "needs-more-evidence" })];
    const html = buildPortfolioResolutionQualityHtml(items);

    expect(html).toContain("Forneça um nome mais específico para o ativo.");
    expect(html).not.toContain("Informe o vencimento do título do Tesouro.");
  });

  it("16. item-error row shows the item-error explanation title", () => {
    const html = buildPortfolioResolutionQualityHtml(RICH_ITEMS);

    expect(html).toContain("<td>Ativo com Erro</td><td>item-error</td>");
    expect(html).toContain("Erro ao processar o ativo");
  });

  it("17. improvement plan: suggestion title, priority, description and affected count appear", () => {
    const items = [item({ rawName: "CDB X", assetType: "stock", status: "blocked" })];
    const html = buildPortfolioResolutionQualityHtml(items);

    expect(html).toContain("<strong>Complete os dados obrigatórios</strong>");
    expect(html).toContain("(medium)");
    expect(html).toContain("Alguns ativos não puderam avançar na resolução por falta de dados obrigatórios.");
    expect(html).toContain("(1 ativo(s) afetado(s))");
  });

  it("18. improvement plan: multiple suggestions render as separate list items", () => {
    const items = [
      item({ rawName: "Ativo Sem Tipo", status: "verified" }),
      item({ rawName: "Ação Pendente", assetType: "stock", status: "needs-more-evidence" }),
    ];
    const html = buildPortfolioResolutionQualityHtml(items);

    const listItemCount = (html.match(/<li>/g) ?? []).length;
    expect(listItemCount).toBeGreaterThanOrEqual(2);
  });

  it("19. special characters: '<' and '>' in rawName are escaped", () => {
    const items = [item({ rawName: "Ativo <script>alert(1)</script>", status: "verified" })];
    const html = buildPortfolioResolutionQualityHtml(items);

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("20. special characters: '&' in rawName is escaped", () => {
    const items = [item({ rawName: "Banco A & B", status: "verified" })];
    const html = buildPortfolioResolutionQualityHtml(items);

    expect(html).toContain("Banco A &amp; B");
  });

  it("21. special characters: double quotes in rawName are escaped", () => {
    const items = [item({ rawName: 'Ativo "entre aspas"', status: "verified" })];
    const html = buildPortfolioResolutionQualityHtml(items);

    expect(html).toContain("Ativo &quot;entre aspas&quot;");
  });

  it("22. special characters: single quotes in rawName are escaped", () => {
    const items = [item({ rawName: "Ativo 'entre aspas simples'", status: "verified" })];
    const html = buildPortfolioResolutionQualityHtml(items);

    expect(html).toContain("Ativo &#39;entre aspas simples&#39;");
  });

  it("23. escaping never breaks the surrounding table structure", () => {
    const items = [item({ rawName: "<td>injected</td>", status: "verified" })];
    const html = buildPortfolioResolutionQualityHtml(items);

    expect(html).not.toContain("<td><td>injected</td></td>");
    expect(html).toContain("&lt;td&gt;injected&lt;/td&gt;");
  });

  it("24. filename: default format for a given date", () => {
    const name = resolutionQualityHtmlFileName(new Date(2026, 8, 30));

    expect(name).toBe("qualidade-resolucao-2026-09-30.html");
  });

  it("25. filename: zero-pads single-digit month and day", () => {
    const name = resolutionQualityHtmlFileName(new Date(2026, 0, 5));

    expect(name).toBe("qualidade-resolucao-2026-01-05.html");
  });

  it("26. filename: returns a plausible name when called with no argument", () => {
    const name = resolutionQualityHtmlFileName();

    expect(name).toMatch(/^qualidade-resolucao-\d{4}-\d{2}-\d{2}\.html$/);
  });

  it("27. determinism: same input always yields the same output", () => {
    const first = buildPortfolioResolutionQualityHtml(RICH_ITEMS);
    const second = buildPortfolioResolutionQualityHtml(RICH_ITEMS.map((i) => ({ ...i })));

    expect(first).toBe(second);
  });

  it("28. never mutates the input array or its items", () => {
    const items = RICH_ITEMS.map((i) => ({ ...i }));
    const snapshotBefore = JSON.parse(JSON.stringify(items));

    buildPortfolioResolutionQualityHtml(items);

    expect(items).toEqual(snapshotBefore);
  });

  it("29. asset_type prioritizes item.assetType over verifiedAsset.type", () => {
    const items = [
      item({
        rawName: "Ativo",
        assetType: "stock",
        status: "verified",
        verifiedAsset: { code: "x", type: "fii", currency: "BRL" },
      }),
    ];
    const html = buildPortfolioResolutionQualityHtml(items);

    expect(html).toContain("<td>Ativo</td><td>verified</td><td>stock</td>");
  });

  it("30. sources column joins multiple sources with '; '", () => {
    const items = [
      item({ rawName: "Ativo Multi Fonte", status: "verified", assetType: "stock", sources: ["B3", "TESOURO"] }),
    ];
    const html = buildPortfolioResolutionQualityHtml(items);

    expect(html).toContain("<td>B3; TESOURO</td>");
  });

  it("31. output is a plain string, never a Promise (no network/DOM involved)", () => {
    const result = buildPortfolioResolutionQualityHtml(RICH_ITEMS);

    expect(typeof result).toBe("string");
    expect(result).not.toBeInstanceOf(Promise);
  });

  it("32. the assets table has the expected column headers", () => {
    const html = buildPortfolioResolutionQualityHtml(RICH_ITEMS);

    expect(html).toContain(
      "<tr><th>Nome</th><th>Status</th><th>Tipo</th><th>Fonte</th><th>Explicação</th><th>Sugestão</th></tr>",
    );
  });

  it("33. the summary table has the expected column headers", () => {
    const html = buildPortfolioResolutionQualityHtml([]);

    expect(html).toContain("<tr><th>Métrica</th><th>Valor</th></tr>");
  });

  it("34. sections appear in the specified order: summary, improvement plan, assets", () => {
    const html = buildPortfolioResolutionQualityHtml(RICH_ITEMS);

    const summaryIndex = html.indexOf("<h2>Resumo</h2>");
    const improvementIndex = html.indexOf("<h2>Plano de melhoria</h2>");
    const assetsIndex = html.indexOf("<h2>Ativos</h2>");

    expect(summaryIndex).toBeGreaterThan(-1);
    expect(improvementIndex).toBeGreaterThan(summaryIndex);
    expect(assetsIndex).toBeGreaterThan(improvementIndex);
  });
});

describe("downloadHtmlFile", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("35. creates a Blob with the html MIME type, an anchor with the right filename, clicks it once, and revokes the object URL", () => {
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:sentinel-html-url");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    downloadHtmlFile("qualidade-resolucao-2026-09-30.html", "<!DOCTYPE html><html></html>");

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    const [blob] = createObjectURL.mock.calls[0] as [Blob];
    expect(blob.type).toBe("text/html;charset=utf-8");

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:sentinel-html-url");
    expect(document.querySelectorAll("a[download]")).toHaveLength(0);
  });

  it("36. uses the exact filename given, and never fetches or stores anything", () => {
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:sentinel-html-url-2");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);

    let downloadAttr: string | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloadAttr = this.download;
    });

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    downloadHtmlFile("qualidade-resolucao-2026-09-30.html", "<!DOCTYPE html><html></html>");

    expect(downloadAttr).toBe("qualidade-resolucao-2026-09-30.html");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);

    vi.unstubAllGlobals();
  });
});
