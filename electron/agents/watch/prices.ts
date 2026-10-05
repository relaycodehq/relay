import type { WatchTokens } from "../../../shared/watch";

/** List dollars per million tokens; cache writes by how long they keep. */
export type Price = {
  input: number;
  output: number;
  cacheRead: number;
  write5m: number;
  write1h: number;
};

// Anthropic's list (claude-api reference, 2026-09-25) and OpenAI's launch
// price for GPT-6.1 Sol. OpenAI charges no extra for writing its cache.
const PRICES: [prefix: string, price: Price][] = [
  [
    "claude-opus-5-5",
    { input: 4, output: 20, cacheRead: 0.2, write5m: 5, write1h: 8 },
  ],
  [
    "claude-sonnet-5-5",
    { input: 2, output: 10, cacheRead: 0.2, write5m: 2.5, write1h: 4 },
  ],
  [
    "claude-haiku-4-5",
    { input: 1, output: 5, cacheRead: 0.1, write5m: 1.25, write1h: 2 },
  ],
  [
    "gpt-6.1-sol",
    { input: 2, output: 10, cacheRead: 0.1, write5m: 2, write1h: 2 },
  ],
];

/** "claude-opus-5-5[1m]" is priced as "claude-opus-5-5". */
export const bareModel = (model: string) => model.replace(/\[.*\]$/, "");

/** A dated snapshot is the same model; a "-mini" or other variant is not. */
export function priceOf(model: string) {
  const name = bareModel(model).replace(/-\d{8}$/, "");
  return PRICES.find(([id]) => id === name)?.[1];
}

export function costAt(t: WatchTokens, p: Price, longCache: boolean) {
  return (
    (t.input * p.input +
      t.output * p.output +
      t.cacheRead * p.cacheRead +
      t.cacheWrite * (longCache ? p.write1h : p.write5m)) /
    1e6
  );
}

/** Dollars at list price, or undefined for a model without one. */
export function listCost(model: string, tokens: WatchTokens, longCache = true) {
  const price = priceOf(model);
  return price ? costAt(tokens, price, longCache) : undefined;
}
