import {
  describe,
  expect,
  it,
} from "vitest";

import {
  EvidenceProviderRegistry,
} from "./provider-registry";

import type {
  EvidenceProvider,
  ProviderQuery,
  ProviderResult,
} from "./evidence-provider";

function createMockProvider(
  id: string,
): EvidenceProvider {
  return {
    id,
    version: "1.0.0",

    supports(
      _query: ProviderQuery,
    ) {
      return true;
    },

    async search(
      _query: ProviderQuery,
    ): Promise<ProviderResult> {
      return {
        providerId: id,
        searched: true,
        found: false,
        evidence: [],
      };
    },
  };
}

describe(
  "EvidenceProviderRegistry",
  () => {
    it(
      "registers and retrieves a provider",
      () => {
        const registry =
          new EvidenceProviderRegistry();

        const provider =
          createMockProvider(
            "MOCK",
          );

        registry.register(
          provider,
        );

        expect(
          registry.get(
            "MOCK",
          ),
        ).toBe(
          provider,
        );
      },
    );

    it(
      "rejects duplicate provider ids",
      () => {
        const registry =
          new EvidenceProviderRegistry();

        registry.register(
          createMockProvider(
            "MOCK",
          ),
        );

        expect(() =>
          registry.register(
            createMockProvider(
              "MOCK",
            ),
          ),
        ).toThrow(
          'Provider "MOCK" is already registered.',
        );
      },
    );
  },
);