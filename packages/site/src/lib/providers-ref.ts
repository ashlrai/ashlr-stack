/**
 * Provider reference data for the site — re-exported from the canonical
 * catalog in `@ashlr/stack-core` so the CLI, MCP, AI recommender, and docs
 * all see the same data.
 *
 * When adding a provider, edit `packages/core/src/catalog.ts` (and the
 * matching adapter in `packages/core/src/providers/*.ts`).
 */

export {
  PROVIDER_CATEGORIES,
  PROVIDERS_REF,
  findProviderRef,
  groupByCategory,
} from "../../../core/src/catalog";

export type { AuthKind, ProviderRef } from "../../../core/src/catalog";
