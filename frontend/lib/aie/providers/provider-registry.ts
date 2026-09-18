import type {
  EvidenceProvider,
} from "./evidence-provider";

export class EvidenceProviderRegistry {
  private readonly providers =
    new Map<string, EvidenceProvider>();

  register(
    provider: EvidenceProvider,
  ): this {
    if (
      this.providers.has(
        provider.id,
      )
    ) {
      throw new Error(
        `Provider "${provider.id}" is already registered.`,
      );
    }

    this.providers.set(
      provider.id,
      provider,
    );

    return this;
  }

  get(
    id: string,
  ): EvidenceProvider | null {
    return (
      this.providers.get(id) ??
      null
    );
  }

  list(): EvidenceProvider[] {
    return Array.from(
      this.providers.values(),
    );
  }
}