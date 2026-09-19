import {
    describe,
    expect,
    it,
  } from "vitest";
  
  import {
    EntityRegistryLoader,
  } from "../registry";
  
  import {
    RegistryProvider,
  } from "./registry-provider";
  
  describe(
    "RegistryProvider",
    () => {
      it(
        "resolves an exact ticker as supporting evidence",
        async () => {
          const registry =
            new EntityRegistryLoader().load([
              {
                id: "company.petrobras",
                kind: "company",
                legalName:
                  "Petróleo Brasileiro S.A. - Petrobras",
                aliases: [
                  "Petrobras",
                ],
                identifiers: [
                  {
                    kind: "ticker",
                    value: "PETR4",
                  },
                ],
              },
            ]);
  
          const provider =
            new RegistryProvider(
              registry,
            );
  
          const result =
            await provider.search({
              assetId:
                "asset-1",
              ticker:
                "PETR4",
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
            assetId:
              "asset-1",
            source:
              "REGISTRY",
            strength:
              "supporting",
            field:
              "identity",
            value:
              "company.petrobras",
          });
        },
      );
  
      it(
        "resolves an exact normalized alias",
        async () => {
          const registry =
            new EntityRegistryLoader().load([
              {
                id: "company.petrobras",
                kind: "company",
                legalName:
                  "Petróleo Brasileiro S.A. - Petrobras",
                aliases: [
                  "DEB PETROBRAS",
                ],
                identifiers: [],
              },
            ]);
  
          const provider =
            new RegistryProvider(
              registry,
            );
  
          const result =
            await provider.search({
              assetId:
                "asset-2",
              rawName:
                "deb petrobras",
            });
  
          expect(
            result.found,
          ).toBe(true);
  
          expect(
            result.evidence[0]
              ?.strength,
          ).toBe(
            "supporting",
          );
        },
      );
  
      it(
        "does not use fuzzy matching",
        async () => {
          const registry =
            new EntityRegistryLoader().load([
              {
                id: "company.petrobras",
                kind: "company",
                legalName:
                  "Petróleo Brasileiro S.A. - Petrobras",
                aliases: [
                  "PETROBRAS",
                ],
                identifiers: [],
              },
            ]);
  
          const provider =
            new RegistryProvider(
              registry,
            );
  
          const result =
            await provider.search({
              assetId:
                "asset-3",
              rawName:
                "PETROB",
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
        "returns not found when registry has no matching entity",
        async () => {
          const registry =
            new EntityRegistryLoader().load([]);
  
          const provider =
            new RegistryProvider(
              registry,
            );
  
          const result =
            await provider.search({
              assetId:
                "asset-4",
              ticker:
                "UNKNOWN",
            });
  
          expect(
            result,
          ).toMatchObject({
            providerId:
              "REGISTRY",
            searched:
              true,
            found:
              false,
            evidence: [],
          });
        },
      );
    },
  );
  