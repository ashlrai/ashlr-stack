export * from "./config.ts";
export * from "./phantom.ts";
export * from "./providers/_base.ts";
export { providers, getProvider, listProviderNames } from "./providers/index.ts";
export * from "./errors.ts";
export * from "./templates.ts";
export * from "./pipeline.ts";
export * from "./detect.ts";
export * from "./detect-source.ts";
export * from "./registry.ts";
export {
  PROVIDER_CATEGORIES,
  PROVIDERS_REF,
  findProviderRef,
  groupByCategory,
} from "./catalog.ts";
export type { AuthKind as CatalogAuthKind, ProviderRef } from "./catalog.ts";
export {
  retrieve,
  retrieveByCategory,
  type RetrievalHit,
  type RetrieveOptions,
} from "./ai/catalog-index.ts";
export {
  listRecipes,
  readRecipe,
  recipeFromRetrieval,
  slugifyQuery,
  writeRecipe,
  type Recipe,
} from "./ai/recipe.ts";
export { wirePhantomForRecipe, type WireResult } from "./ai/phantom-wire.ts";
export {
  ClaudeMCPBackend,
  LocalSLMBackend,
  NoInferenceBackendError,
  getInferenceBackend,
  parseRecipeDraft,
  type InferenceBackend,
  type InferenceMode,
  type InferenceRequest,
  type InferenceResult,
  type InferenceUsage,
  type LocalSLMBackendOptions,
  type LocalSLMEndpoint,
  type GetInferenceBackendOptions,
  type RecipeDraft,
  type RecipeProvider,
} from "./ai/inference.ts";
export {
  CircuitBreaker,
  type CircuitBreakerOptions,
  type CircuitState,
} from "./ai/circuit-breaker.ts";
export {
  CostTracker,
  defaultCostTracker,
  type CostSummary,
  type RateCard,
  type UsageRecord,
} from "./ai/cost-tracker.ts";
