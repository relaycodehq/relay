import { expect, it } from "vitest";
import { eachLimited } from "./each-limited";

it("never runs more than the limit at once and still does every item", async () => {
  let running = 0;
  let most = 0;
  const done: number[] = [];
  await eachLimited([...Array(50).keys()], 4, async (item) => {
    running++;
    most = Math.max(most, running);
    await new Promise((resolve) => setTimeout(resolve, 1));
    done.push(item);
    running--;
  });

  expect(most).toBe(4);
  expect(done.sort((a, b) => a - b)).toEqual([...Array(50).keys()]);
});

it("stops taking items after one fails and rethrows it", async () => {
  const started: number[] = [];
  const run = eachLimited([...Array(50).keys()], 2, async (item) => {
    started.push(item);
    if (item === 3) throw new Error("broken");
    await new Promise((resolve) => setTimeout(resolve, 1));
  });

  await expect(run).rejects.toThrow("broken");
  expect(started.length).toBeLessThan(8);
});
