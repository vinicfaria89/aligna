import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  RegistryEntity,
} from "./entity";

import {
  EntityRegistryLoader,
} from "./entity-registry-loader";

function createEntity(
  overrides: Partial<RegistryEntity> &
    Pick<RegistryEntity, "id">,
): RegistryEntity {
  return {
    kind: "issuer",
    legalName: "Entity",
    aliases: [],
    identifiers: [],
    ...overrides,
  };
}

describe(
  "EntityRegistryLoader",
  () => {
    const loader =
      new EntityRegistryLoader();

    it(
      "rejects duplicate entity ids",
      () => {
        expect(() =>
          loader.load([
            createEntity({
              id: "ent-1",
              legalName: "A",
            }),
            createEntity({
              id: "ent-1",
              legalName: "B",
            }),
          ]),
        ).toThrow(
          'Entity "ent-1" is already registered.',
        );
      },
    );

    it(
      "rejects duplicate aliases across different entities",
      () => {
        expect(() =>
          loader.load([
            createEntity({
              id: "ent-petrobras",
              legalName:
                "Petrobras",
              aliases: [
                "PETROBRAS",
              ],
            }),
            createEntity({
              id: "ent-other",
              legalName:
                "Other",
              aliases: [
                " petrobras ",
              ],
            }),
          ]),
        ).toThrow(
          'Alias "PETROBRAS" is already registered to entity "ent-petrobras".',
        );
      },
    );

    it(
      "rejects duplicate identifiers across different entities",
      () => {
        expect(() =>
          loader.load([
            createEntity({
              id: "ent-a",
              identifiers: [
                {
                  kind: "cnpj",
                  value:
                    "33.000.167/0001-01",
                },
              ],
            }),
            createEntity({
              id: "ent-b",
              identifiers: [
                {
                  kind: "cnpj",
                  value:
                    "33000167000101",
                },
              ],
            }),
          ]),
        ).toThrow(
          'Identifier "cnpj:33000167000101" is already registered to entity "ent-a".',
        );
      },
    );

    it(
      "matches aliases only by exact normalized value",
      () => {
        const registry =
          loader.load([
            createEntity({
              id: "ent-petrobras",
              legalName:
                "Petróleo Brasileiro S.A.",
              aliases: [
                "Petrobras",
                "PETR4",
              ],
              identifiers: [
                {
                  kind: "ticker",
                  value: "PETR4",
                },
                {
                  kind: "cnpj",
                  value:
                    "33.000.167/0001-01",
                },
              ],
            }),
          ]);

        expect(
          registry.findByAlias(
            "  petrobras  ",
          )?.id,
        ).toBe("ent-petrobras");

        expect(
          registry.findByAlias(
            "PETR4",
          )?.id,
        ).toBe("ent-petrobras");

        expect(
          registry.findByIdentifier(
            "cnpj",
            "33000167000101",
          )?.id,
        ).toBe("ent-petrobras");

        expect(
          registry.findByAlias(
            "Petrobras PN quase PETR4",
          ),
        ).toBeNull();

        expect(
          registry.findByAlias(
            "PETROBRS",
          ),
        ).toBeNull();
      },
    );

    it(
      "does not create a VerifiedAsset from the registry alone",
      () => {
        const registry =
          loader.load([
            createEntity({
              id: "ent-petrobras",
              aliases: [
                "PETROBRAS",
              ],
            }),
          ]);

        const match =
          registry.findByAlias(
            "PETROBRAS",
          );

        expect(match).not.toBeNull();
        expect(match).toEqual(
          expect.not.objectContaining(
            {
              candidateAssetId:
                expect.anything(),
              canonicalAssetId:
                expect.anything(),
              verification:
                expect.anything(),
            },
          ),
        );
        expect(
          Object.prototype.hasOwnProperty.call(
            loader,
            "evaluate",
          ),
        ).toBe(false);
      },
    );
  },
);
