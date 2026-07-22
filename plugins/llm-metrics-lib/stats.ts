/**
 * Pure statistics helpers for llm-metrics records (NODE-FREE).
 *
 * Lives apart from `transport.ts` so consumers that must stay free of Node
 * builtins (e.g. the TUI sidebar) can import `rollingAvg` without transitively
 * pulling in the filesystem module. `transport.ts` re-exports this so existing
 * importers keep working unchanged.
 */

import type { MetricRecord } from "./types.ts";

/**
 * Mean tokensPerSec over the last `k` records (call OR message) that have a
 * non-null tokensPerSec. Null records do not consume k slots. Null when there
 * is no qualifying record or k <= 0.
 */
export function rollingAvg(records: readonly MetricRecord[], k: number): number | null {
  if (k <= 0) return null;
  let sum = 0;
  let count = 0;
  for (let i = records.length - 1; i >= 0 && count < k; i--) {
    const tps = records[i].tokensPerSec;
    if (typeof tps === "number") {
      sum += tps;
      count += 1;
    }
  }
  return count === 0 ? null : sum / count;
}

/**
 * Mean genTokensPerSec over the last `k` records (call OR message) that have a
 * non-null genTokensPerSec. Null records do not consume k slots. Null when
 * there is no qualifying record or k <= 0.
 */
export function rollingGenAvg(records: readonly MetricRecord[], k: number): number | null {
  if (k <= 0) return null;
  let sum = 0;
  let count = 0;
  for (let i = records.length - 1; i >= 0 && count < k; i--) {
    const tps = records[i].genTokensPerSec;
    if (typeof tps === "number") {
      sum += tps;
      count += 1;
    }
  }
  return count === 0 ? null : sum / count;
}
