import { expect, it } from "vitest";
import { OpenCodeRequestSpeed } from "./speed";

it("times a request's text and the writing of its tool calls, not the calls running", () => {
  let now = 0;
  const speed = new OpenCodeRequestSpeed(() => now);
  speed.text("m", "t");
  now = 1000;
  speed.text("m", "t");
  now = 1500;
  speed.tool("m", "c", "pending");
  now = 2000;
  speed.tool("m", "c", "running");
  // Running and finishing are the tool's own time, not the model's.
  now = 60_000;
  speed.tool("m", "c", "completed");
  expect(speed.finish("m", { output: 300 })).toEqual({ output: 300, ms: 1500 });
  // Each request is timed once.
  expect(speed.finish("m", { output: 300 })).toBeUndefined();
});

it("leaves a request it never saw written untimed", () => {
  const speed = new OpenCodeRequestSpeed(() => 0);
  expect(speed.finish("m", { output: 300 })).toBeUndefined();
  // Everything at once is no measure of speed.
  speed.text("n", "t");
  expect(speed.finish("n", { output: 300 })).toBeUndefined();
});
