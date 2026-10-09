import type { WatchTokens } from "../../../shared/watch";

/** List dollars per million tokens; cache writes by how long they keep. */
export type Price = {
  input: number;
  output: number;
  cacheRead: number;
  write5m: number;
  write1h: number;
};

type Rates = {
  price: Price;
  /** What one request pays once its prompt is over `over` tokens. */
  long?: { over: number; price: Price };
  /** Fast mode multiplies every rate, long prompts included. */
  fast?: number;
};

/** One request: its whole prompt (cached or not) picks the tier. */
export type Request = { prompt?: number; fast?: boolean };

const anthropic = (
  input: number,
  output: number,
  cacheRead = input / 10,
): Price => ({
  input,
  output,
  cacheRead,
  write5m: input * 1.25,
  write1h: input * 2,
});

// OpenAI's cache writes cost the same whatever they keep for. Past 272K input
// tokens a request pays double on its input side and half again on output.
const openai = (input: number, cacheRead: number, output: number): Rates => {
  const price = (i: number, r: number, o: number): Price => ({
    input: i,
    output: o,
    cacheRead: r,
    write5m: i * 1.25,
    write1h: i * 1.25,
  });
  return {
    price: price(input, cacheRead, output),
    long: {
      over: 272_000,
      price: price(input * 2, cacheRead * 2, output * 1.5),
    },
    fast: 2,
  };
};

// Anthropic's list (platform.claude.com/docs/en/about-claude/pricing) and
// OpenAI's standard tier (developers.openai.com/api/docs/pricing), both read
// 2026-10-09. Claude models since 4.6 bill a 1M context flat, all but Haiku 5.5.
// Data residency's 10% uplift isn't modelled; Relay calls the global endpoints.
const PRICES: [id: string, rates: Rates][] = [
  ["claude-fable-5-1", { price: anthropic(10, 50, 0.25) }],
  ["claude-opus-5-5", { price: anthropic(4, 20, 0.2), fast: 2 }],
  ["claude-sonnet-5-5", { price: anthropic(2, 10, 0.1) }],
  ["claude-opus-4-8", { price: anthropic(5, 25), fast: 2 }],
  [
    "claude-haiku-5-5",
    {
      price: anthropic(0.1, 0.5),
      long: { over: 100_000, price: anthropic(0.5, 2.5) },
    },
  ],
  ["claude-haiku-4-5", { price: anthropic(1, 5) }],
  ["gpt-6.1-sol", openai(2, 0.1, 10)],
  ["gpt-6-astra", openai(10, 1, 50)],
  ["gpt-6-sol", openai(2, 0.2, 10)],
  ["gpt-6-luna", openai(0.1, 0.01, 0.5)],
  // A promotional price, promised through at least 2026-11-21.
  ["gpt-5.6-sol", openai(4, 0.4, 20)],
  ["gpt-5.6-terra", openai(2, 0.2, 12)],
  ["gpt-5.6-luna", openai(0.2, 0.02, 1.2)],
];

/** "claude-opus-5-5[1m]" is priced as "claude-opus-5-5". */
export const bareModel = (model: string) => model.replace(/\[.*\]$/, "");

/** Every input token a request reads or writes, cached or not. */
export const promptOf = (t: WatchTokens) =>
  t.input + t.cacheRead + t.cacheWrite;

const times = (p: Price, n: number): Price => ({
  input: p.input * n,
  output: p.output * n,
  cacheRead: p.cacheRead * n,
  write5m: p.write5m * n,
  write1h: p.write1h * n,
});

/**
 * A dated snapshot is the same model; a "-mini" or other variant is not.
 * Fast mode on a model without it runs, and bills, at standard speed.
 */
export function priceOf(model: string, { prompt = 0, fast }: Request = {}) {
  const name = bareModel(model).replace(/-\d{8}$/, "");
  const rates = PRICES.find(([id]) => id === name)?.[1];
  if (!rates) return undefined;
  const price =
    rates.long && prompt > rates.long.over ? rates.long.price : rates.price;
  return fast && rates.fast ? times(price, rates.fast) : price;
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

/**
 * Dollars at list price, or undefined for a model without one. `tokens` are
 * one request's unless `request.prompt` says how long each prompt was.
 */
export function listCost(
  model: string,
  tokens: WatchTokens,
  request: Request = {},
  longCache = true,
) {
  const price = priceOf(model, {
    ...request,
    prompt: request.prompt ?? promptOf(tokens),
  });
  return price ? costAt(tokens, price, longCache) : undefined;
}
