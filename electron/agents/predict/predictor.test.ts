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
  it("is null when it abstains or answers otherwise", () => {
    expect(parsePrediction('{"next":null}')).toBeNull();
    expect(parsePrediction('{"next":"  "}')).toBeNull();
    expect(parsePrediction("I think they'll say thanks")).toBeNull();
  });
});

describe("TurnPredictor", () => {
  it("asks once, after a turn with enough calls", async () => {
    const onPrediction = vi.fn();
    const ask = vi.fn(async () => '{"next":"now the phone"}');
    const predictor = new TurnPredictor(
      { request: "add the setting", onPrediction },
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
  });
});
