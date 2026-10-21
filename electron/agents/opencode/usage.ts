import type { ModelRef, TokenUsageInfo } from "@opencode/client";
import type { UsageReport } from "../types";

export const modelId = (model: ModelRef) => `${model.providerID}/${model.id}`;

/** OpenCode counts visible output, reasoning and cache tokens separately. */
export function nativeUsage(
  model: ModelRef,
  tokens: TokenUsageInfo,
  usd?: number,
): UsageReport {
  return {
    model: modelId(model),
    tokens: {
      input: tokens.input,
      output: tokens.output + tokens.reasoning,
      cacheRead: tokens.cache.read,
      cacheWrite: tokens.cache.write,
    },
    ...(usd === undefined ? {} : { usd }),
  };
}
