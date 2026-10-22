import { expect, it } from "vitest";
import { recordedAlive, recordProcess } from "./process-identity";

const alive = (pid: number) => pid === process.pid;

it("takes a recorded pid only for the process that wrote it", () => {
  expect(recordedAlive(recordProcess(), alive)).toBe(true);
  // The same number, now some other process: after WSL restarts a distribution, say.
  expect(recordedAlive(`${process.pid} 1`, alive)).toBe(false);
  expect(recordedAlive("999999 1", alive)).toBe(false);
  // Written before starts were recorded: the pid alone decides.
  expect(recordedAlive(`${process.pid}\n`, alive)).toBe(true);
  expect(recordedAlive("", alive)).toBe(false);
});
