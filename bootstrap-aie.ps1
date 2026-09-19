<#
.SYNOPSIS
    Aligna AIE bootstrap: instrumentCode + ANBIMA debenture provider foundation.

.DESCRIPTION
    Safe, incremental consolidation of the current AIE implementation.

    - Applies small, anchored edits to existing AIE source files (fails fast
      if an anchor is missing or ambiguous; skips edits already applied).
    - Rewrites only provider-execution-pipeline.ts (adds the optional shouldStop rule).
    - Creates the ANBIMA foundation (types, offline fake client, provider) and
      NEW test files. Existing test files are never modified.
    - Backs up every file it touches to %TEMP%\aligna-aie-backup-<timestamp>.
    - Runs "npx tsc --noEmit" and "npm test -- --run lib/aie" and stops on failure.
    - Never runs git add / git commit / git push.

.PARAMETER Force
    Allow running on main/master or with a dirty working tree.
#>
param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"

# ============================================================
# Context
# ============================================================

$Root = $PSScriptRoot

if (-not $Root) {
    $Root = (Get-Location).Path
}

$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$BackupRoot = Join-Path $env:TEMP "aligna-aie-backup-$Timestamp"
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Fail {
    param([string]$Message)

    Write-Host ""
    Write-Host "AIE BOOTSTRAP FAILED" -ForegroundColor Red
    Write-Host $Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Backup (files touched before the failure):" -ForegroundColor Yellow
    Write-Host $BackupRoot
    Write-Host ""
    Write-Host "No git add, commit or push was performed." -ForegroundColor Yellow
    exit 1
}

function Backup-File {
    param([string]$RelativePath)

    $Source = Join-Path $Root $RelativePath

    if (-not (Test-Path $Source)) {
        return
    }

    $Destination = Join-Path $BackupRoot $RelativePath

    New-Item `
        -ItemType Directory `
        -Path (Split-Path $Destination -Parent) `
        -Force | Out-Null

    Copy-Item $Source $Destination -Force
}

function Write-ProjectFile {
    # Creates or replaces a file (CRLF, UTF-8 without BOM). Existing files are backed up first.
    param(
        [string]$RelativePath,
        [string]$Content
    )

    $FullPath = Join-Path $Root $RelativePath

    New-Item `
        -ItemType Directory `
        -Path (Split-Path $FullPath -Parent) `
        -Force | Out-Null

    Backup-File $RelativePath

    $Text = ($Content -replace "`r`n", "`n").TrimEnd() + "`n"
    $Text = $Text -replace "`n", "`r`n"

    [System.IO.File]::WriteAllText($FullPath, $Text, $Utf8NoBom)

    Write-Host "WRITE   $RelativePath" -ForegroundColor DarkGray
}

function Read-ProjectText {
    param([string]$RelativePath)

    $FullPath = Join-Path $Root $RelativePath

    if (-not (Test-Path $FullPath)) {
        Fail "Expected file not found: $RelativePath"
    }

    $Bytes = [System.IO.File]::ReadAllBytes($FullPath)

    $HasBom = (
        $Bytes.Length -ge 3 -and
        $Bytes[0] -eq 0xEF -and
        $Bytes[1] -eq 0xBB -and
        $Bytes[2] -eq 0xBF
    )

    $Text = $Utf8NoBom.GetString($Bytes)

    if ($HasBom) {
        $Text = $Text.Substring(1)
    }

    $Eol = "`n"

    if ($Text.Contains("`r`n")) {
        $Eol = "`r`n"
    }

    return @{
        Text   = ($Text -replace "`r`n", "`n")
        Eol    = $Eol
        HasBom = $HasBom
    }
}

function Save-ProjectText {
    param(
        [string]$RelativePath,
        [hashtable]$File,
        [string]$Text
    )

    $FullPath = Join-Path $Root $RelativePath

    Backup-File $RelativePath

    $Output = $Text -replace "`n", $File.Eol

    [System.IO.File]::WriteAllText(
        $FullPath,
        $Output,
        (New-Object System.Text.UTF8Encoding($File.HasBom))
    )
}

function New-Edit {
    param(
        [string]$Find,
        [string]$Replace
    )

    return @{
        Find    = ($Find -replace "`r`n", "`n")
        Replace = ($Replace -replace "`r`n", "`n")
    }
}

function Update-ProjectFile {
    # Applies literal, unique-anchor edits. Idempotent through AppliedMarker.
    param(
        [string]$RelativePath,
        [string]$AppliedMarker,
        [array]$Edits
    )

    $File = Read-ProjectText $RelativePath
    $Text = $File.Text

    if ($Text.Contains($AppliedMarker)) {
        Write-Host "SKIP    $RelativePath (already applied)" -ForegroundColor DarkYellow
        return
    }

    foreach ($Edit in $Edits) {
        $Index = $Text.IndexOf(
            $Edit.Find,
            [System.StringComparison]::Ordinal
        )

        if ($Index -lt 0) {
            Fail "Anchor not found in ${RelativePath}:`n$($Edit.Find)"
        }

        $Second = $Text.IndexOf(
            $Edit.Find,
            $Index + 1,
            [System.StringComparison]::Ordinal
        )

        if ($Second -ge 0) {
            Fail "Anchor is ambiguous in ${RelativePath}:`n$($Edit.Find)"
        }

        $Text =
            $Text.Substring(0, $Index) +
            $Edit.Replace +
            $Text.Substring($Index + $Edit.Find.Length)
    }

    Save-ProjectText $RelativePath $File $Text

    Write-Host "UPDATE  $RelativePath" -ForegroundColor DarkGray
}

function Append-ProjectText {
    # Appends text once (idempotent through Marker), preserving the file EOL/BOM.
    # -Compact appends on the next line (export lines); otherwise after a blank line.
    param(
        [string]$RelativePath,
        [string]$Marker,
        [string]$AppendText,
        [switch]$Compact
    )

    $File = Read-ProjectText $RelativePath
    $Text = $File.Text

    if ($Text.Contains($Marker)) {
        Write-Host "SKIP    $RelativePath (already applied)" -ForegroundColor DarkYellow
        return
    }

    $Addition = ($AppendText -replace "`r`n", "`n").TrimEnd()

    if ($Compact) {
        $Updated = $Text.TrimEnd() + "`n" + $Addition

        if ($Text.EndsWith("`n")) {
            $Updated = $Updated + "`n"
        }
    }
    else {
        $Updated = $Text.TrimEnd() + "`n`n" + $Addition + "`n"
    }

    Save-ProjectText $RelativePath $File $Updated

    Write-Host "APPEND  $RelativePath" -ForegroundColor DarkGray
}

# ============================================================
# Preflight
# ============================================================

Write-Host ""
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Aligna AIE Bootstrap" -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan
Write-Host ""

Set-Location $Root

if (-not (Test-Path (Join-Path $Root ".git"))) {
    Fail "Run this script from the Aligna repository root (.git not found)."
}

if (-not (Test-Path (Join-Path $Root "frontend\package.json"))) {
    Fail "frontend\package.json not found. Run this script from the Aligna repository root."
}

if (-not (Test-Path (Join-Path $Root "frontend\lib\aie"))) {
    Fail "frontend\lib\aie not found. This bootstrap expects the existing AIE foundation."
}

$Branch = (& git branch --show-current).Trim()

if (-not $Branch) {
    Fail "Detached HEAD detected. Check out a feature branch first."
}

Write-Host "Repository : $Root"
Write-Host "Branch     : $Branch"
Write-Host "Backup     : $BackupRoot"
Write-Host ""

if (($Branch -eq "main" -or $Branch -eq "master") -and -not $Force) {
    Fail "Refusing to run directly on '$Branch'. Use a feature branch or pass -Force."
}

# bootstrap-aie.ps1 itself is ignored by the dirty-tree check.
$Dirty = @(
    & git status --porcelain |
        Where-Object { $_ -notmatch '(^|\s)bootstrap-aie\.ps1$' }
)

if ($Dirty.Count -gt 0 -and -not $Force) {
    Write-Host "Working tree has uncommitted changes:" -ForegroundColor Yellow
    $Dirty | ForEach-Object { Write-Host "  $_" }

    Fail "Commit or stash your changes first, or re-run with -Force (every touched file is backed up)."
}

# ============================================================
# Directories
# ============================================================

foreach ($Directory in @(
    "docs\adr",
    "docs\tasks",
    "frontend\lib\aie\execution",
    "frontend\lib\aie\infrastructure\anbima",
    "frontend\lib\aie\providers",
    "frontend\lib\aie\registry",
    "frontend\lib\aie\resolution",
    "frontend\lib\aie\orchestrator"
)) {
    New-Item `
        -ItemType Directory `
        -Path (Join-Path $Root $Directory) `
        -Force | Out-Null
}

# ============================================================
# 1. Domain: instrumentCode
# ============================================================

Write-Host ""
Write-Host "[1/6] Domain: instrumentCode" -ForegroundColor Cyan

$Find = @'
  cnpj?: string;
'@

$Replace = @'
  cnpj?: string;

  /**
   * Official instrument code used by an applicable official source
   * (for example an ANBIMA debenture code). Not a ticker.
   */
  instrumentCode?: string;
'@

Update-ProjectFile `
    -RelativePath "frontend\lib\aie\contracts\candidate-asset.ts" `
    -AppliedMarker "instrumentCode" `
    -Edits @(New-Edit $Find $Replace)

$Find = @'
  cnpj?: string;
'@

$Replace = @'
  cnpj?: string;

  instrumentCode?: string;
'@

Update-ProjectFile `
    -RelativePath "frontend\lib\aie\providers\evidence-provider.ts" `
    -AppliedMarker "instrumentCode" `
    -Edits @(New-Edit $Find $Replace)

$Find = @'
  | "ticker";
'@

$Replace = @'
  | "ticker"
  | "instrumentCode";
'@

Update-ProjectFile `
    -RelativePath "frontend\lib\aie\registry\entity.ts" `
    -AppliedMarker "instrumentCode" `
    -Edits @(New-Edit $Find $Replace)

$FindA = @'
export function normalizeAlias(
'@

$ReplaceA = @'
import type {
  RegistryIdentifierKind,
} from "./entity";

export function normalizeAlias(
'@

$FindB = @'
  kind: "cnpj" | "isin" | "ticker",
'@

$ReplaceB = @'
  kind: RegistryIdentifierKind,
'@

Update-ProjectFile `
    -RelativePath "frontend\lib\aie\registry\normalize.ts" `
    -AppliedMarker "RegistryIdentifierKind" `
    -Edits @(
        (New-Edit $FindA $ReplaceA),
        (New-Edit $FindB $ReplaceB)
    )

# ============================================================
# 2. RegistryProvider: deterministic lookup priority
#    instrumentCode > isin > cnpj > ticker > exact normalized alias
# ============================================================

Write-Host ""
Write-Host "[2/6] RegistryProvider: instrumentCode lookup" -ForegroundColor Cyan

$FindA = @'
      query.isin ||
'@

$ReplaceA = @'
      query.instrumentCode ||
      query.isin ||
'@

$FindB = @'
    if (query.isin) {
'@

$ReplaceB = @'
    if (query.instrumentCode) {
      entity =
        this.registry.findByIdentifier(
          "instrumentCode",
          query.instrumentCode,
        );
    }

    if (
      !entity &&
      query.isin
    ) {
'@

Update-ProjectFile `
    -RelativePath "frontend\lib\aie\providers\registry-provider.ts" `
    -AppliedMarker "instrumentCode" `
    -Edits @(
        (New-Edit $FindA $ReplaceA),
        (New-Edit $FindB $ReplaceB)
    )

# ============================================================
# 3. ProviderExecutionPipeline: optional shouldStop rule
#    (the pipeline never imports VerificationPolicy)
# ============================================================

Write-Host ""
Write-Host "[3/6] ProviderExecutionPipeline: shouldStop" -ForegroundColor Cyan

Write-ProjectFile "frontend\lib\aie\execution\provider-execution-pipeline.ts" @'
import type {
  AssetEvidence,
  SearchExecution,
} from "../contracts";

import type {
  ResolutionPlan,
} from "../planner/resolution-plan";

import type {
  EvidenceProviderRegistry,
  ProviderQuery,
} from "../providers";

export interface ProviderExecutionInput {
  plan: ResolutionPlan;

  query: ProviderQuery;

  existingEvidence?: AssetEvidence[];

  now?: () => string;

  /**
   * Stopping rule owned by the coordinating flow (AssetResolutionEngine).
   *
   * It is consulted after each provider search that was accepted into the
   * evidence chain. When it returns true, later providers are not executed.
   *
   * The pipeline never decides evidence sufficiency itself: that authority
   * stays with VerificationPolicy, which the coordinator wraps in this callback.
   */
  shouldStop?: (
    evidence: AssetEvidence[],
  ) => boolean;
}

export interface ProviderExecutionResult {
  evidence: AssetEvidence[];

  searches: SearchExecution[];
}

export class ProviderExecutionPipeline {
  constructor(
    private readonly providers:
      EvidenceProviderRegistry,
  ) {}

  async execute(
    input: ProviderExecutionInput,
  ): Promise<ProviderExecutionResult> {
    const evidence: AssetEvidence[] = [
      ...(input.existingEvidence ?? []),
    ];

    const searches: SearchExecution[] =
      [];

    const now =
      input.now ??
      (() =>
        new Date().toISOString());

    for (
      const step
      of input.plan.steps
    ) {
      /*
       * USER is not an EvidenceProvider.
       *
       * Reaching USER means automatic
       * provider execution has ended.
       */
      if (step.source === "USER") {
        break;
      }

      const provider =
        this.providers.get(
          step.source,
        );

      /*
       * A plan may contain a source whose
       * provider has not been registered yet.
       */
      if (!provider) {
        continue;
      }

      if (
        !provider.supports(
          input.query,
        )
      ) {
        continue;
      }

      const startedAt = now();

      let accepted = false;

      try {
        const result =
          await provider.search(
            input.query,
          );

        const finishedAt = now();

        if (result.error) {
          /*
           * Evidence returned together with an
           * explicit provider error is not
           * accepted into the evidence chain.
           */
          searches.push({
            providerId:
              provider.id,

            startedAt,

            finishedAt,

            status:
              "failed",

            evidenceIds:
              [],

            error:
              `${result.error.code}: ${result.error.message}`,
          });
        } else {
          evidence.push(
            ...result.evidence,
          );

          searches.push({
            providerId:
              provider.id,

            startedAt,

            finishedAt,

            status:
              result.found
                ? "success"
                : "not-found",

            evidenceIds:
              result.evidence.map(
                (item) =>
                  item.id,
              ),
          });

          accepted = true;
        }
      } catch (error) {
        const finishedAt = now();

        searches.push({
          providerId:
            provider.id,

          startedAt,

          finishedAt,

          status:
            "failed",

          evidenceIds:
            [],

          error:
            error instanceof Error
              ? error.message
              : String(error),
        });
      }

      /*
       * Evaluated outside the provider try/catch:
       * a failing stopping rule is a coordinator
       * bug, not a provider failure.
       */
      if (
        accepted &&
        input.shouldStop?.([
          ...evidence,
        ])
      ) {
        break;
      }
    }

    return {
      evidence,
      searches,
    };
  }
}
'@

# ============================================================
# 4. AssetResolutionEngine: instrumentCode in the query + stopping rule
# ============================================================

Write-Host ""
Write-Host "[4/6] AssetResolutionEngine: query + stopping rule" -ForegroundColor Cyan

$FindA = @'
      candidate.hints.cnpj,
'@

$ReplaceA = @'
      candidate.hints.cnpj,

    instrumentCode:
      candidate.hints.instrumentCode,
'@

$FindB = @'
              : undefined,
'@

$ReplaceB = @'
              : undefined,

          shouldStop: (
            currentEvidence,
          ) =>
            this.policy.evaluate(
              currentEvidence,
            ).status === "verified",
'@

Update-ProjectFile `
    -RelativePath "frontend\lib\aie\resolution\asset-resolution-engine.ts" `
    -AppliedMarker "shouldStop" `
    -Edits @(
        (New-Edit $FindA $ReplaceA),
        (New-Edit $FindB $ReplaceB)
    )

# ============================================================
# 5. ANBIMA foundation (offline only; no HTTP, no credentials)
# ============================================================

Write-Host ""
Write-Host "[5/6] ANBIMA foundation" -ForegroundColor Cyan

Write-ProjectFile "frontend\lib\aie\infrastructure\anbima\anbima-debenture-types.ts" @'
/**
 * Record of the ANBIMA Feed "Precos e Indices > Debentures > Mercado Secundario".
 *
 * Only fields documented by ANBIMA are modeled. No response envelope is assumed.
 * Endpoint: GET /feed/precos-indices/v1/debentures/mercado-secundario
 */
export interface AnbimaDebentureMarketRecord {
  grupo: string | null;

  codigo_ativo: string;

  data_referencia: string;

  data_vencimento: string;

  percentual_taxa: string | null;

  taxa_compra: number | null;

  taxa_venda: number | null;

  taxa_indicativa: number | null;

  desvio_padrao: number | null;

  val_min_intervalo: number | null;

  val_max_intervalo: number | null;

  pu: number | null;

  percent_vne: number | null;

  percent_pu_par: number | null;

  duration: number | null;

  percent_reune: string | null;

  emissor: string;

  referencia_ntnb: string | null;

  data_finalizado: string | null;

  pu_retificado: number | null;

  percent_pu_par_retificado: number | null;

  duration_retificada: number | null;

  data_finalizado_retificado: string | null;
}

/**
 * Boundary between the ANBIMA provider and ANBIMA infrastructure.
 *
 * Authentication, HTTP, URLs, pagination and credentials belong to a future
 * implementation of this interface. The provider must not know about them.
 */
export interface AnbimaDebentureFeedClient {
  findSecondaryMarketDebentureByCode(
    instrumentCode: string,
  ): Promise<AnbimaDebentureMarketRecord | null>;
}
'@

Write-ProjectFile "frontend\lib\aie\infrastructure\anbima\index.ts" @'
export * from "./anbima-debenture-types";
'@

Write-ProjectFile "frontend\lib\aie\infrastructure\anbima\fake-anbima-debenture-feed-client.ts" @'
import type {
  AnbimaDebentureFeedClient,
  AnbimaDebentureMarketRecord,
} from "./anbima-debenture-types";

/**
 * Offline test double. Performs no network access and needs no credentials.
 */
export function createAnbimaDebentureRecord(
  overrides: Partial<AnbimaDebentureMarketRecord> = {},
): AnbimaDebentureMarketRecord {
  return {
    grupo: "DI",

    codigo_ativo: "ABCD11",

    data_referencia: "2026-09-18",

    data_vencimento: "2030-01-15",

    percentual_taxa: null,

    taxa_compra: null,
    taxa_venda: null,
    taxa_indicativa: null,
    desvio_padrao: null,
    val_min_intervalo: null,
    val_max_intervalo: null,
    pu: null,
    percent_vne: null,
    percent_pu_par: null,
    duration: null,
    percent_reune: null,

    emissor: "Petrobras",

    referencia_ntnb: null,
    data_finalizado: null,
    pu_retificado: null,
    percent_pu_par_retificado: null,
    duration_retificada: null,
    data_finalizado_retificado: null,

    ...overrides,
  };
}

export class FakeAnbimaDebentureFeedClient
  implements AnbimaDebentureFeedClient
{
  readonly requestedCodes: string[] = [];

  constructor(
    private readonly records: readonly AnbimaDebentureMarketRecord[] = [],

    private readonly failure?: Error,
  ) {}

  async findSecondaryMarketDebentureByCode(
    instrumentCode: string,
  ): Promise<AnbimaDebentureMarketRecord | null> {
    this.requestedCodes.push(
      instrumentCode,
    );

    if (this.failure) {
      throw this.failure;
    }

    return (
      this.records.find(
        (record) =>
          record.codigo_ativo ===
          instrumentCode,
      ) ?? null
    );
  }
}
'@

Write-ProjectFile "frontend\lib\aie\providers\anbima-debenture-provider.ts" @'
import type {
  AssetEvidence,
} from "../contracts";

import type {
  AnbimaDebentureFeedClient,
  AnbimaDebentureMarketRecord,
} from "../infrastructure/anbima/anbima-debenture-types";

import type {
  EvidenceProvider,
  ProviderQuery,
  ProviderResult,
} from "./evidence-provider";

function normalizeInstrumentCode(
  value: string,
): string {
  return value
    .trim()
    .toUpperCase();
}

/**
 * Queries exactly one knowledge source: the ANBIMA debenture secondary market feed.
 *
 * - exact instrumentCode only (no fuzzy matching, no issuer-name-only resolution);
 * - no knowledge of HTTP, OAuth, credentials or URLs (see AnbimaDebentureFeedClient);
 * - never decides verification and never creates VerifiedAsset.
 *
 * Evidence rule (see ADR-003): the official instrument code is primary identity
 * evidence. The textual "emissor" is only SUPPORTING issuer evidence, because it
 * is a name, not a canonical issuer identifier.
 */
export class AnbimaDebentureProvider
  implements EvidenceProvider
{
  readonly id = "ANBIMA";

  readonly version = "1.0.0";

  constructor(
    private readonly client:
      AnbimaDebentureFeedClient,

    private readonly now:
      () => string =
        () =>
          new Date().toISOString(),
  ) {}

  supports(
    query: ProviderQuery,
  ): boolean {
    return (
      query.assetType ===
        "debenture" &&
      Boolean(
        query.instrumentCode?.trim(),
      )
    );
  }

  async search(
    query: ProviderQuery,
  ): Promise<ProviderResult> {
    if (
      !this.supports(query) ||
      !query.instrumentCode
    ) {
      return {
        providerId:
          this.id,

        searched:
          false,

        found:
          false,

        evidence: [],
      };
    }

    const instrumentCode =
      normalizeInstrumentCode(
        query.instrumentCode,
      );

    try {
      const record =
        await this.client
          .findSecondaryMarketDebentureByCode(
            instrumentCode,
          );

      if (
        !record ||
        normalizeInstrumentCode(
          record.codigo_ativo,
        ) !== instrumentCode
      ) {
        return {
          providerId:
            this.id,

          searched:
            true,

          found:
            false,

          evidence: [],
        };
      }

      return {
        providerId:
          this.id,

        searched:
          true,

        found:
          true,

        evidence:
          this.toEvidence(
            query,
            record,
          ),
      };
    } catch (error) {
      return {
        providerId:
          this.id,

        searched:
          true,

        found:
          false,

        evidence: [],

        error: {
          code:
            "ANBIMA_SEARCH_FAILED",

          message:
            error instanceof Error
              ? error.message
              : String(error),
        },
      };
    }
  }

  private toEvidence(
    query: ProviderQuery,

    record:
      AnbimaDebentureMarketRecord,
  ): AssetEvidence[] {
    const collectedAt =
      this.now();

    const sourceReference =
      `ANBIMA:debentures:mercado-secundario:${record.codigo_ativo}`;

    return [
      {
        id:
          `ANBIMA:${query.assetId}:identity:${record.codigo_ativo}`,

        assetId:
          query.assetId,

        source:
          "ANBIMA",

        strength:
          "primary",

        field:
          "identity",

        value:
          record.codigo_ativo,

        sourceReference,

        collectedAt,

        providerVersion:
          this.version,

        metadata: {
          codigo_ativo:
            record.codigo_ativo,

          emissor:
            record.emissor,

          data_referencia:
            record.data_referencia,

          data_vencimento:
            record.data_vencimento,

          grupo:
            record.grupo,
        },
      },

      {
        id:
          `ANBIMA:${query.assetId}:issuer:${record.codigo_ativo}`,

        assetId:
          query.assetId,

        source:
          "ANBIMA",

        strength:
          "supporting",

        field:
          "issuer",

        value:
          record.emissor,

        sourceReference,

        collectedAt,

        providerVersion:
          this.version,

        metadata: {
          codigo_ativo:
            record.codigo_ativo,

          data_referencia:
            record.data_referencia,
        },
      },
    ];
  }
}
'@

Append-ProjectText `
    -RelativePath "frontend\lib\aie\providers\index.ts" `
    -Marker "anbima-debenture-provider" `
    -AppendText 'export * from "./anbima-debenture-provider";' `
    -Compact

# ============================================================
# 6. Tests (new files only; existing tests are preserved untouched)
# ============================================================

Write-Host ""
Write-Host "[6/6] Tests and documentation" -ForegroundColor Cyan

Write-ProjectFile "frontend\lib\aie\providers\instrument-code-contract.test.ts" @'
import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  CandidateAsset,
} from "../contracts";

import type {
  ProviderQuery,
} from "./evidence-provider";

describe(
  "instrumentCode contract",
  () => {
    it(
      "CandidateAsset hints support instrumentCode distinct from ticker",
      () => {
        const candidate: CandidateAsset = {
          id: "asset-1",

          rawName: "DEB PETROBRAS",

          source: {},

          hints: {
            assetType: "debenture",

            ticker: "PETR4",

            instrumentCode: "ABCD11",
          },
        };

        expect(
          candidate.hints.instrumentCode,
        ).toBe("ABCD11");

        expect(
          candidate.hints.ticker,
        ).toBe("PETR4");

        expect(
          candidate.hints.instrumentCode,
        ).not.toBe(
          candidate.hints.ticker,
        );
      },
    );

    it(
      "ProviderQuery supports instrumentCode distinct from ticker",
      () => {
        const query: ProviderQuery = {
          assetId: "asset-1",

          ticker: "PETR4",

          instrumentCode: "ABCD11",

          assetType: "debenture",
        };

        expect(
          query.instrumentCode,
        ).toBe("ABCD11");

        expect(
          query.instrumentCode,
        ).not.toBe(query.ticker);
      },
    );
  },
);
'@

Write-ProjectFile "frontend\lib\aie\registry\entity-registry-instrument-code.test.ts" @'
import {
  describe,
  expect,
  it,
} from "vitest";

import {
  EntityRegistryLoader,
} from "./entity-registry-loader";

describe(
  "EntityRegistry instrumentCode identifiers",
  () => {
    it(
      "resolves an exact instrumentCode after normalization",
      () => {
        const registry =
          new EntityRegistryLoader()
            .load([
              {
                id: "instrument.demo",
                kind: "instrument",
                legalName: "Demo Debenture",
                aliases: [],
                identifiers: [
                  {
                    kind: "instrumentCode",
                    value: "abcd11",
                  },
                ],
              },
            ]);

        expect(
          registry.findByIdentifier(
            "instrumentCode",
            "  ABCD11 ",
          )?.id,
        ).toBe(
          "instrument.demo",
        );
      },
    );

    it(
      "does not match a partial or extended instrumentCode",
      () => {
        const registry =
          new EntityRegistryLoader()
            .load([
              {
                id: "instrument.demo",
                kind: "instrument",
                legalName: "Demo Debenture",
                aliases: [],
                identifiers: [
                  {
                    kind: "instrumentCode",
                    value: "ABCD11",
                  },
                ],
              },
            ]);

        expect(
          registry.findByIdentifier(
            "instrumentCode",
            "ABCD1",
          ),
        ).toBeNull();

        expect(
          registry.findByIdentifier(
            "instrumentCode",
            "ABCD111",
          ),
        ).toBeNull();
      },
    );

    it(
      "rejects the same instrumentCode on different entities",
      () => {
        expect(
          () =>
            new EntityRegistryLoader()
              .load([
                {
                  id: "a",
                  kind: "instrument",
                  legalName: "A",
                  aliases: [],
                  identifiers: [
                    {
                      kind: "instrumentCode",
                      value: "ABCD11",
                    },
                  ],
                },
                {
                  id: "b",
                  kind: "instrument",
                  legalName: "B",
                  aliases: [],
                  identifiers: [
                    {
                      kind: "instrumentCode",
                      value: "abcd11",
                    },
                  ],
                },
              ]),
        ).toThrow(
          /instrumentCode:ABCD11/,
        );
      },
    );

    it(
      "keeps identifier kinds in separate namespaces",
      () => {
        const registry =
          new EntityRegistryLoader()
            .load([
              {
                id: "company.ticker-owner",
                kind: "company",
                legalName: "Ticker Owner",
                aliases: [],
                identifiers: [
                  {
                    kind: "ticker",
                    value: "ABCD11",
                  },
                ],
              },
              {
                id: "instrument.code-owner",
                kind: "instrument",
                legalName: "Code Owner",
                aliases: [],
                identifiers: [
                  {
                    kind: "instrumentCode",
                    value: "ABCD11",
                  },
                ],
              },
            ]);

        expect(
          registry.findByIdentifier(
            "ticker",
            "ABCD11",
          )?.id,
        ).toBe(
          "company.ticker-owner",
        );

        expect(
          registry.findByIdentifier(
            "instrumentCode",
            "ABCD11",
          )?.id,
        ).toBe(
          "instrument.code-owner",
        );
      },
    );

    it(
      "rejects an empty instrumentCode identifier",
      () => {
        expect(
          () =>
            new EntityRegistryLoader()
              .load([
                {
                  id: "instrument.empty",
                  kind: "instrument",
                  legalName: "Empty",
                  aliases: [],
                  identifiers: [
                    {
                      kind: "instrumentCode",
                      value: "   ",
                    },
                  ],
                },
              ]),
        ).toThrow(
          /empty instrumentCode identifier/,
        );
      },
    );
  },
);
'@

Write-ProjectFile "frontend\lib\aie\providers\registry-provider.instrument-code.test.ts" @'
import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  ProviderQuery,
} from "./evidence-provider";

import {
  EntityRegistryLoader,
} from "../registry";

import {
  RegistryProvider,
} from "./registry-provider";

function createProvider(): RegistryProvider {
  const registry =
    new EntityRegistryLoader()
      .load([
        {
          id: "instrument.by-code",
          kind: "instrument",
          legalName: "By Code",
          aliases: [],
          identifiers: [
            {
              kind: "instrumentCode",
              value: "ABCD11",
            },
          ],
        },
        {
          id: "instrument.by-isin",
          kind: "instrument",
          legalName: "By ISIN",
          aliases: [],
          identifiers: [
            {
              kind: "isin",
              value: "BRISIN000001",
            },
          ],
        },
        {
          id: "company.by-cnpj",
          kind: "company",
          legalName: "By CNPJ",
          aliases: [],
          identifiers: [
            {
              kind: "cnpj",
              value: "00.000.000/0001-91",
            },
          ],
        },
        {
          id: "company.by-ticker",
          kind: "company",
          legalName: "By Ticker",
          aliases: [],
          identifiers: [
            {
              kind: "ticker",
              value: "TICK4",
            },
          ],
        },
        {
          id: "company.by-alias",
          kind: "company",
          legalName: "By Alias",
          aliases: [
            "ONLY ALIAS",
          ],
          identifiers: [],
        },
      ]);

  return new RegistryProvider(
    registry,
  );
}

describe(
  "RegistryProvider instrumentCode lookup",
  () => {
    it(
      "supports a query that has only an instrumentCode",
      () => {
        const provider =
          createProvider();

        expect(
          provider.supports({
            assetId: "asset-1",

            instrumentCode: "ABCD11",
          }),
        ).toBe(true);

        expect(
          provider.supports({
            assetId: "asset-1",
          }),
        ).toBe(false);
      },
    );

    it(
      "resolves an exact instrumentCode as supporting evidence",
      async () => {
        const result =
          await createProvider()
            .search({
              assetId: "asset-1",

              instrumentCode:
                " abcd11 ",
            });

        expect(
          result.found,
        ).toBe(true);

        expect(
          result.evidence,
        ).toHaveLength(1);

        expect(
          result.evidence[0],
        ).toMatchObject({
          source: "REGISTRY",

          strength: "supporting",

          field: "identity",

          value: "instrument.by-code",
        });
      },
    );

    it(
      "applies the deterministic priority instrumentCode > isin > cnpj > ticker > alias",
      async () => {
        const provider =
          createProvider();

        const full: ProviderQuery = {
          assetId: "asset-1",

          instrumentCode: "ABCD11",

          isin: "BRISIN000001",

          cnpj: "00000000000191",

          ticker: "TICK4",

          rawName: "ONLY ALIAS",
        };

        const steps: Array<
          [string, ProviderQuery]
        > = [
          [
            "instrument.by-code",
            full,
          ],
          [
            "instrument.by-isin",
            {
              ...full,
              instrumentCode:
                undefined,
            },
          ],
          [
            "company.by-cnpj",
            {
              ...full,
              instrumentCode:
                undefined,
              isin: undefined,
            },
          ],
          [
            "company.by-ticker",
            {
              ...full,
              instrumentCode:
                undefined,
              isin: undefined,
              cnpj: undefined,
            },
          ],
          [
            "company.by-alias",
            {
              ...full,
              instrumentCode:
                undefined,
              isin: undefined,
              cnpj: undefined,
              ticker: undefined,
            },
          ],
        ];

        for (const [
          expectedId,
          query,
        ] of steps) {
          const result =
            await provider.search(
              query,
            );

          expect(
            result.evidence[0]
              ?.value,
          ).toBe(expectedId);
        }
      },
    );

    it(
      "falls back to the next identifier when the instrumentCode is unknown",
      async () => {
        const result =
          await createProvider()
            .search({
              assetId: "asset-1",

              instrumentCode:
                "UNKNOWN",

              isin: "BRISIN000001",
            });

        expect(
          result.evidence[0]
            ?.value,
        ).toBe(
          "instrument.by-isin",
        );
      },
    );

    it(
      "does not fuzzy match instrumentCode",
      async () => {
        const provider =
          createProvider();

        for (const code of [
          "ABCD1",
          "ABCD111",
          "ABC",
        ]) {
          const result =
            await provider.search({
              assetId: "asset-1",

              instrumentCode: code,
            });

          expect(
            result.found,
          ).toBe(false);

          expect(
            result.evidence,
          ).toEqual([]);
        }
      },
    );

    it(
      "does not mix ticker and instrumentCode identifier namespaces",
      async () => {
        const provider =
          createProvider();

        const asTicker =
          await provider.search({
            assetId: "asset-1",

            ticker: "ABCD11",
          });

        const asCode =
          await provider.search({
            assetId: "asset-1",

            instrumentCode:
              "TICK4",
          });

        expect(
          asTicker.found,
        ).toBe(false);

        expect(
          asCode.found,
        ).toBe(false);
      },
    );
  },
);
'@

Write-ProjectFile "frontend\lib\aie\execution\provider-execution-pipeline.stop-rule.test.ts" @'
import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  AssetEvidence,
} from "../contracts";

import type {
  ResolutionPlan,
  ResolutionSource,
  ResolutionStep,
} from "../planner/resolution-plan";

import type {
  EvidenceProvider,
  ProviderQuery,
  ProviderResult,
} from "../providers";

import {
  EvidenceProviderRegistry,
} from "../providers";

import {
  ProviderExecutionPipeline,
} from "./provider-execution-pipeline";

const NOW =
  "2026-09-19T12:00:00.000Z";

const query: ProviderQuery = {
  assetId: "asset-1",

  instrumentCode: "ABCD11",

  assetType: "debenture",
};

function createEvidence(
  id: string,
): AssetEvidence {
  return {
    id,

    assetId: "asset-1",

    source: "ANBIMA",

    strength: "primary",

    field: "identity",

    value: id,

    collectedAt: NOW,
  };
}

function createPlan(
  ...sources: ResolutionSource[]
): ResolutionPlan {
  return {
    assetType: "debenture",

    unresolvedFields: [
      "identity",
      "issuer",
    ],

    steps: sources.map(
      (
        source,
        index,
      ): ResolutionStep => ({
        source,

        order: index + 1,

        fields: [
          "identity",
          "issuer",
        ],
      }),
    ),
  };
}

interface ProviderSpy {
  provider: EvidenceProvider;

  calls: ProviderQuery[];
}

function createSpy(
  id: string,

  options: {
    result?: Partial<ProviderResult>;

    supports?: boolean;

    throws?: Error;
  } = {},
): ProviderSpy {
  const calls: ProviderQuery[] =
    [];

  const provider: EvidenceProvider =
    {
      id,

      version: "1.0.0",

      supports: () =>
        options.supports ?? true,

      async search(
        received: ProviderQuery,
      ): Promise<ProviderResult> {
        calls.push(received);

        if (options.throws) {
          throw options.throws;
        }

        return {
          providerId: id,

          searched: true,

          found: false,

          evidence: [],

          ...options.result,
        };
      },
    };

  return {
    provider,
    calls,
  };
}

function createPipeline(
  ...spies: ProviderSpy[]
): ProviderExecutionPipeline {
  const registry =
    new EvidenceProviderRegistry();

  for (const spy of spies) {
    registry.register(
      spy.provider,
    );
  }

  return new ProviderExecutionPipeline(
    registry,
  );
}

describe(
  "ProviderExecutionPipeline stopping rule and ordering",
  () => {
    it(
      "follows plan order, not registration order",
      async () => {
        const anbima =
          createSpy("ANBIMA");

        const registry =
          createSpy("REGISTRY");

        const result =
          await createPipeline(
            anbima,
            registry,
          ).execute({
            plan: createPlan(
              "REGISTRY",
              "ANBIMA",
            ),

            query,

            now: () => NOW,
          });

        expect(
          result.searches.map(
            (search) =>
              search.providerId,
          ),
        ).toEqual([
          "REGISTRY",
          "ANBIMA",
        ]);
      },
    );

    it(
      "stops later providers when shouldStop returns true",
      async () => {
        const registry =
          createSpy("REGISTRY", {
            result: {
              found: true,

              evidence: [
                createEvidence(
                  "registry",
                ),
              ],
            },
          });

        const anbima =
          createSpy("ANBIMA");

        const result =
          await createPipeline(
            registry,
            anbima,
          ).execute({
            plan: createPlan(
              "REGISTRY",
              "ANBIMA",
            ),

            query,

            now: () => NOW,

            shouldStop: () => true,
          });

        expect(
          anbima.calls,
        ).toHaveLength(0);

        expect(
          result.searches.map(
            (search) =>
              search.providerId,
          ),
        ).toEqual([
          "REGISTRY",
        ]);
      },
    );

    it(
      "continues when shouldStop returns false",
      async () => {
        const registry =
          createSpy("REGISTRY");

        const anbima =
          createSpy("ANBIMA");

        const result =
          await createPipeline(
            registry,
            anbima,
          ).execute({
            plan: createPlan(
              "REGISTRY",
              "ANBIMA",
            ),

            query,

            now: () => NOW,

            shouldStop: () => false,
          });

        expect(
          anbima.calls,
        ).toHaveLength(1);

        expect(
          result.searches,
        ).toHaveLength(2);
      },
    );

    it(
      "passes the accumulated evidence, including existing evidence, to shouldStop",
      async () => {
        const seen: string[][] =
          [];

        const registry =
          createSpy("REGISTRY", {
            result: {
              found: true,

              evidence: [
                createEvidence(
                  "registry",
                ),
              ],
            },
          });

        const anbima =
          createSpy("ANBIMA", {
            result: {
              found: true,

              evidence: [
                createEvidence(
                  "anbima",
                ),
              ],
            },
          });

        const result =
          await createPipeline(
            registry,
            anbima,
          ).execute({
            plan: createPlan(
              "REGISTRY",
              "ANBIMA",
            ),

            query,

            existingEvidence: [
              createEvidence(
                "existing",
              ),
            ],

            now: () => NOW,

            shouldStop: (
              evidence,
            ) => {
              seen.push(
                evidence.map(
                  (item) =>
                    item.id,
                ),
              );

              return false;
            },
          });

        expect(seen).toEqual([
          [
            "existing",
            "registry",
          ],
          [
            "existing",
            "registry",
            "anbima",
          ],
        ]);

        expect(
          result.evidence.map(
            (item) =>
              item.id,
          ),
        ).toEqual([
          "existing",
          "registry",
          "anbima",
        ]);
      },
    );

    it(
      "does not consult shouldStop after a failed provider",
      async () => {
        const failing =
          createSpy("REGISTRY", {
            result: {
              found: true,

              evidence: [
                createEvidence(
                  "must-not-be-accepted",
                ),
              ],

              error: {
                code: "REGISTRY_ERROR",

                message: "failed",
              },
            },
          });

        const throwing =
          createSpy("ANBIMA", {
            throws: new Error(
              "unavailable",
            ),
          });

        const notFound =
          createSpy("CVM");

        let checks = 0;

        const result =
          await createPipeline(
            failing,
            throwing,
            notFound,
          ).execute({
            plan: createPlan(
              "REGISTRY",
              "ANBIMA",
              "CVM",
            ),

            query,

            now: () => NOW,

            shouldStop: () => {
              checks += 1;

              return false;
            },
          });

        expect(
          result.searches.map(
            (search) =>
              search.status,
          ),
        ).toEqual([
          "failed",
          "failed",
          "not-found",
        ]);

        expect(
          result.evidence,
        ).toEqual([]);

        expect(checks).toBe(1);
      },
    );

    it(
      "skips unregistered providers and providers that do not support the query",
      async () => {
        const unsupported =
          createSpy("REGISTRY", {
            supports: false,
          });

        const supported =
          createSpy("ANBIMA");

        const result =
          await createPipeline(
            unsupported,
            supported,
          ).execute({
            plan: createPlan(
              "REGISTRY",
              "ANBIMA",
              "CVM",
              "B3",
            ),

            query,

            now: () => NOW,
          });

        expect(
          unsupported.calls,
        ).toHaveLength(0);

        expect(
          supported.calls,
        ).toHaveLength(1);

        expect(
          result.searches.map(
            (search) =>
              search.providerId,
          ),
        ).toEqual([
          "ANBIMA",
        ]);
      },
    );

    it(
      "executes nothing after USER, even when USER comes first",
      async () => {
        const registry =
          createSpy("REGISTRY");

        const result =
          await createPipeline(
            registry,
          ).execute({
            plan: createPlan(
              "USER",
              "REGISTRY",
            ),

            query,

            now: () => NOW,
          });

        expect(
          registry.calls,
        ).toHaveLength(0);

        expect(
          result.searches,
        ).toEqual([]);
      },
    );

    it(
      "returns only evidence and searches and never fabricates a verified asset",
      async () => {
        const registry =
          createSpy("REGISTRY");

        const result =
          await createPipeline(
            registry,
          ).execute({
            plan: createPlan(
              "REGISTRY",
            ),

            query,

            now: () => NOW,
          });

        expect(
          Object.keys(result)
            .sort(),
        ).toEqual([
          "evidence",
          "searches",
        ]);

        expect(
          result.evidence,
        ).toEqual([]);
      },
    );
  },
);
'@

Write-ProjectFile "frontend\lib\aie\orchestrator\evidence-orchestrator.boundary.test.ts" @'
import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  AssetEvidence,
  CandidateAsset,
} from "../contracts";

import {
  VerificationPolicy,
} from "../policy";

import {
  EvidenceOrchestrator,
} from "./evidence-orchestrator";

const candidate: CandidateAsset = {
  id: "asset-1",

  rawName: "DEB PETROBRAS",

  source: {},

  hints: {
    assetType: "debenture",

    instrumentCode: "ABCD11",
  },
};

function evidence(
  overrides: Partial<AssetEvidence> &
    Pick<
      AssetEvidence,
      "id" | "field"
    >,
): AssetEvidence {
  return {
    assetId: "asset-1",

    source: "ANBIMA",

    strength: "primary",

    value: overrides.id,

    collectedAt:
      "2026-09-19T12:00:00.000Z",

    ...overrides,
  };
}

describe(
  "EvidenceOrchestrator boundary",
  () => {
    it(
      "depends only on VerificationPolicy",
      () => {
        expect(
          EvidenceOrchestrator.length,
        ).toBe(1);

        const orchestrator =
          new EvidenceOrchestrator(
            new VerificationPolicy(),
          );

        expect(
          Object.keys(
            orchestrator,
          ),
        ).toEqual([
          "policy",
        ]);
      },
    );

    it(
      "does not expose provider execution",
      () => {
        const orchestrator =
          new EvidenceOrchestrator(
            new VerificationPolicy(),
          ) as unknown as Record<
            string,
            unknown
          >;

        expect(
          orchestrator.search,
        ).toBeUndefined();

        expect(
          orchestrator.execute,
        ).toBeUndefined();
      },
    );

    it(
      "records no searches when none are supplied",
      () => {
        const result =
          new EvidenceOrchestrator(
            new VerificationPolicy(),
          ).evaluate({
            candidateAsset:
              candidate,
          });

        expect(
          result.investigation
            .searches,
        ).toEqual([]);
      },
    );

    it(
      "keeps issuer unresolved when only supporting issuer evidence exists",
      () => {
        const result =
          new EvidenceOrchestrator(
            new VerificationPolicy(),
          ).evaluate({
            candidateAsset:
              candidate,

            evidence: [
              evidence({
                id: "identity",

                field: "identity",

                value: "ABCD11",
              }),

              evidence({
                id: "issuer-name",

                field: "issuer",

                strength:
                  "supporting",

                value: "Petrobras",
              }),
            ],

            now:
              "2026-09-19T12:00:00.000Z",
          });

        expect(
          result.verifiedAsset,
        ).toBeNull();

        expect(
          result.investigation
            .status,
        ).toBe(
          "needs-more-evidence",
        );

        expect(
          result.investigation
            .unresolvedFields,
        ).toEqual([
          "issuer",
        ]);
      },
    );
  },
);
'@

Write-ProjectFile "frontend\lib\aie\providers\anbima-debenture-provider.test.ts" @'
import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  AnbimaDebentureFeedClient,
  AnbimaDebentureMarketRecord,
} from "../infrastructure/anbima/anbima-debenture-types";

import {
  createAnbimaDebentureRecord,
  FakeAnbimaDebentureFeedClient,
} from "../infrastructure/anbima/fake-anbima-debenture-feed-client";

import {
  VerificationPolicy,
} from "../policy";

import {
  AnbimaDebentureProvider,
} from "./anbima-debenture-provider";

const NOW =
  "2026-09-19T12:00:00.000Z";

function createProvider(
  client: AnbimaDebentureFeedClient,
): AnbimaDebentureProvider {
  return new AnbimaDebentureProvider(
    client,
    () => NOW,
  );
}

describe(
  "AnbimaDebentureProvider",
  () => {
    it(
      "requires a debenture assetType and an instrumentCode",
      () => {
        const provider =
          createProvider(
            new FakeAnbimaDebentureFeedClient(),
          );

        expect(
          provider.supports({
            assetId: "asset-1",

            assetType:
              "debenture",

            instrumentCode:
              "ABCD11",
          }),
        ).toBe(true);

        expect(
          provider.supports({
            assetId: "asset-1",

            assetType:
              "debenture",
          }),
        ).toBe(false);

        expect(
          provider.supports({
            assetId: "asset-1",

            assetType:
              "debenture",

            ticker: "ABCD11",
          }),
        ).toBe(false);

        expect(
          provider.supports({
            assetId: "asset-1",

            assetType:
              "debenture",

            instrumentCode:
              "   ",
          }),
        ).toBe(false);

        expect(
          provider.supports({
            assetId: "asset-1",

            assetType: "stock",

            instrumentCode:
              "ABCD11",
          }),
        ).toBe(false);
      },
    );

    it(
      "does not search when unsupported",
      async () => {
        const client =
          new FakeAnbimaDebentureFeedClient([
            createAnbimaDebentureRecord(),
          ]);

        const result =
          await createProvider(
            client,
          ).search({
            assetId: "asset-1",

            assetType:
              "debenture",

            ticker: "ABCD11",
          });

        expect(result).toEqual({
          providerId: "ANBIMA",

          searched: false,

          found: false,

          evidence: [],
        });

        expect(
          client.requestedCodes,
        ).toEqual([]);
      },
    );

    it(
      "produces primary identity and supporting issuer evidence for an exact instrument code",
      async () => {
        const client =
          new FakeAnbimaDebentureFeedClient([
            createAnbimaDebentureRecord(),
          ]);

        const result =
          await createProvider(
            client,
          ).search({
            assetId: "asset-1",

            assetType:
              "debenture",

            instrumentCode:
              "ABCD11",
          });

        expect(
          result.searched,
        ).toBe(true);

        expect(
          result.found,
        ).toBe(true);

        expect(
          result.evidence,
        ).toHaveLength(2);

        const identity =
          result.evidence.find(
            (item) =>
              item.field ===
              "identity",
          );

        const issuer =
          result.evidence.find(
            (item) =>
              item.field ===
              "issuer",
          );

        expect(
          identity,
        ).toMatchObject({
          assetId: "asset-1",

          source: "ANBIMA",

          strength: "primary",

          value: "ABCD11",

          providerVersion:
            "1.0.0",

          collectedAt: NOW,

          sourceReference:
            "ANBIMA:debentures:mercado-secundario:ABCD11",
        });

        expect(
          issuer,
        ).toMatchObject({
          assetId: "asset-1",

          source: "ANBIMA",

          strength:
            "supporting",

          value: "Petrobras",

          providerVersion:
            "1.0.0",

          collectedAt: NOW,

          sourceReference:
            "ANBIMA:debentures:mercado-secundario:ABCD11",
        });
      },
    );

    it(
      "preserves only fields present in the ANBIMA record as metadata",
      async () => {
        const result =
          await createProvider(
            new FakeAnbimaDebentureFeedClient([
              createAnbimaDebentureRecord(),
            ]),
          ).search({
            assetId: "asset-1",

            assetType:
              "debenture",

            instrumentCode:
              "ABCD11",
          });

        const identity =
          result.evidence.find(
            (item) =>
              item.field ===
              "identity",
          );

        expect(
          identity?.metadata,
        ).toEqual({
          codigo_ativo:
            "ABCD11",

          emissor:
            "Petrobras",

          data_referencia:
            "2026-09-18",

          data_vencimento:
            "2030-01-15",

          grupo: "DI",
        });
      },
    );

    it(
      "normalizes the instrument code before asking the client",
      async () => {
        const client =
          new FakeAnbimaDebentureFeedClient([
            createAnbimaDebentureRecord(),
          ]);

        const result =
          await createProvider(
            client,
          ).search({
            assetId: "asset-1",

            assetType:
              "debenture",

            instrumentCode:
              "  abcd11 ",
          });

        expect(
          client.requestedCodes,
        ).toEqual([
          "ABCD11",
        ]);

        expect(
          result.found,
        ).toBe(true);
      },
    );

    it(
      "returns found = false for an unknown instrument",
      async () => {
        const result =
          await createProvider(
            new FakeAnbimaDebentureFeedClient([
              createAnbimaDebentureRecord(),
            ]),
          ).search({
            assetId: "asset-1",

            assetType:
              "debenture",

            instrumentCode:
              "ZZZZ99",
          });

        expect(result).toEqual({
          providerId: "ANBIMA",

          searched: true,

          found: false,

          evidence: [],
        });
      },
    );

    it(
      "rejects a record whose code differs from the requested code",
      async () => {
        const client: AnbimaDebentureFeedClient =
          {
            async findSecondaryMarketDebentureByCode():
              Promise<AnbimaDebentureMarketRecord | null> {
              return createAnbimaDebentureRecord(
                {
                  codigo_ativo:
                    "OTHR11",
                },
              );
            },
          };

        const result =
          await createProvider(
            client,
          ).search({
            assetId: "asset-1",

            assetType:
              "debenture",

            instrumentCode:
              "ABCD11",
          });

        expect(
          result.found,
        ).toBe(false);

        expect(
          result.evidence,
        ).toEqual([]);
      },
    );

    it(
      "converts client failures into ProviderError",
      async () => {
        const result =
          await createProvider(
            new FakeAnbimaDebentureFeedClient(
              [],
              new Error(
                "ANBIMA unavailable",
              ),
            ),
          ).search({
            assetId: "asset-1",

            assetType:
              "debenture",

            instrumentCode:
              "ABCD11",
          });

        expect(
          result.searched,
        ).toBe(true);

        expect(
          result.found,
        ).toBe(false);

        expect(
          result.evidence,
        ).toEqual([]);

        expect(
          result.error,
        ).toEqual({
          code:
            "ANBIMA_SEARCH_FAILED",

          message:
            "ANBIMA unavailable",
        });
      },
    );

    it(
      "does not verify issuer identity by itself",
      async () => {
        const result =
          await createProvider(
            new FakeAnbimaDebentureFeedClient([
              createAnbimaDebentureRecord(),
            ]),
          ).search({
            assetId: "asset-1",

            assetType:
              "debenture",

            instrumentCode:
              "ABCD11",
          });

        const decision =
          new VerificationPolicy()
            .evaluate(
              result.evidence,
            );

        expect(
          decision.status,
        ).toBe(
          "needs-more-evidence",
        );

        expect(
          decision.unresolvedFields,
        ).toEqual([
          "issuer",
        ]);

        expect(
          result,
        ).not.toHaveProperty(
          "verifiedAsset",
        );
      },
    );
  },
);
'@

Write-ProjectFile "frontend\lib\aie\resolution\asset-resolution-engine.coordination.test.ts" @'
import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  AssetEvidence,
  CandidateAsset,
  SearchExecution,
} from "../contracts";

import {
  ProviderExecutionPipeline,
} from "../execution/provider-execution-pipeline";

import {
  createAnbimaDebentureRecord,
  FakeAnbimaDebentureFeedClient,
} from "../infrastructure/anbima/fake-anbima-debenture-feed-client";

import {
  EvidenceOrchestrator,
} from "../orchestrator/evidence-orchestrator";

import {
  ResolutionPlanner,
} from "../planner/resolution-planner";

import {
  VerificationPolicy,
} from "../policy";

import type {
  EvidenceProvider,
  ProviderQuery,
  ProviderResult,
} from "../providers";

import {
  AnbimaDebentureProvider,
  EvidenceProviderRegistry,
} from "../providers";

import {
  AssetResolutionEngine,
} from "./asset-resolution-engine";

const NOW =
  "2026-09-19T12:00:00.000Z";

function createCandidate(): CandidateAsset {
  return {
    id: "asset-1",

    rawName: "DEB PETROBRAS",

    source: {
      fileName: "extrato.pdf",
    },

    hints: {
      assetType: "debenture",

      ticker: "PETR4",

      isin: "BRPETRDBS000",

      cnpj: "33.000.167/0001-01",

      instrumentCode: "ABCD11",

      currency: "BRL",

      amount: 12345.67,
    },
  };
}

function createEvidence(
  overrides: Partial<AssetEvidence> &
    Pick<
      AssetEvidence,
      "id" | "field"
    >,
): AssetEvidence {
  return {
    assetId: "asset-1",

    source: "CVM",

    strength: "primary",

    value: overrides.id,

    collectedAt: NOW,

    ...overrides,
  };
}

interface ProviderSpy {
  provider: EvidenceProvider;

  calls: ProviderQuery[];
}

function createSpy(
  id: string,

  result: Partial<ProviderResult> =
    {},
): ProviderSpy {
  const calls: ProviderQuery[] =
    [];

  const provider: EvidenceProvider =
    {
      id,

      version: "1.0.0",

      supports: () => true,

      async search(
        received: ProviderQuery,
      ): Promise<ProviderResult> {
        calls.push(received);

        return {
          providerId: id,

          searched: true,

          found: false,

          evidence: [],

          ...result,
        };
      },
    };

  return {
    provider,
    calls,
  };
}

function createEngine(
  providers: EvidenceProvider[],
): AssetResolutionEngine {
  const registry =
    new EvidenceProviderRegistry();

  for (const provider of providers) {
    registry.register(provider);
  }

  const policy =
    new VerificationPolicy();

  return new AssetResolutionEngine(
    policy,

    new ResolutionPlanner(),

    new ProviderExecutionPipeline(
      registry,
    ),

    new EvidenceOrchestrator(
      policy,
    ),
  );
}

describe(
  "AssetResolutionEngine coordination",
  () => {
    it(
      "resolve() is asynchronous",
      async () => {
        const promise =
          createEngine([])
            .resolve({
              candidateAsset:
                createCandidate(),

              now: NOW,
            });

        expect(
          promise,
        ).toBeInstanceOf(Promise);

        await promise;
      },
    );

    it(
      "builds the provider query from instrument identifiers only",
      async () => {
        const registry =
          createSpy("REGISTRY");

        await createEngine([
          registry.provider,
        ]).resolve({
          candidateAsset:
            createCandidate(),

          now: NOW,
        });

        expect(
          registry.calls,
        ).toEqual([
          {
            assetId: "asset-1",

            rawName:
              "DEB PETROBRAS",

            ticker: "PETR4",

            isin: "BRPETRDBS000",

            cnpj:
              "33.000.167/0001-01",

            instrumentCode:
              "ABCD11",

            assetType:
              "debenture",
          },
        ]);
      },
    );

    it(
      "stops executing later providers once VerificationPolicy is satisfied",
      async () => {
        const registry =
          createSpy("REGISTRY");

        const anbima =
          createSpy("ANBIMA", {
            found: true,

            evidence: [
              createEvidence({
                id: "identity",

                field: "identity",

                source: "ANBIMA",

                value: "ABCD11",
              }),
            ],
          });

        const cvm =
          createSpy("CVM", {
            found: true,

            evidence: [
              createEvidence({
                id: "issuer",

                field: "issuer",

                value:
                  "company.petrobras",
              }),
            ],
          });

        const b3 =
          createSpy("B3");

        const result =
          await createEngine([
            registry.provider,
            anbima.provider,
            cvm.provider,
            b3.provider,
          ]).resolve({
            candidateAsset:
              createCandidate(),

            now: NOW,
          });

        expect(
          result.status,
        ).toBe("verified");

        expect(
          result.verifiedAsset
            ?.canonicalAssetId,
        ).toBe("ABCD11");

        expect(
          result.verifiedAsset
            ?.issuerEntityId,
        ).toBe(
          "company.petrobras",
        );

        expect(
          result.investigation
            .searches.map(
              (search) =>
                search.providerId,
            ),
        ).toEqual([
          "REGISTRY",
          "ANBIMA",
          "CVM",
        ]);

        expect(
          b3.calls,
        ).toHaveLength(0);
      },
    );

    it(
      "does not execute providers when supplied evidence already verifies",
      async () => {
        const registry =
          createSpy("REGISTRY");

        const result =
          await createEngine([
            registry.provider,
          ]).resolve({
            candidateAsset:
              createCandidate(),

            evidence: [
              createEvidence({
                id: "identity",

                field: "identity",

                source: "ANBIMA",
              }),

              createEvidence({
                id: "issuer",

                field: "issuer",
              }),
            ],

            now: NOW,
          });

        expect(
          result.status,
        ).toBe("verified");

        expect(
          registry.calls,
        ).toHaveLength(0);

        expect(
          result.investigation
            .searches,
        ).toEqual([]);
      },
    );

    it(
      "preserves previously supplied searches before the new ones",
      async () => {
        const previous: SearchExecution =
          {
            providerId: "PREVIOUS",

            startedAt: NOW,

            finishedAt: NOW,

            status: "success",

            evidenceIds: [],
          };

        const registry =
          createSpy("REGISTRY");

        const result =
          await createEngine([
            registry.provider,
          ]).resolve({
            candidateAsset:
              createCandidate(),

            searches: [
              previous,
            ],

            now: NOW,
          });

        expect(
          result.status,
        ).toBe(
          "needs-more-evidence",
        );

        expect(
          result.investigation
            .searches.map(
              (search) =>
                search.providerId,
            ),
        ).toEqual([
          "PREVIOUS",
          "REGISTRY",
        ]);
      },
    );

    it(
      "ANBIMA alone leaves the issuer unresolved and never verifies",
      async () => {
        const client =
          new FakeAnbimaDebentureFeedClient([
            createAnbimaDebentureRecord(),
          ]);

        const result =
          await createEngine([
            new AnbimaDebentureProvider(
              client,
              () => NOW,
            ),
          ]).resolve({
            candidateAsset:
              createCandidate(),

            now: NOW,
          });

        expect(
          client.requestedCodes,
        ).toEqual([
          "ABCD11",
        ]);

        expect(
          result.status,
        ).toBe(
          "needs-more-evidence",
        );

        expect(
          result.nextAction,
        ).toBe(
          "search-provider",
        );

        expect(
          result.verifiedAsset,
        ).toBeNull();

        expect(
          result.investigation
            .evidence.map(
              (item) => [
                item.field,
                item.strength,
              ],
            ),
        ).toEqual([
          [
            "identity",
            "primary",
          ],
          [
            "issuer",
            "supporting",
          ],
        ]);

        expect(
          result.investigation
            .unresolvedFields,
        ).toEqual([
          "issuer",
        ]);
      },
    );

    it(
      "ANBIMA identity plus an independently supplied primary issuer verifies, without using the textual emissor",
      async () => {
        const result =
          await createEngine([
            new AnbimaDebentureProvider(
              new FakeAnbimaDebentureFeedClient([
                createAnbimaDebentureRecord(),
              ]),
              () => NOW,
            ),
          ]).resolve({
            candidateAsset:
              createCandidate(),

            evidence: [
              createEvidence({
                id: "cvm-issuer",

                field: "issuer",

                value:
                  "company.petrobras",
              }),
            ],

            now: NOW,
          });

        expect(
          result.status,
        ).toBe("verified");

        expect(
          result.verifiedAsset
            ?.canonicalAssetId,
        ).toBe("ABCD11");

        expect(
          result.verifiedAsset
            ?.issuerEntityId,
        ).toBe(
          "company.petrobras",
        );
      },
    );
  },
);
'@

# ============================================================
# Documentation (minimal)
# ============================================================

Write-ProjectFile "docs\adr\ADR-003-instrument-code-and-anbima-evidence.md" @'
# ADR-003 - instrumentCode semantics and ANBIMA evidence strength

## Status

Accepted

## Context

Official sources identify instruments with their own codes (for example the
ANBIMA debenture code). Reusing "ticker" for these codes mixes two different
identifier namespaces and makes exact resolution ambiguous.

The ANBIMA debenture feed exposes a textual "emissor" (issuer name), not a
canonical issuer identifier such as a CNPJ or a registry entity id.

## Decision

1. instrumentCode is a distinct identifier on CandidateAssetHints, ProviderQuery
   and the EntityRegistry (RegistryIdentifierKind).

   - ticker: trading ticker when applicable
   - isin: ISIN
   - cnpj: Brazilian legal entity identifier
   - instrumentCode: official instrument code used by an applicable official source

   Kinds never cross namespaces. Matching is exact after normalization
   (trim, uppercase). No fuzzy matching.

2. RegistryProvider lookup priority is deterministic:
   instrumentCode, isin, cnpj, ticker, exact normalized alias.
   Registry evidence remains supporting evidence only.

3. For an exact ANBIMA debenture record:

   - identity: source ANBIMA, strength primary, value codigo_ativo
   - issuer: source ANBIMA, strength supporting, value emissor

   A textual issuer name is not a canonical issuer identity. An ANBIMA record
   alone therefore never satisfies VerificationPolicy. Canonical issuer evidence
   must come from another reliable resolution step or source.

4. ProviderExecutionPipeline accepts an optional shouldStop callback supplied by
   AssetResolutionEngine, which wraps VerificationPolicy. The pipeline never
   imports or evaluates VerificationPolicy.

## Consequences

- Exact official codes are resolvable without overloading ticker.
- The 100%-certainty principle is preserved: no VerifiedAsset from a name.
- Debentures need a second reliable source for the issuer before verification.
'@

Append-ProjectText `
    -RelativePath "docs\tasks\TASK-005-anbima-debenture-feed-provider.md" `
    -Marker "Amendment 001" `
    -AppendText @'
## Amendment 001 (see ADR-003)

The Evidence Rules above are superseded for the issuer field:

- identity evidence from an exact official instrument code: strength = primary;
- issuer evidence from the textual emissor: strength = supporting.

The provider looks up by instrumentCode (not ticker) through
AnbimaDebentureFeedClient.findSecondaryMarketDebentureByCode(instrumentCode).
A textual issuer name is not a canonical issuer identity, so an ANBIMA record
alone never produces a VerifiedAsset.
'@

# ============================================================
# Validation
# ============================================================

Write-Host ""
Write-Host "Files written. Running validation..." -ForegroundColor Green
Write-Host ""

Push-Location (Join-Path $Root "frontend")

try {
    Write-Host "Running: npx tsc --noEmit" -ForegroundColor Cyan

    & npx tsc --noEmit

    if ($LASTEXITCODE -ne 0) {
        Fail "TypeScript validation failed (npx tsc --noEmit)."
    }

    Write-Host ""
    Write-Host "TypeScript: PASS" -ForegroundColor Green
    Write-Host ""
    Write-Host "Running: npm test -- --run lib/aie" -ForegroundColor Cyan

    & npm test -- --run lib/aie

    if ($LASTEXITCODE -ne 0) {
        Fail "AIE test suite failed (npm test -- --run lib/aie)."
    }

    Write-Host ""
    Write-Host "Tests: PASS" -ForegroundColor Green
}
finally {
    Pop-Location
}

# ============================================================
# Final report
# ============================================================

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host " AIE BOOTSTRAP COMPLETE" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "TypeScript: PASS"
Write-Host "Tests: PASS"
Write-Host ""
Write-Host "No git add performed."
Write-Host "No commit created."
Write-Host "No push performed."
Write-Host ""
Write-Host "Backup:" -ForegroundColor Cyan
Write-Host $BackupRoot
Write-Host ""
Write-Host "Current git status:" -ForegroundColor Cyan

& git status --short

Write-Host ""
Write-Host "Review with:" -ForegroundColor Cyan
Write-Host "  git status"
Write-Host "  git diff"
Write-Host ""
