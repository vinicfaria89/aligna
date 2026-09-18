import type {
  RegistryEntity,
} from "./entity";

import {
  EntityRegistry,
} from "./entity-registry";

import {
  normalizeAlias,
  normalizeIdentifierValue,
} from "./normalize";

export class EntityRegistryLoader {
  load(
    entities: readonly RegistryEntity[],
  ): EntityRegistry {
    const entitiesById =
      new Map<
        string,
        RegistryEntity
      >();

    const entitiesByAlias =
      new Map<string, string>();

    const entitiesByIdentifier =
      new Map<string, string>();

    for (const entity of entities) {
      this.assertEntityId(
        entity,
        entitiesById,
      );

      entitiesById.set(
        entity.id,
        entity,
      );

      this.indexAliases(
        entity,
        entitiesByAlias,
      );

      this.indexIdentifiers(
        entity,
        entitiesByIdentifier,
      );
    }

    return new EntityRegistry(
      entitiesById,
      entitiesByAlias,
      entitiesByIdentifier,
    );
  }

  private assertEntityId(
    entity: RegistryEntity,
    entitiesById: Map<
      string,
      RegistryEntity
    >,
  ): void {
    if (
      entitiesById.has(
        entity.id,
      )
    ) {
      throw new Error(
        `Entity "${entity.id}" is already registered.`,
      );
    }
  }

  private indexAliases(
    entity: RegistryEntity,
    entitiesByAlias: Map<
      string,
      string
    >,
  ): void {
    const seen =
      new Set<string>();

    for (const alias of entity.aliases) {
      const normalized =
        normalizeAlias(alias);

      if (!normalized) {
        throw new Error(
          `Entity "${entity.id}" has an empty alias.`,
        );
      }

      if (seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);

      const owner =
        entitiesByAlias.get(
          normalized,
        );

      if (
        owner &&
        owner !== entity.id
      ) {
        throw new Error(
          `Alias "${normalized}" is already registered to entity "${owner}".`,
        );
      }

      entitiesByAlias.set(
        normalized,
        entity.id,
      );
    }
  }

  private indexIdentifiers(
    entity: RegistryEntity,
    entitiesByIdentifier: Map<
      string,
      string
    >,
  ): void {
    const seen =
      new Set<string>();

    for (const identifier of entity.identifiers) {
      const normalizedValue =
        normalizeIdentifierValue(
          identifier.kind,
          identifier.value,
        );

      if (!normalizedValue) {
        throw new Error(
          `Entity "${entity.id}" has an empty ${identifier.kind} identifier.`,
        );
      }

      const key = `${identifier.kind}:${normalizedValue}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      const owner =
        entitiesByIdentifier.get(
          key,
        );

      if (
        owner &&
        owner !== entity.id
      ) {
        throw new Error(
          `Identifier "${key}" is already registered to entity "${owner}".`,
        );
      }

      entitiesByIdentifier.set(
        key,
        entity.id,
      );
    }
  }
}
