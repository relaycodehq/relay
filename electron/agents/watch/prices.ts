import type { WatchTokens } from "../../../shared/watch";

/** List dollars per million tokens; cache writes by how long they keep. */
export type Price = {
  input: number;
  output: number;
  cacheRead: number;
  write5m: number;
  write1h: number;
};

// Anthropic's list (platform.claude.com pricing) and OpenAI's standard
// short-context prices (developers.openai.com pricing), both read 2026-10-06.
// OpenAI's long-context tier, about double, isn't modelled. Its cache writes
// have one price whatever they keep for.
const PRICES: [prefix: string, price: Price][] = [
  [
    "claude-fable-5-1",
    { input: 10, output: 50, cacheRead: 0.25, write5m: 12.5, write1h: 20 },
  ],
  [
    "claude-opus-5-5",
    { input: 4, output: 20, cacheRead: 0.2, write5m: 5, write1h: 8 },
  ],
  [
    "claude-sonnet-5-5",
    { input: 2, output: 10, cacheRead: 0.2, write5m: 2.5, write1h: 4 },
  ],
  [
    "claude-opus-4-8",
    { input: 5, output: 25, cacheRead: 0.5, write5m: 6.25, write1h: 10 },
  ],
  [
    "claude-haiku-4-5",
    { input: 1, output: 5, cacheRead: 0.1, write5m: 1.25, write1h: 2 },
  ],
  [
    "gpt-6.1-sol",
    { input: 2, output: 10, cacheRead: 0.1, write5m: 2.5, write1h: 2.5 },
  ],
  [
    "gpt-6-astra",
    { input: 10, output: 50, cacheRead: 1, write5m: 12.5, write1h: 12.5 },
  ],
  [
    "gpt-6-sol",
    { input: 2, output: 10, cacheRead: 0.2, write5m: 2.5, write1h: 2.5 },
  ],
  [
    "gpt-6-luna",
    {
      input: 0.1,
      output: 0.5,
      cacheRead: 0.01,
      write5m: 0.125,
      write1h: 0.125,
    },
  ],
  // A promotional price, promised through at least 2026-11-21.
  [
    "gpt-5.6-sol",
    { input: 4, output: 20, cacheRead: 0.4, write5m: 5, write1h: 5 },
  ],
  [
    "gpt-5.6-terra",
    { input: 2, output: 12, cacheRead: 0.2, write5m: 2.5, write1h: 2.5 },
  ],
  [
    "gpt-5.6-luna",
    { input: 0.2, output: 1.2, cacheRead: 0.02, write5m: 0.25, write1h: 0.25 },
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
