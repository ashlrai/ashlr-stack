/**
 * Tiny cost tracker for inference backends.
 *
 * Stack only talks to local SLMs (LM Studio / Ollama) or delegates synth
 * back to Claude over MCP — both cost $0 at the Stack layer. We still track
 * token counts so the CLI can surface "you offloaded N tokens of synthesis
 * to your laptop" and so future remote backends can plug in a non-zero
 * rate card without touching callers.
 *
 * Rates are per-million tokens. Local backends register at [0, 0].
 */

export interface UsageRecord {
  backend: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  at: number;
}

export interface CostSummary {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  perBackend: Record<
    string,
    { inputTokens: number; outputTokens: number; costUsd: number; calls: number }
  >;
}

/** Rate card entry — USD per 1M tokens. */
export interface RateCard {
  inputPer1M: number;
  outputPer1M: number;
}

export class CostTracker {
  private records: UsageRecord[] = [];
  private rates = new Map<string, RateCard>();

  /** Register per-1M-token pricing for a backend. Defaults to free. */
  setRate(backend: string, rate: RateCard): void {
    this.rates.set(backend, rate);
  }

  recordUsage(
    backend: string,
    inputTokens: number,
    outputTokens: number,
  ): UsageRecord {
    const rate = this.rates.get(backend) ?? { inputPer1M: 0, outputPer1M: 0 };
    const costUsd =
      (inputTokens / 1_000_000) * rate.inputPer1M +
      (outputTokens / 1_000_000) * rate.outputPer1M;
    const entry: UsageRecord = {
      backend,
      inputTokens,
      outputTokens,
      costUsd,
      at: Date.now(),
    };
    this.records.push(entry);
    return entry;
  }

  getSummary(): CostSummary {
    const summary: CostSummary = {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      perBackend: {},
    };
    for (const r of this.records) {
      summary.totalInputTokens += r.inputTokens;
      summary.totalOutputTokens += r.outputTokens;
      summary.totalCostUsd += r.costUsd;
      const slot =
        summary.perBackend[r.backend] ??
        (summary.perBackend[r.backend] = {
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          calls: 0,
        });
      slot.inputTokens += r.inputTokens;
      slot.outputTokens += r.outputTokens;
      slot.costUsd += r.costUsd;
      slot.calls += 1;
    }
    return summary;
  }

  /** Discard all recorded usage. */
  reset(): void {
    this.records = [];
  }
}

/**
 * Module-level default tracker. Callers can either share this singleton or
 * construct their own when isolation is needed (tests, nested invocations).
 */
export const defaultCostTracker = new CostTracker();
