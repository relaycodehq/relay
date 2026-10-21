import { describe, expect, it, vi } from "vitest";
import { parsePrediction } from "./prompt";
import { TurnPredictor, worthPredicting } from "./predictor";

describe("worthPredicting", () => {
  it("skips small turns and wrap-up chores", () => {
    expect(worthPredicting("fix the login race", 2)).toBe(false);
    expect(worthPredicting("Commit", 5)).toBe(false);
    expect(worthPredicting("commit and push it", 6)).toBe(false);
    expect(worthPredicting("fix the login race", 3)).toBe(true);
    // A chore word starting a real ask isn't a chore.
    expect(
      worthPredicting(
        "merge the two settings pages into one and keep the search",
        4,
      ),
    ).toBe(true);
  });
});

describe("parsePrediction", () => {
  it("reads the guess, fenced or with words around it", () => {
    expect(parsePrediction('{"next":"run the e2e too"}')).toBe(
      "run the e2e too",
    );
    expect(parsePrediction('```json\n{"next":"go with B"}\n```')).toBe(
      "go with B",
    );
    expect(parsePrediction('Sure: {"next":"ship it"}')).toBe("ship it");
  });
  it("drops what the person wouldn't type next", () => {
    expect(parsePrediction('{"next":"I\'ll run the tests now"}')).toBeNull();
    expect(parsePrediction('{"next":"Looks good!"}')).toBeNull();
    expect(parsePrediction('{"next":"do A\nthen B"}')).toBeNull();
    expect(
      parsePrediction(JSON.stringify({ next: "x ".repeat(80) })),
    ).toBeNull();
    expect(parsePrediction('{"next":"sure, go ahead"}')).toBe("sure, go ahead");
    expect(parsePrediction('{"next":"looks good, now the phone"}')).toBe(
      "looks good, now the phone",
    );
  });
  it("is null when it abstains or answers otherwise", () => {
    expect(parsePrediction('{"next":null}')).toBeNull();
    expect(parsePrediction('{"next":"  "}')).toBeNull();
    expect(parsePrediction("I think they'll say thanks")).toBeNull();
  });
});

describe("TurnPredictor", () => {
  it("asks once, after a turn with enough calls", async () => {
    const onPrediction = vi.fn();
    const onAsked = vi.fn();
    const cost = {
      model: "claude-opus-5-5",
      tokens: { input: 40, cacheWrite: 0, cacheRead: 30_000, output: 20 },
      usd: 0.0065,
    };
    const ask = vi.fn(async () => ({
      reply: '{"next":"now the phone"}',
      cost,
    }));
    const predictor = new TurnPredictor(
      { request: "add the setting", onPrediction, onAsked },
      ask,
      new AbortController().signal,
    );
    predictor.called(["a", "b", "b", "c"]);
    predictor.ended();
    predictor.ended();
    await vi.waitFor(() =>
      expect(onPrediction).toHaveBeenCalledWith("now the phone"),
    );
    expect(ask).toHaveBeenCalledTimes(1);
    expect(onAsked).toHaveBeenCalledWith({ offered: true, cost });
  });

  it("skips a turn its gate holds back", async () => {
    const ask = vi.fn(async () => ({ reply: '{"next":"go"}' }));
    const predictor = new TurnPredictor(
      { request: "plan it", onPrediction: vi.fn(), allows: () => false },
      ask,
      new AbortController().signal,
    );
    predictor.called(["a", "b", "c"]);
    predictor.ended();
    await Promise.resolve();
    expect(ask).not.toHaveBeenCalled();
  });

  it("still reports what an abstention cost", async () => {
    const onPrediction = vi.fn();
    const onAsked = vi.fn();
    const predictor = new TurnPredictor(
      { request: "explain the meter", onPrediction, onAsked },
      async () => ({ reply: '{"next":null}' }),
      new AbortController().signal,
    );
    predictor.called(["a", "b", "c"]);
    predictor.ended();
    await vi.waitFor(() =>
      expect(onAsked).toHaveBeenCalledWith({ offered: false }),
    );
    expect(onPrediction).not.toHaveBeenCalled();
  });
});
