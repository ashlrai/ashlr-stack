export * from "./config.ts";
export {
  isEnabled as isTelemetryEnabled,
  promptFirstRun as promptTelemetryFirstRun,
  emit as emitTelemetry,
  disable as disableTelemetry,
  enable as enableTelemetry,
  type TelemetryEvent,
  type TelemetryConfig,
} from "./telemetry.ts";
export { detectPackageManager, installCommand } from "./pm-detect.ts";
export type { PackageManager } from "./pm-detect.ts";
export * from "./phantom.ts";
export * from "./providers/_base.ts";
export { providers, getProvider, listProviderNames } from "./providers/index.ts";
export * from "./errors.ts";
export * from "./templates.ts";
export {
  addService,
  resumeProvisionFromLog,
  type AddServiceOpts,
  type AddServiceResult,
  type ResumeProvisionOpts,
} from "./pipeline.ts";
export {
  runConflictCheck,
  buildConflictCheckMeta,
  buildConflictCheckTelemetry,
  generateUniqueName,
  defaultCiPrompt,
  type ConflictCheckRunOpts,
  type ConflictCheckResult,
  type ConflictCheckTelemetry,
  type ConflictResolutionStrategy,
  type ConflictPromptFn,
} from "./resource-conflict.ts";
export {
  resolveOrder,
  runOrchestrationGroup,
  buildRollbackGraph,
  buildRollbackPlan,
  computeRollbackPlan,
  executeRollbackPlan,
  type OrchestrationEntry,
  type OrchestrationGroup,
  type OrchestrationGroupDefaults,
  type OrchestrationResult,
  type OrchestrationRollbackFn,
  type RollbackGraph,
  type RollbackPlan,
  type RollbackWave,
  type RollbackStepResult,
  type RollbackTranscript,
  type DeprovisionFn,
  type ExecuteRollbackPlanOpts,
} from "./orchestration.ts";
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
export { findSwap, suggestSwaps, SWAP_PAIRS } from "./swap.ts";
export type { SwapPair } from "./swap.ts";
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
export {
  ProvisionSchemaValidationError,
  SchemaValidator,
  schemaValidator,
  generateTypeScript,
  getProviderSchema,
  listRegisteredSchemas,
  registerProviderSchema,
  resolvePath,
  runValidateOnly,
  formatValidateOnlyResults,
  validateProvisionResponse,
  validateSchema,
  validateSchemaCompleteness,
  type CompiledValidator,
  type JsonSchemaProperty,
  type JsonSchemaType,
  type ProvisionResponseSchema,
  type ProvisionResponseSchemaWithVersion,
  type SchemaCompletenessResult,
  type SchemaViolation,
  type ValidateOnlyResult,
} from "./provision-schema.ts";
export {
  captureProvisionError,
  classifyError,
  sanitizeBody,
  buildHints,
  buildReplayRecord,
  saveReplayRecord,
  loadReplayRecord,
  loadProvisionErrorReport,
  printProvisionError,
  appendReplayLog,
  writeReplaySessionMeta,
  readReplaySessionMeta,
  readReplayLog,
  listReplaySessions,
  generateSessionId,
  replayLogDir,
  type ProvisionErrorCode,
  type ProvisionErrorReport,
  type ProvisionErrorContext,
  type RecoveryHint,
  type RetryPolicy,
  type RequestSnapshot,
  type ReplayRecord,
  type ProvisionReplayLog,
  type ReplayLogStatus,
  type ReplaySessionMeta,
} from "./errors/provision-errors.ts";
export {
  dryRunProvider,
  dryRunProviders,
  dryRunAddService,
  formatDryRunReport,
  formatDryRunReportJson,
  getStaticCostEstimate,
  type CostEstimate,
  type DryRunResourceResult,
  type DryRunReport,
  type DryRunProviderOpts,
  type DryRunAddServiceOpts,
} from "./dry-run.ts";
export {
  Instrumentation,
  MemoryCollector,
  FileCollector,
  instrumentation,
  type InstrumentationCollector,
  type InstrumentationEvent,
  type InstrumentationEventType,
  type StepEvent,
  type StepStatus,
  type RollbackEvent,
  type RollbackItem,
  type PartialFailureEvent,
  type PartialStateItem,
  type OrchestrationStepEvent,
} from "./instrumentation.ts";
export {
  QuotaEngine,
  buildForecast,
  probeResultToSnapshot,
  type QuotaSnapshot,
  type QuotaForecast,
  type QuotaAlert,
  type BurnTrend,
  type QuotaEngineOptions,
} from "./quota-engine.ts";
export {
  runProbes,
  BUILTIN_PROBES,
  ProbeRegistry,
  defaultProbeRegistry,
  generateProbeStub,
  writeProbeStub,
  type Probe,
  type ProbeContext,
  type ProbeResult,
  type ProbeRunSummary,
  type RunProbesOptions,
  appendSample,
  computePercentiles,
  readHistogram,
  writeHistogram,
  __setHistogramDirForTesting,
} from "./probes/index.ts";
