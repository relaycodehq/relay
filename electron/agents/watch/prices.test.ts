import { describe, expect, it } from "vitest";
import { listCost, priceOf } from "./prices";

const tokens = (input: number, output: number, cacheRead = 0) => ({
  input,
  cacheWrite: 0,
  cacheRead,
  output,
});

describe("list prices", () => {
  it("prices a small Haiku 5.5 title request at the standard rate", () => {
    // 1,000 in × $0.10 + 100 out × $0.50, per million.
    expect(listCost("claude-haiku-5-5", tokens(1000, 100))).toBeCloseTo(
      0.00015,
    );
  });

  it("charges Haiku 5.5's long rate once a prompt is over 100k, cache reads included", () => {
    expect(priceOf("claude-haiku-5-5", { prompt: 100_000 })?.input).toBe(0.1);
    expect(priceOf("claude-haiku-5-5", { prompt: 100_001 })?.input).toBe(0.5);
    expect(listCost("claude-haiku-5-5", tokens(0, 0, 120_000))).toBeCloseTo(
      (120_000 * 0.05) / 1e6,
    );
  });

  it("bills Claude's other models flat across the 1M window", () => {
    expect(priceOf("claude-opus-5-5[1m]", { prompt: 900_000 })?.input).toBe(4);
  });

  it("doubles GPT input and adds half to output past 272K input tokens", () => {
    const long = priceOf("gpt-6.1-sol", { prompt: 272_001 });
    expect(long).toMatchObject({ input: 4, cacheRead: 0.2, output: 15 });
    expect(priceOf("gpt-6.1-sol", { prompt: 272_000 })?.input).toBe(2);
  });

  it("doubles every rate in fast mode, only where the model has one", () => {
    expect(priceOf("claude-opus-5-5", { fast: true })).toMatchObject({
      input: 8,
      output: 40,
    });
    expect(
      priceOf("gpt-6-astra", { fast: true, prompt: 300_000 })?.output,
    ).toBe(150);
    expect(priceOf("claude-sonnet-5-5", { fast: true })?.input).toBe(2);
  });

  it("takes each prompt's length from the caller for summed requests", () => {
    // Three 50k-token Haiku requests are three short prompts, not one long one.
    const three = tokens(150_000, 0);
    expect(listCost("claude-haiku-5-5", three, { prompt: 50_000 })).toBeCloseTo(
      0.015,
    );
  });

  it("leaves a model with no price unpriced", () => {
    expect(listCost("claude-unknown-9-9", tokens(1000, 100))).toBeUndefined();
  });
});
