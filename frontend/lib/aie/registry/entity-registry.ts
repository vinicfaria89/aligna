import type {
  RegistryEntity,
  RegistryIdentifierKind,
} from "./entity";

import {
  normalizeAlias,
  normalizeIdentifierValue,
} from "./normalize";

export class EntityRegistry {
  constructor(
    private readonly entitiesById: ReadonlyMap<
      string,
      RegistryEntity
    >,
    private readonly entitiesByAlias: ReadonlyMap<
      string,
      string
    >,
    private readonly entitiesByIdentifier: ReadonlyMap<
      string,
      string
    >,
  ) {}

  getById(
    id: string,
  ): RegistryEntity | null {
    return (
      this.entitiesById.get(
        id,
      ) ?? null
    );
  }

  findByAlias(
    alias: string,
  ): RegistryEntity | null {
    const entityId =
      this.entitiesByAlias.get(
        normalizeAlias(alias),
      );

    if (!entityId) {
      return null;
    }

    return this.getById(
      entityId,
    );
  }

  findByIdentifier(
    kind: RegistryIdentifierKind,
    value: string,
  ): RegistryEntity | null {
    const entityId =
      this.entitiesByIdentifier.get(
        `${kind}:${normalizeIdentifierValue(kind, value)}`,
      );

    if (!entityId) {
      return null;
    }

    return this.getById(
      entityId,
    );
  }

  list(): RegistryEntity[] {
    return Array.from(
      this.entitiesById.values(),
    );
  }
}
